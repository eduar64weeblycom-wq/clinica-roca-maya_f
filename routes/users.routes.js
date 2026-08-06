const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const { registrarBitacora } = require('../services/bitacora.service');
const xl = require('excel4node'); // Asegúrate de tenerlo requerido si usas exportación Excel

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

    // Obtener todos los roles
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
// API: Obtener usuario por ID (con especialidades si es doctor)
// ============================================================
router.get("/api/usuario/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { rows } = await pool.query(
      `SELECT u.*, r.rol AS "ROL" 
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
    
    // Si es doctor (ID_ROL = 2)
    if (usuario.id_rol === 2 || usuario.ID_ROL === 2) {
      const { rows: espRows } = await pool.query(
        `SELECT id_especialidad FROM tbl_doctor_especialidad WHERE id_doctor = $1`,
        [id]
      );
      especialidades = espRows.map(row => row.id_especialidad || row.ID_ESPECIALIDAD);
    }
    res.json({ ok: true, usuario, especialidades });
  } catch (error) {
    console.error("❌ Error al obtener usuario:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener usuario" });
  }
});

// ============================================================
// API: Actualizar usuario (incluyendo especialidades)
// ============================================================
router.post("/api/update", async (req, res) => {
  try {
    const {
      id,
      usuario,
      nombre_usuario,
      id_rol,
      estado,
      activo_2fa,
      usuarioAccion,
      especialidades
    } = req.body;

    if (!id || !usuario || !nombre_usuario || !id_rol || !estado) {
      return res.status(400).json({ ok: false, msg: "Faltan campos obligatorios" });
    }

    // Actualizar datos básicos del usuario
    await pool.query(
      `UPDATE tbl_ms_usuario SET 
        usuario = $1, 
        nombre_usuario = $2, 
        id_rol = $3, 
        estado = $4, 
        activo_2fa = $5, 
        fecha_modificacion = CURRENT_TIMESTAMP, 
        usuario_modificacion = $6 
      WHERE id_usuario = $7`,
      [usuario, nombre_usuario, id_rol, estado, activo_2fa || 0, usuarioAccion || 'SISTEMA', id]
    );

    // ============================================================
    // GESTIÓN DE ESPECIALIDADES (SOLO PARA DOCTORES)
    // ============================================================
    if (parseInt(id_rol) === 2) {
      await pool.query(`DELETE FROM tbl_doctor_especialidad WHERE id_doctor = $1`, [id]);
      
      if (especialidades && especialidades.length > 0) {
        for (const espId of especialidades) {
          await pool.query(
            `INSERT INTO tbl_doctor_especialidad (id_doctor, id_especialidad) VALUES ($1, $2)`,
            [parseInt(id), parseInt(espId)]
          );
        }
      }
    }

    await registrarBitacora({
      usuario: usuarioAccion || 'SISTEMA',
      accion: "ACTUALIZACION_USUARIO",
      descripcion: `Usuario ${usuario} actualizado. Rol: ${id_rol}. Especialidades: ${especialidades ? especialidades.join(', ') : 'Ninguna'}`,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "tbl_ms_usuario",
      estado: "EXITO",
      req
    });

    res.json({ ok: true, msg: "Usuario actualizado correctamente" });

  } catch (error) {
    console.error("❌ Error en POST /users/api/update:", error);
    res.status(500).json({ ok: false, msg: "Error al actualizar usuario: " + error.message });
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

    await pool.query(
      `UPDATE tbl_ms_usuario SET estado = $1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $2 WHERE id_usuario = $3`,
      [estado, usuarioAccion || 'SISTEMA', id]
    );

    await registrarBitacora({
      usuario: usuarioAccion || 'SISTEMA',
      accion: "CAMBIO_ESTADO_USUARIO",
      descripcion: `Usuario ID ${id} cambió a estado: ${estado}`,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "tbl_ms_usuario",
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
// GET /excel/usuarios -> Descargar Excel de usuarios
// ============================================================
router.get("/usuarios", async (req, res) => {
  try {
    const { rows: usuarios } = await pool.query(`
      SELECT 
        u.usuario,
        u.nombre_usuario,
        r.rol AS rol,
        u.estado,
        u.correo_electronico,
        CASE WHEN u.activo_2fa = 1 THEN 'Sí' ELSE 'No' END AS activo_2fa,
        u.fecha_ultima_conexion
      FROM tbl_ms_usuario u
      INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol
      ORDER BY u.id_usuario
    `);

    if (!usuarios || usuarios.length === 0) {
      return res.status(404).json({ success: false, message: "No hay usuarios para exportar" });
    }

    const wb = new xl.Workbook();
    const ws = wb.addWorksheet('Usuarios');

    const headerStyle = wb.createStyle({
      font: { bold: true, color: '#FFFFFF', size: 12 },
      fill: { type: 'pattern', patternType: 'solid', bgColor: '#217346', fgColor: '#217346' },
      alignment: { horizontal: 'center', vertical: 'center' },
    });

    const cellStyle = wb.createStyle({
      alignment: { horizontal: 'left', vertical: 'center' },
      border: {
        left: { style: 'thin', color: '#000000' },
        right: { style: 'thin', color: '#000000' },
        top: { style: 'thin', color: '#000000' },
        bottom: { style: 'thin', color: '#000000' },
      },
    });

    const headers = ['Usuario', 'Nombre', 'Rol', 'Estado', 'Correo', '2FA Activado', 'Última Conexión'];
    headers.forEach((header, index) => {
      ws.cell(1, index + 1).string(header).style(headerStyle);
    });

    usuarios.forEach((usuario, rowIndex) => {
      const row = rowIndex + 2;
      ws.cell(row, 1).string(usuario.usuario || '').style(cellStyle);
      ws.cell(row, 2).string(usuario.nombre_usuario || '').style(cellStyle);
      ws.cell(row, 3).string(usuario.rol || '').style(cellStyle);
      ws.cell(row, 4).string(usuario.estado || '').style(cellStyle);
      ws.cell(row, 5).string(usuario.correo_electronico || '').style(cellStyle);
      ws.cell(row, 6).string(usuario.activo_2fa || 'No').style(cellStyle);
      ws.cell(row, 7).string(usuario.fecha_ultima_conexion ? new Date(usuario.fecha_ultima_conexion).toLocaleString() : 'Nunca').style(cellStyle);
    });

    ws.column(1).setWidth(20);
    ws.column(2).setWidth(30);
    ws.column(3).setWidth(20);
    ws.column(4).setWidth(15);
    ws.column(5).setWidth(30);
    ws.column(6).setWidth(18);
    ws.column(7).setWidth(25);

    const fecha = new Date().toISOString().split('T')[0];
    const fileName = `Usuarios_${fecha}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    wb.write(fileName, res);

    try {
      await registrarBitacora({
        usuario: req.user?.nombre || "SISTEMA",
        accion: "EXPORTAR_EXCEL_USUARIOS",
        descripcion: `Exportados ${usuarios.length} usuarios a Excel`,
        modulo: "USUARIOS",
        tabla: "tbl_ms_usuario",
        estado: "EXITO",
        req
      });
    } catch (bitError) {
      console.error("Error registrando bitácora:", bitError);
    }

  } catch (error) {
    console.error("❌ Error exportando Excel de usuarios:", error);
    res.status(500).json({ success: false, message: "Error al generar el archivo Excel: " + error.message });
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
      descripcion: `Usuario ${nombreUsuario} (ID ${id}) eliminado permanentemente`,
      modulo: "USUARIOS",
      idRegistro: id,
      tabla: "tbl_ms_usuario",
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