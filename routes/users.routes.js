const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // PostgreSQL pool
const { registrarBitacora } = require('../services/bitacora.service');

// ============================================================
// RUTA PRINCIPAL - Mostrar vista de usuarios
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { rows: usuarios } = await pool.query(`
      SELECT 
        u.id_usuario AS "ID_USUARIO",
        u.usuario AS "USUARIO",
        u.nombre_usuario AS "NOMBRE_USUARIO",
        u.estado AS "ESTADO",
        u.correo_electronico AS "CORREO_ELECTRONICO",
        u.activo_2fa AS "ACTIVO_2FA",
        u.fecha_ultima_conexion AS "FECHA_ULTIMA_CONEXION",
        r.rol AS "NOMBRE_ROL",
        r.id_rol AS "ID_ROL"
      FROM tbl_ms_usuario u
      INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol
      ORDER BY u.id_usuario
    `);

    const { rows: roles } = await pool.query(
      `SELECT id_rol AS "ID_ROL", rol AS "ROL", descripcion AS "DESCRIPCION" 
       FROM tbl_ms_roles 
       ORDER BY id_rol`
    );

    res.render("users", { 
      usuarios,
      roles,
      usuarioLogueado: req.user?.USUARIO || 'SISTEMA'
    });
  } catch (error) {
    console.error("❌ Error en GET /users:", error);
    res.status(500).send("Error al cargar usuarios");
  }
});

// ============================================================
// API: Obtener todas las especialidades activas
// ============================================================
router.get("/api/especialidades", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id_especialidad AS "ID_ESPECIALIDAD", nombre_especialidad AS "NOMBRE_ESPECIALIDAD" 
       FROM tbl_especialidades 
       WHERE estado = 'ACTIVA' 
       ORDER BY nombre_especialidad`
    );
    res.json({ ok: true, especialidades: rows });
  } catch (error) {
    console.error("❌ Error al obtener especialidades:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener especialidades" });
  }
});

// ============================================================
// API: Obtener usuario por ID (con especialidades y teléfono)
// ============================================================
router.get("/api/usuario/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await pool.query(
      `SELECT 
        u.id_usuario AS "ID_USUARIO",
        u.usuario AS "USUARIO",
        u.nombre_usuario AS "NOMBRE_USUARIO",
        u.estado AS "ESTADO",
        u.correo_electronico AS "CORREO_ELECTRONICO",
        u.activo_2fa AS "ACTIVO_2FA",
        u.fecha_ultima_conexion AS "FECHA_ULTIMA_CONEXION",
        u.telefono_profesional AS "TELEFONO_PROFESIONAL",
        r.rol AS "ROL",
        r.id_rol AS "ID_ROL"
       FROM tbl_ms_usuario u 
       INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol 
       WHERE u.id_usuario = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, msg: "Usuario no encontrado" });
    }
    const usuario = rows[0];
    let especialidades = [];
    if (usuario.ID_ROL === 2) {
      const { rows: espRows } = await pool.query(
        `SELECT id_especialidad AS "ID_ESPECIALIDAD" FROM tbl_doctor_especialidad WHERE id_doctor = $1`,
        [id]
      );
      especialidades = espRows.map(row => row.ID_ESPECIALIDAD);
    }
    res.json({ ok: true, usuario, especialidades });
  } catch (error) {
    console.error("❌ Error al obtener usuario:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener usuario" });
  }
});

// ============================================================
// API: Actualizar usuario (incluye TELEFONO_PROFESIONAL) - CON BITÁCORA DETALLADA
// ============================================================
router.post("/api/update", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      id,
      usuario,
      nombre_usuario,
      id_rol,
      estado,
      activo_2fa,
      usuarioAccion,
      especialidades,
      telefonoProfesional
    } = req.body;

    if (!id || !usuario || !nombre_usuario || !id_rol || !estado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, msg: "Faltan campos obligatorios" });
    }

    // 1. Obtener datos actuales del usuario
    const { rows: usuarioActual } = await client.query(
      `SELECT 
        u.id_usuario AS "ID_USUARIO",
        u.usuario AS "USUARIO",
        u.nombre_usuario AS "NOMBRE_USUARIO",
        u.estado AS "ESTADO",
        u.telefono_profesional AS "TELEFONO_PROFESIONAL",
        r.rol AS "NOMBRE_ROL",
        r.id_rol AS "ID_ROL"
       FROM tbl_ms_usuario u 
       INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol 
       WHERE u.id_usuario = $1`,
      [id]
    );
    if (usuarioActual.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, msg: "Usuario no encontrado" });
    }
    const old = usuarioActual[0];

    // 2. Actualizar usuario
    const rolId = parseInt(id_rol);
    if (isNaN(rolId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, msg: "El rol debe ser un número válido" });
    }

    await client.query(
      `UPDATE tbl_ms_usuario SET 
        usuario = $1, 
        nombre_usuario = $2, 
        id_rol = $3, 
        estado = $4, 
        activo_2fa = $5, 
        telefono_profesional = $6,
        fecha_modificacion = CURRENT_TIMESTAMP, 
        usuario_modificacion = $7 
      WHERE id_usuario = $8`,
      [usuario, nombre_usuario, rolId, estado, activo_2fa || 0, telefonoProfesional || null, usuarioAccion || 'SISTEMA', id]
    );

    // 3. Actualizar especialidades (si es doctor)
    let especialidadesAntes = [];
    let especialidadesDespues = [];
    if (rolId === 2) {
      const { rows: espAntes } = await client.query(
        `SELECT id_especialidad AS "ID_ESPECIALIDAD" FROM tbl_doctor_especialidad WHERE id_doctor = $1`,
        [id]
      );
      especialidadesAntes = espAntes.map(row => row.ID_ESPECIALIDAD);

      await client.query(`DELETE FROM tbl_doctor_especialidad WHERE id_doctor = $1`, [id]);
      
      if (especialidades && especialidades.length > 0) {
        // Construir INSERT múltiple
        const values = [];
        const placeholders = [];
        let paramIndex = 1;
        especialidades.forEach(espId => {
          values.push(id, espId);
          placeholders.push(`($${paramIndex}, $${paramIndex+1})`);
          paramIndex += 2;
        });
        await client.query(
          `INSERT INTO tbl_doctor_especialidad (id_doctor, id_especialidad) VALUES ${placeholders.join(', ')}`,
          values
        );
        especialidadesDespues = especialidades.map(Number);
      }
    }

    // 4. Construir mensaje detallado de bitácora
    const cambios = [];
    if (old.USUARIO !== usuario) {
      cambios.push(`Usuario: '${old.USUARIO}' → '${usuario}'`);
    }
    if (old.NOMBRE_USUARIO !== nombre_usuario) {
      cambios.push(`Nombre: '${old.NOMBRE_USUARIO}' → '${nombre_usuario}'`);
    }
    if (Number(old.ID_ROL) !== rolId) {
      const { rows: rolNuevo } = await client.query(`SELECT rol AS "ROL" FROM tbl_ms_roles WHERE id_rol = $1`, [rolId]);
      const nombreRolNuevo = rolNuevo.length ? rolNuevo[0].ROL : 'Desconocido';
      cambios.push(`Rol: '${old.NOMBRE_ROL}' → '${nombreRolNuevo}'`);
    }
    if (old.ESTADO !== estado) {
      cambios.push(`Estado: '${old.ESTADO}' → '${estado}'`);
    }
    const oldTelefono = old.TELEFONO_PROFESIONAL || 'Ninguno';
    const newTelefono = telefonoProfesional || 'Ninguno';
    if (oldTelefono !== newTelefono) {
      cambios.push(`Teléfono profesional: '${oldTelefono}' → '${newTelefono}'`);
    }

    if (rolId === 2) {
      const espAntesStr = especialidadesAntes.sort().join(', ');
      const espDespuesStr = especialidadesDespues.sort().join(', ');
      if (espAntesStr !== espDespuesStr) {
        if (especialidadesDespues.length === 0) {
          cambios.push(`Especialidades: se eliminaron todas las especialidades`);
        } else if (especialidadesAntes.length === 0) {
          cambios.push(`Especialidades: se agregaron ${especialidadesDespues.length} especialidad(es)`);
        } else {
          cambios.push(`Especialidades: se modificaron (antes: ${espAntesStr || 'Ninguna'}, ahora: ${espDespuesStr || 'Ninguna'})`);
        }
      }
    }

    let mensajeBitacora = `El usuario '${usuarioAccion || 'SISTEMA'}' actualizó al usuario '${usuario}'`;
    if (cambios.length > 0) {
      mensajeBitacora += ` - Cambios: ${cambios.join('; ')}.`;
    } else {
      mensajeBitacora += ` (sin cambios visibles).`;
    }

    await client.query('COMMIT');

    await registrarBitacora({
      usuario: usuarioAccion || 'SISTEMA',
      accion: "ACTUALIZACION_USUARIO",
      descripcion: mensajeBitacora,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "TBL_MS_USUARIO",
      estado: "EXITO",
      req
    });

    res.json({ ok: true, msg: "Usuario actualizado correctamente" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error en POST /users/api/update:", error);
    res.status(500).json({ ok: false, msg: "Error al actualizar usuario: " + error.message });
  } finally {
    client.release();
  }
});

// ============================================================
// API: Cambiar estado de usuario
// ============================================================
router.post("/api/cambiar-estado", async (req, res) => {
  try {
    const { id, estado, usuarioAccion } = req.body;
    if (!id || !estado) {
      return res.status(400).json({ ok: false, msg: "Faltan parámetros" });
    }

    const { rows: user } = await pool.query(`SELECT usuario FROM tbl_ms_usuario WHERE id_usuario = $1`, [id]);
    const nombreUsuario = user.length ? user[0].usuario : 'Desconocido';

    await pool.query(
      `UPDATE tbl_ms_usuario SET estado = $1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $2 WHERE id_usuario = $3`,
      [estado, usuarioAccion || 'SISTEMA', id]
    );

    await registrarBitacora({
      usuario: usuarioAccion || 'SISTEMA',
      accion: "CAMBIO_ESTADO_USUARIO",
      descripcion: `El usuario '${usuarioAccion || 'SISTEMA'}' cambió el estado del usuario '${nombreUsuario}' a: ${estado}`,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "TBL_MS_USUARIO",
      estado: "EXITO",
      req
    });

    res.json({ ok: true, msg: "Estado actualizado correctamente" });
  } catch (error) {
    console.error("❌ Error en POST /api/cambiar-estado:", error);
    res.status(500).json({ ok: false, msg: "Error al cambiar estado" });
  }
});

// ============================================================
// API: Eliminar usuario permanentemente
// ============================================================
router.post("/api/delete", async (req, res) => {
  try {
    const { id, usuarioAccion } = req.body;
    if (!id) {
      return res.status(400).json({ ok: false, msg: "ID de usuario requerido" });
    }

    const { rows: user } = await pool.query(`SELECT usuario FROM tbl_ms_usuario WHERE id_usuario = $1`, [id]);
    const nombreUsuario = user.length ? user[0].usuario : 'Desconocido';

    await pool.query(`DELETE FROM tbl_ms_usuario WHERE id_usuario = $1`, [id]);

    await registrarBitacora({
      usuario: usuarioAccion || 'SISTEMA',
      accion: "ELIMINACION_USUARIO",
      descripcion: `El usuario '${usuarioAccion || 'SISTEMA'}' eliminó permanentemente al usuario '${nombreUsuario}' (ID ${id})`,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "TBL_MS_USUARIO",
      estado: "EXITO",
      req
    });

    res.json({ ok: true, msg: "Usuario eliminado permanentemente" });
  } catch (error) {
    console.error("❌ Error en POST /api/delete:", error);
    res.status(500).json({ ok: false, msg: "Error al eliminar usuario" });
  }
});

module.exports = router;