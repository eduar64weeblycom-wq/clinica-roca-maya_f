const express = require("express");
const router = express.Router();
const db = require('../database/db');
const { verificarSesion } = require("../middleware/auth.middleware");
const verificarPrimerIngreso = require("../middleware/verificarPrimerIngreso");
const bcrypt = require('bcrypt');

router.use(verificarSesion);
router.use(verificarPrimerIngreso);

// ============================================================
// DASHBOARD PRINCIPAL
// ============================================================
router.get("/", async (req, res) => {
  try {
    const usuario = req.usuarioActual;
    const esPrimerIngreso = req.esPrimerIngreso || false;

    const resultadoUser = await db.query(`
      SELECT u.id_usuario, u.usuario, u.nombre_usuario, u.correo_electronico, r.rol, r.id_rol
      FROM tbl_ms_usuario u
      INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol
      WHERE u.usuario = $1
    `, [usuario]);

    const userData = resultadoUser.rows;

    if (userData.length === 0) {
      return res.redirect("/auth/login");
    }

    const rol = userData[0].rol;
    const nombreUsuario = userData[0].nombre_usuario;
    const email = userData[0].correo_electronico || null;
    const esNuevo = esPrimerIngreso;

    let stats = { pacientes: 0, citasHoy: 0, consultasDiarias: 0, medicamentos: 0 };
    if (!esNuevo) {
      if (rol === 'ADMINISTRADOR' || rol === 'ENFERMERA') {
        const resPacientes = await db.query(`SELECT COUNT(*) as total FROM tbl_paciente WHERE estado = 'ACTIVO'`);
        stats.pacientes = resPacientes.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR' || rol === 'RECEPCIONISTA') {
        const resCitas = await db.query(`SELECT COUNT(*) as total FROM tbl_citas WHERE DATE(fecha_cita) = CURRENT_DATE`);
        stats.citasHoy = resCitas.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR' || rol === 'DOCTOR') {
        const resConsultas = await db.query(`SELECT COUNT(*) as total FROM tbl_consulta_medica WHERE DATE(fecha_consulta) = CURRENT_DATE`);
        stats.consultasDiarias = resConsultas.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR') {
        const resMed = await db.query(`SELECT COUNT(*) as total FROM tbl_inventario_medicamentos WHERE estado = 'ACTIVO'`);
        stats.medicamentos = resMed.rows[0]?.total || 0;
      }
    }

    res.render("dashboard", {
      rol, nombreUsuario, usuario, email, stats,
      esPrimerIngreso: esNuevo
    });

  } catch (error) {
    console.error("Error en dashboard:", error);
    res.status(500).send("Error al cargar el dashboard");
  }
});

router.get("/dashboard", async (req, res) => {
  res.redirect("/dashboard");
});

router.get('/permisos', async (req, res) => {
  try {
    const usuario = req.usuarioActual;
    if (!usuario) return res.status(401).json({ error: 'No autenticado' });

    const resUser = await db.query(`SELECT id_rol FROM tbl_ms_usuario WHERE usuario = $1`, [usuario]);
    const userData = resUser.rows;
    if (userData.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const idRol = userData[0].id_rol;
    const resPermisos = await db.query(`
      SELECT p.id_objeto as id, p.permiso_consulta as consulta, o.objeto as nombre, o.tipo_objeto as tipo
      FROM tbl_permisos p
      INNER JOIN tbl_objetos o ON p.id_objeto = o.id_objeto
      WHERE p.id_rol = $1
      ORDER BY o.id_objeto
    `, [idRol]);

    res.json({ success: true, rol: idRol, permisos: resPermisos.rows });
  } catch (error) {
    console.error('Error al obtener permisos:', error);
    res.status(500).json({ success: false, error: 'Error al cargar los permisos' });
  }
});

// ============================================================
// CAMBIAR CONTRASEÑA
// ============================================================
router.post('/cambiar-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const usuario = req.usuarioActual;

    if (!usuario) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    if (newPassword.length < 9 || newPassword.length > 15) {
      return res.status(400).json({ 
        success: false, 
        error: 'La contraseña debe tener entre 9 y 15 caracteres' 
      });
    }

    const resUser = await db.query(`
      SELECT id_usuario, contrasena 
      FROM tbl_ms_usuario 
      WHERE usuario = $1
    `, [usuario]);

    const userData = resUser.rows;

    if (userData.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const userId = userData[0].id_usuario;
    const hashedPassword = userData[0].contrasena;

    const isMatch = await bcrypt.compare(currentPassword, hashedPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Contraseña actual incorrecta' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, hashedPassword);
    if (isSamePassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'La nueva contraseña no puede ser igual a la contraseña actual' 
      });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(`
      UPDATE tbl_ms_usuario 
      SET contrasena = $1, 
          fecha_modificacion = NOW(),
          usuario_modificacion = $2
      WHERE id_usuario = $3
    `, [newHashedPassword, usuario, userId]);

    // Registro en bitácora con los nombres correctos de columnas
    await db.query(`
      INSERT INTO tbl_ms_bitacora (
        id_usuario, accion, descripcion, modulo, 
        tabla_afectada, ip_cliente, user_agent, estado_operacion, detalle_error, usuario_creacion, fecha_hora
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      userId,
      'CAMBIO_CONTRASENA',
      `Usuario ${usuario} cambió su contraseña`,
      'SEGURIDAD',
      'tbl_ms_usuario',
      req.ip || null,
      req.headers['user-agent'] || null,
      'EXITO',
      null,
      usuario
    ]);

    res.json({ 
      success: true, 
      message: 'Contraseña cambiada exitosamente',
      primerIngreso: false,
      recargar: true
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor: ' + error.message 
    });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const usuario = req.usuarioActual;
    const resUser = await db.query(`
      SELECT r.rol
      FROM tbl_ms_usuario u
      INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol
      WHERE u.usuario = $1
    `, [usuario]);
    const userData = resUser.rows;
    const rol = userData[0]?.rol || '';
    let stats = { pacientesActivos: 0, citasHoy: 0, consultasHoy: 0, medicamentosActivos: 0 };

    if (rol === 'ADMINISTRADOR' || rol === 'ENFERMERA') {
      const p = await db.query(`SELECT COUNT(*) as total FROM tbl_paciente WHERE estado = 'ACTIVO'`);
      stats.pacientesActivos = p.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR' || rol === 'RECEPCIONISTA') {
      const c = await db.query(`SELECT COUNT(*) as total FROM tbl_citas WHERE DATE(fecha_cita) = CURRENT_DATE`);
      stats.citasHoy = c.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR' || rol === 'DOCTOR') {
      const co = await db.query(`SELECT COUNT(*) as total FROM tbl_consulta_medica WHERE DATE(fecha_consulta) = CURRENT_DATE`);
      stats.consultasHoy = co.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR') {
      const m = await db.query(`SELECT COUNT(*) as total FROM tbl_inventario_medicamentos WHERE estado = 'ACTIVO'`);
      stats.medicamentosActivos = m.rows[0]?.total || 0;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Error al cargar las estadísticas' });
  }
});

module.exports = router;