const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // PostgreSQL pool (pg)
const { registrarBitacora } = require('../services/bitacora.service');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// RUTA DE RESTAURACIÓN DE BASE DE DATOS (PostgreSQL)
// ============================================================
router.post("/restore", upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, mensaje: "Archivo no recibido" });
    }

    const tempPath = path.join(__dirname, '../temp_restore.sql');
    fs.writeFileSync(tempPath, req.file.buffer);

    // ============================================================
    // BUSCAR PG_RESTORE
    // ============================================================
    function encontrarPgRestore() {
      // Rutas comunes en Windows
      const rutasWindows = [
        "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\13\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\12\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\11\\bin\\pg_restore.exe",
        "C:\\Program Files\\PostgreSQL\\10\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\13\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\12\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\11\\bin\\pg_restore.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\10\\bin\\pg_restore.exe"
      ];

      // Rutas en Linux/macOS
      const rutasUnix = [
        "/usr/bin/pg_restore",
        "/usr/local/bin/pg_restore",
        "/opt/homebrew/bin/pg_restore",
        "/bin/pg_restore"
      ];

      const isWindows = process.platform === 'win32';
      const rutas = isWindows ? rutasWindows : rutasUnix;

      for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
          console.log(` pg_restore encontrado en: ${ruta}`);
          return ruta;
        }
      }

      // Intentar con which en Unix
      if (!isWindows) {
        try {
          const which = require('which');
          const pgRestorePath = which.sync('pg_restore', { nothrow: true });
          if (pgRestorePath) {
            console.log(` pg_restore encontrado en PATH: ${pgRestorePath}`);
            return pgRestorePath;
          }
        } catch (e) {}
      }

      return null;
    }

    const rutaPgRestore = encontrarPgRestore();

    if (!rutaPgRestore) {
      fs.unlinkSync(tempPath);
      return res.status(500).json({
        ok: false,
        mensaje: "No se encontró pg_restore en el sistema. Instale PostgreSQL y asegúrese de que esté en el PATH."
      });
    }

    // Configuración de la base de datos
    const dbConfig = {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      database: process.env.DB_NAME || "Roca_Maya"
    };

    // Usar PGPASSWORD para evitar el prompt
    const env = { ...process.env };
    if (dbConfig.password) {
      env.PGPASSWORD = dbConfig.password;
    }

    // Comando para restaurar: usar psql para archivos .sql (porque pg_restore es para formato personalizado)
    // Como el backup se genera con pg_dump --inserts, usamos psql para restaurar
    // Buscar psql
    function encontrarPsql() {
      const rutasWindows = [
        "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\12\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\11\\bin\\psql.exe",
        "C:\\Program Files\\PostgreSQL\\10\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\13\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\12\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\11\\bin\\psql.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\10\\bin\\psql.exe"
      ];

      const rutasUnix = [
        "/usr/bin/psql",
        "/usr/local/bin/psql",
        "/opt/homebrew/bin/psql",
        "/bin/psql"
      ];

      const isWindows = process.platform === 'win32';
      const rutas = isWindows ? rutasWindows : rutasUnix;

      for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
          return ruta;
        }
      }

      if (!isWindows) {
        try {
          const which = require('which');
          const psqlPath = which.sync('psql', { nothrow: true });
          if (psqlPath) return psqlPath;
        } catch (e) {}
      }

      return null;
    }

    const rutaPsql = encontrarPsql();
    if (!rutaPsql) {
      fs.unlinkSync(tempPath);
      return res.status(500).json({
        ok: false,
        mensaje: "No se encontró psql en el sistema. Instale PostgreSQL."
      });
    }

    // Comando: psql -h host -p port -U user -d database -f archivo.sql
    const comando = `"${rutaPsql}" -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${tempPath}"`;

    console.log(`🔄 Ejecutando restauración con: ${rutaPsql}`);
    console.log(`   Comando: ${comando}`);

    exec(comando, { timeout: 120000, env }, async (error, stdout, stderr) => {
      // Eliminar archivo temporal
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (err) {
        console.error("Error al eliminar archivo temporal:", err);
      }

      if (error) {
        console.error(" Error en restauración:", error);
        console.error(" stderr:", stderr);
        return res.status(500).json({
          ok: false,
          mensaje: `Error al restaurar la base de datos: ${error.message}`
        });
      }

      // Registrar en bitácora
      try {
        const usuario = req.user?.USUARIO || "SISTEMA";
        await registrarBitacora({
          usuario: usuario,
          accion: "RESTAURACION_BASE_DATOS",
          descripcion: `El usuario ${usuario} restauró la base de datos desde un archivo SQL.`,
          modulo: "SEGURIDAD",
          idRegistro: null,
          tabla: "GLOBAL",
          estado: "EXITO",
          req
        });
      } catch (bitError) {
        console.error("Error registrando restauración en bitácora:", bitError);
      }

      return res.json({
        ok: true,
        mensaje: "Restauración exitosa. La base de datos ha sido restaurada correctamente."
      });
    });

  } catch (error) {
    console.error("Error crítico en restauración:", error);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al aplicar SQL: " + error.message
    });
  }
});

// ============================================================
// FUNCIÓN DE VALIDACIÓN ESTRICTA (CON POSTGRESQL)
// ============================================================
function validarParametrosBackend(req, res, next) {
  const { parametros } = req.body;

  if (!parametros || !Array.isArray(parametros)) {
    return res.status(400).json({
      success: false,
      message: 'Formato de datos inválido'
    });
  }

  const errores = [];

  for (const param of parametros) {
    if (!param.id || !param.clave || param.valor === undefined || param.valor === '') {
      errores.push(`Faltan campos requeridos para ${param.clave}`);
      continue;
    }

    let valorLimpio = String(param.valor).replace(/[^\w\s@.-]/gi, '').trim();

    if (esParametroNumerico(param.clave)) {
      if (!/^\d+$/.test(valorLimpio)) {
        errores.push(`El parámetro ${param.clave} debe contener solo números`);
        continue;
      }

      const valorNum = parseInt(valorLimpio);

      if (valorNum < 1) {
        if (['ADMIN_PREGUNTAS', 'ADMIN_INTENTOS_INVALIDOS', 'SEGURIDAD_INTENTOS'].includes(param.clave)) {
          errores.push(`${param.clave} debe ser al menos 1`);
        } else if (param.clave === 'SEGURIDAD_LONGITUD') {
          errores.push('SEGURIDAD_LONGITUD debe ser al menos 6');
        }
      }

      param.valor = valorNum;

    } else if (esParametroTexto(param.clave)) {
      if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(valorLimpio)) {
        errores.push(`El parámetro ${param.clave} debe contener solo letras y espacios`);
        continue;
      }
    } else if (['CORREO_USUARIO', 'CORREO_DESTINATARIO', 'ADMIN_CORREO'].includes(param.clave)) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valorLimpio)) {
        errores.push(`El parámetro ${param.clave} debe ser un email válido`);
        continue;
      }
    }

    param.valor = valorLimpio;
  }

  if (errores.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Errores de validación',
      errors: errores
    });
  }

  next();
}

// ============================================================
// RUTA PARA GUARDAR PARÁMETROS (PostgreSQL)
// ============================================================
router.post('/guardar', validarParametrosBackend, async (req, res) => {
  try {
    const { parametros } = req.body;
    const usuario = req.user?.USUARIO || 'SISTEMA';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const param of parametros) {
        // Obtener valor anterior para bitácora
        const { rows: oldRows } = await client.query(
          'SELECT valor FROM tbl_ms_parametros WHERE id_parametro = $1',
          [param.id]
        );
        const valorAnterior = oldRows[0]?.valor || 'N/A';

        await client.query(
          `UPDATE tbl_ms_parametros 
           SET valor = $1, usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP 
           WHERE id_parametro = $3`,
          [param.valor, usuario, param.id]
        );

        // Registrar bitácora
        await registrarBitacora({
          usuario: usuario,
          accion: 'ACTUALIZACION_PARAMETRO',
          descripcion: `Parámetro actualizado: ${param.clave} - Valor: ${valorAnterior} -> ${param.valor}`,
          modulo: 'CONFIGURACION',
          idRegistro: param.id,
          tabla: 'TBL_MS_PARAMETROS',
          estado: 'EXITO',
          req
        });
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        message: 'Parámetros actualizados exitosamente'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error guardando parámetros:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
});

// ============================================================
// RUTA PARA OBTENER PARÁMETROS (Vista)
// ============================================================
router.get('/', async (req, res) => {
  try {
    const { rows: parametros } = await pool.query(`
      SELECT 
        id_parametro AS "ID_PARAMETRO",
        parametro AS "PARAMETRO",
        valor AS "VALOR",
        descripcion AS "DESCRIPCION"
      FROM tbl_ms_parametros
      ORDER BY id_parametro
    `);

    return res.render('parametros', { parametros });
  } catch (error) {
    console.error('Error obteniendo parámetros:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener parámetros'
    });
  }
});

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================
function esParametroNumerico(clave) {
  const parametrosNumericos = [
    'ADMIN_INTENTOS_INVALIDOS', 'ADMIN_TIEMPO_SESION', 'ADMIN_PREGUNTAS',
    'SEGURIDAD_INTENTOS', 'SEGURIDAD_LONGITUD', 'CORREO_PUERTO'
  ];
  return parametrosNumericos.includes(clave);
}

function esParametroTexto(clave) {
  const parametrosTexto = [
    'ADMIN_NOMBRE_SISTEMA', 'ADMIN_PAIS', 'ADMIN_IDIOMA'
  ];
  return parametrosTexto.includes(clave);
}

module.exports = router;