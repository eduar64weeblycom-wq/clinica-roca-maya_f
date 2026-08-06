const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // PostgreSQL pool (pg)
const { registrarBitacora } = require('../services/bitacora.service');
const bcrypt = require('bcrypt');

// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================================
function ensureAuthenticated(req, res, next) {
  if (req.user) return next();
  res.redirect('/auth/login');
}

// ============================================================
// DASHBOARD - Página principal (CON DATOS FRESCOS)
// ============================================================
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const usuario = req.user;

    // ============================================================
    // OBTENER TELÉFONO PROFESIONAL FRESCO DESDE LA BD
    // ============================================================
    const { rows: userRows } = await pool.query(
      'SELECT telefono_profesional AS "TELEFONO_PROFESIONAL" FROM tbl_ms_usuario WHERE id_usuario = $1',
      [usuario.ID_USUARIO]
    );
    const telefonoProfesional = userRows[0]?.TELEFONO_PROFESIONAL || '';

    // Actualizar req.user para mantener sincronía
    req.user.TELEFONO_PROFESIONAL = telefonoProfesional;

    // ============================================================
    // ESTADÍSTICAS
    // ============================================================
    const hoy = new Date().toISOString().split('T')[0];

    const { rows: pacientesRows } = await pool.query(
      "SELECT COUNT(*) AS total FROM tbl_paciente WHERE estado = 'ACTIVO'"
    );
    const pacientes = parseInt(pacientesRows[0]?.total || 0, 10);

    const { rows: citasRows } = await pool.query(
      "SELECT COUNT(*) AS total FROM tbl_citas WHERE DATE(fecha_cita) = $1 AND estado IN ('PROGRAMADA','CONFIRMADA','PRECLINICA','CONSULTA_MEDICA')",
      [hoy]
    );
    const citasHoy = parseInt(citasRows[0]?.total || 0, 10);

    const { rows: consultasRows } = await pool.query(
      "SELECT COUNT(*) AS total FROM tbl_consulta_medica WHERE DATE(fecha_consulta) = $1",
      [hoy]
    );
    const consultasDiarias = parseInt(consultasRows[0]?.total || 0, 10);

    const { rows: medicamentosRows } = await pool.query(
      "SELECT COUNT(*) AS total FROM tbl_inventario_medicamentos WHERE estado = 'ACTIVO'"
    );
    const medicamentos = parseInt(medicamentosRows[0]?.total || 0, 10);

    const stats = {
      pacientes,
      citasHoy,
      consultasDiarias,
      medicamentos
    };

    // ============================================================
    // VARIABLES PARA LA VISTA
    // ============================================================
    const esPrimerIngreso = usuario.ESTADO === 'NUEVO';

    res.render('dashboard', {
      nombreUsuario: usuario.NOMBRE_USUARIO || 'Usuario',
      rol: usuario.ROL || 'DOCTOR',
      usuario: usuario.USUARIO || '',
      email: usuario.CORREO_ELECTRONICO || '',
      esPrimerIngreso: esPrimerIngreso,
      telefonoProfesional: telefonoProfesional,
      stats: stats
    });

  } catch (error) {
    console.error('❌ Error en dashboard:', error);
    res.status(500).send('Error al cargar el dashboard');
  }
});

// ============================================================
// CAMBIAR CONTRASEÑA (CON VALIDACIÓN DE DUPLICADO Y BITÁCORA DETALLADA)
// ============================================================
router.post('/cambiar-password', ensureAuthenticated, async (req, res) => {
  try {
    const usuario = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Faltan campos' });
    }

    if (newPassword.length < 9 || newPassword.length > 15) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener entre 9 y 15 caracteres' });
    }

    const { rows } = await pool.query(
      'SELECT contrasena FROM tbl_ms_usuario WHERE id_usuario = $1',
      [usuario.ID_USUARIO]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const valid = await bcrypt.compare(currentPassword, rows[0].contrasena);
    if (!valid) {
      return res.status(400).json({ success: false, error: 'Contraseña actual incorrecta' });
    }

    const mismaContrasena = await bcrypt.compare(newPassword, rows[0].contrasena);
    if (mismaContrasena) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña debe ser diferente a la actual' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE tbl_ms_usuario 
       SET contrasena = $1, estado = 'ACTIVO', fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $2 
       WHERE id_usuario = $3`,
      [hashed, usuario.USUARIO, usuario.ID_USUARIO]
    );

    // ========== BITÁCORA MEJORADA ==========
    await registrarBitacora({
      usuario: usuario.USUARIO,
      accion: 'CAMBIO_CONTRASEÑA',
      descripcion: `El usuario ${usuario.USUARIO} (${usuario.NOMBRE_USUARIO}) cambió su contraseña de acceso al sistema.`,
      modulo: 'PERFIL',
      idRegistro: usuario.ID_USUARIO,
      tabla: 'TBL_MS_USUARIO',
      estado: 'EXITO',
      req
    });

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ============================================================
// ACTUALIZAR TELÉFONO PROFESIONAL (CON BITÁCORA DETALLADA)
// ============================================================
router.post('/actualizar-telefono', ensureAuthenticated, async (req, res) => {
  try {
    const usuario = req.user;

    if (usuario.ID_ROL !== 2) {
      return res.status(403).json({ success: false, error: 'Solo los doctores pueden actualizar este campo' });
    }

    const { telefono } = req.body;

    if (telefono && !/^\d+$/.test(telefono)) {
      return res.status(400).json({ success: false, error: 'El teléfono solo debe contener números' });
    }

    // Obtener el teléfono anterior para mostrarlo en bitácora
    const { rows: oldRow } = await pool.query(
      'SELECT telefono_profesional AS "TELEFONO_PROFESIONAL" FROM tbl_ms_usuario WHERE id_usuario = $1',
      [usuario.ID_USUARIO]
    );
    const oldTelefono = oldRow[0]?.TELEFONO_PROFESIONAL || 'Ninguno';

    await pool.query(
      `UPDATE tbl_ms_usuario 
       SET telefono_profesional = $1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $2 
       WHERE id_usuario = $3`,
      [telefono || null, usuario.USUARIO, usuario.ID_USUARIO]
    );

    // Actualizar req.user para reflejar el cambio
    req.user.TELEFONO_PROFESIONAL = telefono || '';

    const nuevoTelefono = telefono || 'Ninguno';

    // ========== BITÁCORA MEJORADA ==========
    await registrarBitacora({
      usuario: usuario.USUARIO,
      accion: 'ACTUALIZACION_TELEFONO_PROFESIONAL',
      descripcion: `El doctor ${usuario.USUARIO} (${usuario.NOMBRE_USUARIO}) actualizó su teléfono profesional de '${oldTelefono}' a '${nuevoTelefono}'.`,
      modulo: 'PERFIL',
      idRegistro: usuario.ID_USUARIO,
      tabla: 'TBL_MS_USUARIO',
      estado: 'EXITO',
      req
    });

    res.json({ success: true, message: 'Teléfono profesional actualizado correctamente', telefono: telefono || '' });
  } catch (error) {
    console.error('Error actualizando teléfono profesional:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ============================================================
// API: PERMISOS PARA EL MENÚ
// ============================================================
router.get('/permisos', ensureAuthenticated, async (req, res) => {
  try {
    const usuario = req.user;
    const { rows } = await pool.query(
      `SELECT 
         o.id_objeto AS "id", 
         p.permiso_consulta AS "consulta"
       FROM tbl_objetos o
       LEFT JOIN tbl_permisos p ON o.id_objeto = p.id_objeto AND p.id_rol = $1
       WHERE o.tipo_objeto IN ('Servicio', 'Administración', 'Seguridad', 'Farmacia')`,
      [usuario.ID_ROL]
    );
    res.json({ permisos: rows });
  } catch (error) {
    console.error('Error obteniendo permisos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;