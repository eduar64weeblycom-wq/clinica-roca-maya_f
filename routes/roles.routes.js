const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // PostgreSQL pool (pg)

// ============================================================
// GET /roles - Vista principal de roles
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { rows: roles } = await pool.query(`
      SELECT id_rol, rol, descripcion, estado, fecha_creacion 
      FROM tbl_ms_roles 
      ORDER BY id_rol
    `);
    
    const { rows: objetos } = await pool.query(`
      SELECT id_objeto, objeto, descripcion, tipo_objeto 
      FROM tbl_objetos 
      ORDER BY id_objeto
    `);
    
    const { rows: permisos } = await pool.query(`
      SELECT p.id_permiso, p.id_rol, p.id_objeto, 
             p.permiso_consulta,
             o.objeto
      FROM tbl_permisos p
      INNER JOIN tbl_objetos o ON p.id_objeto = o.id_objeto
      ORDER BY p.id_rol, o.id_objeto
    `);
    
    console.log('📋 Roles cargados:', roles.length);
    console.log('📋 Objetos cargados:', objetos.length);
    console.log('📋 Permisos cargados:', permisos.length);
    
    res.render("roles", { 
      roles,
      objetos,
      permisos,
      usuarioLogueado: req.user?.USUARIO || 'SISTEMA'
    });
  } catch (error) {
    console.error("❌ Error en GET /roles:", error);
    res.status(500).send("Error al cargar roles: " + error.message);
  }
});

// ============================================================
// API: Obtener todos los roles (para selectores)
// ============================================================
router.get("/api/roles", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id_rol, rol, descripcion, estado 
       FROM tbl_ms_roles 
       ORDER BY id_rol`
    );
    res.json({ ok: true, roles: rows });
  } catch (error) {
    console.error("❌ Error al obtener roles:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener roles" });
  }
});

// ============================================================
// API: Obtener todos los roles (alias)
// ============================================================
router.get("/api/todos", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id_rol, rol, descripcion, estado 
       FROM tbl_ms_roles 
       ORDER BY id_rol`
    );
    res.json({ ok: true, roles: rows });
  } catch (error) {
    console.error("❌ Error al obtener todos los roles:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener roles" });
  }
});

// ============================================================
// API: Obtener objetos del sistema (menús/páginas)
// ============================================================
router.get("/api/objetos", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id_objeto, objeto, descripcion, tipo_objeto 
       FROM tbl_objetos 
       ORDER BY id_objeto`
    );
    res.json({ ok: true, objetos: rows });
  } catch (error) {
    console.error("❌ Error al obtener objetos:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener objetos" });
  }
});

// ============================================================
// API: Obtener permisos de un rol específico
// ============================================================
router.get("/api/permisos/:idRol", async (req, res) => {
  try {
    const { idRol } = req.params;
    
    const { rows: permisos } = await pool.query(`
      SELECT p.id_permiso, p.id_rol, p.id_objeto, 
             p.permiso_consulta,
             o.objeto, o.descripcion AS objeto_descripcion
      FROM tbl_permisos p
      INNER JOIN tbl_objetos o ON p.id_objeto = o.id_objeto
      WHERE p.id_rol = $1
      ORDER BY o.id_objeto
    `, [idRol]);
    
    res.json({ ok: true, permisos });
  } catch (error) {
    console.error("❌ Error al obtener permisos:", error);
    res.status(500).json({ ok: false, msg: "Error al obtener permisos" });
  }
});

// ============================================================
// API: Guardar permisos de un rol (SOLO CONSULTA)
// ============================================================
router.post("/api/permisos/guardar", async (req, res) => {
  try {
    const { idRol, permisos, usuarioAccion } = req.body;
    
    if (!idRol) {
      return res.status(400).json({ ok: false, msg: "ID de rol requerido" });
    }
    
    // Eliminar permisos existentes
    await pool.query(`DELETE FROM tbl_permisos WHERE id_rol = $1`, [idRol]);
    
    if (permisos && permisos.length > 0) {
      // Construir consulta INSERT con múltiples valores
      const values = [];
      const placeholders = [];
      let paramIndex = 1;
      
      permisos.forEach(p => {
        values.push(idRol, p.idObjeto, p.consulta ? 1 : 0, usuarioAccion || 'SISTEMA');
        placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3})`);
        paramIndex += 4;
      });
      
      const query = `
        INSERT INTO tbl_permisos 
        (id_rol, id_objeto, permiso_consulta, usuario_creacion) 
        VALUES ${placeholders.join(', ')}
      `;
      
      await pool.query(query, values);
    }
    
    res.json({ ok: true, msg: "Permisos guardados exitosamente" });
  } catch (error) {
    console.error("❌ Error al guardar permisos:", error);
    res.status(500).json({ ok: false, msg: "Error al guardar permisos: " + error.message });
  }
});

// ============================================================
// API: Crear nuevo rol
// ============================================================
router.post("/api/crear", async (req, res) => {
  try {
    const { rol, descripcion, estado, usuarioAccion } = req.body;
    
    if (!rol || rol.trim() === '') {
      return res.status(400).json({ ok: false, msg: "El nombre del rol es obligatorio" });
    }

    // Validar estado: solo 'ACTIVO' o 'INACTIVO', por defecto 'ACTIVO'
    let estadoFinal = 'ACTIVO';
    if (estado) {
      const upper = estado.toUpperCase();
      if (upper === 'ACTIVO' || upper === 'INACTIVO') {
        estadoFinal = upper;
      }
    }

    const { rows: existe } = await pool.query(
      `SELECT id_rol FROM tbl_ms_roles WHERE UPPER(rol) = UPPER($1)`,
      [rol.trim()]
    );
    
    if (existe.length > 0) {
      return res.status(400).json({ ok: false, msg: "Este rol ya existe" });
    }

    const { rows: result } = await pool.query(
      `INSERT INTO tbl_ms_roles (rol, descripcion, estado, usuario_creacion) 
       VALUES ($1, $2, $3, $4)
       RETURNING id_rol`,
      [rol.trim(), descripcion || '', estadoFinal, usuarioAccion || 'SISTEMA']
    );

    const nuevoIdRol = result[0].id_rol;

    // Asignar permisos mínimos: SOLO CONSULTA en todos los objetos
    const { rows: objetos } = await pool.query(`SELECT id_objeto FROM tbl_objetos`);
    
    if (objetos.length > 0) {
      // Construir INSERT múltiple
      const values = [];
      const placeholders = [];
      let paramIndex = 1;
      
      objetos.forEach(o => {
        values.push(nuevoIdRol, o.id_objeto, 0, usuarioAccion || 'SISTEMA');
        placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3})`);
        paramIndex += 4;
      });
      
      await pool.query(`
        INSERT INTO tbl_permisos 
        (id_rol, id_objeto, permiso_consulta, usuario_creacion) 
        VALUES ${placeholders.join(', ')}
      `, values);
    }

    res.json({ 
      ok: true, 
      msg: `Rol "${rol.trim()}" creado exitosamente.`,
      id: nuevoIdRol,
      rol: rol.trim()
    });

  } catch (error) {
    console.error("❌ Error en POST /roles/api/crear:", error);
    res.status(500).json({ ok: false, msg: "Error al crear rol: " + error.message });
  }
});

// ============================================================
// API: Actualizar rol
// ============================================================
router.put("/api/actualizar/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rol, descripcion, estado, usuarioAccion } = req.body;

    if (!rol || rol.trim() === '') {
      return res.status(400).json({ ok: false, msg: "El nombre del rol es obligatorio" });
    }

    // Validar estado
    let estadoFinal = 'ACTIVO';
    if (estado) {
      const upper = estado.toUpperCase();
      if (upper === 'ACTIVO' || upper === 'INACTIVO') {
        estadoFinal = upper;
      }
    }

    const { rows: existe } = await pool.query(
      `SELECT id_rol FROM tbl_ms_roles 
       WHERE UPPER(rol) = UPPER($1) AND id_rol != $2`,
      [rol.trim(), id]
    );
    
    if (existe.length > 0) {
      return res.status(400).json({ ok: false, msg: "Ya existe otro rol con ese nombre" });
    }

    const { rowCount } = await pool.query(
      `UPDATE tbl_ms_roles 
       SET rol = $1, descripcion = $2, estado = $3,
           fecha_modificacion = CURRENT_TIMESTAMP, 
           usuario_modificacion = $4 
       WHERE id_rol = $5`,
      [rol.trim(), descripcion || '', estadoFinal, usuarioAccion || 'SISTEMA', id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }

    res.json({ ok: true, msg: "Rol actualizado exitosamente" });

  } catch (error) {
    console.error("❌ Error en PUT /roles/api/actualizar:", error);
    res.status(500).json({ ok: false, msg: "Error al actualizar rol" });
  }
});

// ============================================================
// API: Eliminar rol (solo si no tiene usuarios asociados)
// ============================================================
router.delete("/api/eliminar/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { usuarioAccion } = req.body;

    if (parseInt(id) <= 5) {
      return res.status(400).json({ 
        ok: false, 
        msg: "No se pueden eliminar roles del sistema (Administrador, Doctor, Enfermera, Recepcionista, Paciente)" 
      });
    }

    const { rows: usuarios } = await pool.query(
      `SELECT COUNT(*) as total FROM tbl_ms_usuario WHERE id_rol = $1`,
      [id]
    );

    const totalUsuarios = parseInt(usuarios[0].total, 10);
    if (totalUsuarios > 0) {
      return res.status(400).json({ 
        ok: false, 
        msg: `No se puede eliminar el rol porque tiene ${totalUsuarios} usuarios asociados.` 
      });
    }

    // Eliminar permisos asociados
    await pool.query(`DELETE FROM tbl_permisos WHERE id_rol = $1`, [id]);

    const { rows: rolData } = await pool.query(
      `SELECT rol FROM tbl_ms_roles WHERE id_rol = $1`,
      [id]
    );

    const { rowCount } = await pool.query(
      `DELETE FROM tbl_ms_roles WHERE id_rol = $1`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, msg: "Rol no encontrado" });
    }

    res.json({ ok: true, msg: `Rol "${rolData[0]?.rol || 'ID ' + id}" eliminado exitosamente` });

  } catch (error) {
    console.error("❌ Error en DELETE /roles/api/eliminar:", error);
    res.status(500).json({ ok: false, msg: "Error al eliminar rol" });
  }
});

module.exports = router;