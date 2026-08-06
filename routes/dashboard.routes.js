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
      SELECT u."ID_USUARIO", u."USUARIO", u."NOMBRE_USUARIO", u."CORREO_ELECTRONICO", u."ESTADO", r."ROL", r."ID_ROL"
      FROM "TBL_MS_USUARIO" u
      INNER JOIN "TBL_MS_ROLES" r ON u."ID_ROL" = r."ID_ROL"
      WHERE u."USUARIO" = $1
    `, [usuario]);

    const userData = resultadoUser.rows;

    if (userData.length === 0) {
      return res.redirect("/auth/login");
    }

    const rol = userData[0].ROL;
    const nombreUsuario = userData[0].NOMBRE_USUARIO;
    const email = userData[0].CORREO_ELECTRONICO || null;
    const estado = userData[0].ESTADO;
    const esNuevo = (estado && estado.toUpperCase() === 'NUEVO') || esPrimerIngreso;

    let stats = { pacientes: 0, citasHoy: 0, consultasDiarias: 0, medicamentos: 0 };
    if (!esNuevo) {
      if (rol === 'ADMINISTRADOR' || rol === 'ENFERMERA') {
        const resPacientes = await db.query(`SELECT COUNT(*) as total FROM "TBL_PACIENTE" WHERE "ESTADO" = 'ACTIVO'`);
        stats.pacientes = resPacientes.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR' || rol === 'RECEPCIONISTA') {
        const resCitas = await db.query(`SELECT COUNT(*) as total FROM "TBL_CITAS" WHERE DATE("FECHA_CITA") = CURRENT_DATE`);
        stats.citasHoy = resCitas.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR' || rol === 'DOCTOR') {
        const resConsultas = await db.query(`SELECT COUNT(*) as total FROM "TBL_CONSULTA_MEDICA" WHERE DATE("FECHA_CONSULTA") = CURRENT_DATE`);
        stats.consultasDiarias = resConsultas.rows[0]?.total || 0;
      }
      if (rol === 'ADMINISTRADOR') {
        const resMed = await db.query(`SELECT COUNT(*) as total FROM "TBL_INVENTARIO_MEDICAMENTOS" WHERE "ESTADO" = 'ACTIVO'`);
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

    const resUser = await db.query(`SELECT "ID_ROL" FROM "TBL_MS_USUARIO" WHERE "USUARIO" = $1`, [usuario]);
    const userData = resUser.rows;
    if (userData.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const idRol = userData[0].ID_ROL;
    const resPermisos = await db.query(`
      SELECT p."ID_OBJETO" as id, p."PERMISO_CONSULTA" as consulta, o."OBJETO" as nombre, o."TIPO_OBJETO" as tipo
      FROM "TBL_PERMISOS" p
      INNER JOIN "TBL_OBJETOS" o ON p."ID_OBJETO" = o."ID_OBJETO"
      WHERE p."ID_ROL" = $1
      ORDER BY o."ID_OBJETO"
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
      SELECT "ID_USUARIO", "CONTRASENA", "ESTADO" 
      FROM "TBL_MS_USUARIO" 
      WHERE "USUARIO" = $1
    `, [usuario]);

    const userData = resUser.rows;

    if (userData.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const userId = userData[0].ID_USUARIO;
    const hashedPassword = userData[0].CONTRASENA;
    const estadoActual = userData[0].ESTADO || '';

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
    const nuevoEstado = estadoActual.toUpperCase() === 'NUEVO' ? 'ACTIVO' : estadoActual;

    await db.query(`
      UPDATE "TBL_MS_USUARIO" 
      SET "CONTRASENA" = $1, 
          "ESTADO" = $2,
          "FECHA_MODIFICACION" = NOW(),
          "USUARIO_MODIFICACION" = $3
      WHERE "ID_USUARIO" = $4
    `, [newHashedPassword, nuevoEstado, usuario, userId]);

    await db.query(`
      INSERT INTO "TBL_MS_BITACORA" (
        "ID_USUARIO", "ACCION", "DESCRIPCION", "MODULO", "ID_REGISTRO", 
        "TABLA", "IP_CLIENTE", "USER_AGENT", "ESTADO", "DETALLE_ERROR", "ORIGEN", "FECHA"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    `, [
      userId,
      'CAMBIO_CONTRASENA',
      `Usuario ${usuario} cambió su contraseña${estadoActual === 'NUEVO' ? ' (primer ingreso)' : ''}`,
      'SEGURIDAD',
      userId,
      'TBL_MS_USUARIO',
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
      SELECT r."ROL"
      FROM "TBL_MS_USUARIO" u
      INNER JOIN "TBL_MS_ROLES" r ON u."ID_ROL" = r."ID_ROL"
      WHERE u."USUARIO" = $1
    `, [usuario]);
    const userData = resUser.rows;
    const rol = userData[0]?.ROL || '';
    let stats = { pacientesActivos: 0, citasHoy: 0, consultasHoy: 0, medicamentosActivos: 0 };
    
    if (rol === 'ADMINISTRADOR' || rol === 'ENFERMERA') {
      const p = await db.query(`SELECT COUNT(*) as total FROM "TBL_PACIENTE" WHERE "ESTADO" = 'ACTIVO'`);
      stats.pacientesActivos = p.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR' || rol === 'RECEPCIONISTA') {
      const c = await db.query(`SELECT COUNT(*) as total FROM "TBL_CITAS" WHERE DATE("FECHA_CITA") = CURRENT_DATE`);
      stats.citasHoy = c.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR' || rol === 'DOCTOR') {
      const co = await db.query(`SELECT COUNT(*) as total FROM "TBL_CONSULTA_MEDICA" WHERE DATE("FECHA_CONSULTA") = CURRENT_DATE`);
      stats.consultasHoy = co.rows[0]?.total || 0;
    }
    if (rol === 'ADMINISTRADOR') {
      const m = await db.query(`SELECT COUNT(*) as total FROM "TBL_INVENTARIO_MEDICAMENTOS" WHERE "ESTADO" = 'ACTIVO'`);
      stats.medicamentosActivos = m.rows[0]?.total || 0;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Error al cargar las estadísticas' });
  }
});

module.exports = router;