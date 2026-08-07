const express = require("express");
const router = express.Router();
const pool = require("../database/db"); // PostgreSQL pool (pg)
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

// ============================================================
// GET /bitacora - Página principal de bitácora
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        b.fecha_hora AS "FECHA_HORA", 
        u.usuario AS "USUARIO", 
        b.accion AS "ACCION", 
        b.descripcion AS "DESCRIPCION", 
        b.modulo AS "MODULO"
      FROM tbl_ms_bitacora b
      LEFT JOIN tbl_ms_usuario u ON b.id_usuario = u.id_usuario
      ORDER BY b.fecha_hora DESC 
      LIMIT 50
    `);
    // Renombrar a mayúsculas para la vista (si se usa directamente, la vista espera estos nombres)
    // La vista puede usar los nombres tal cual, pero para mantener compatibilidad con el frontend,
    // se puede mapear a mayúsculas, aunque en la vista de EJS se usan los mismos nombres.
    // En este caso, la vista bitacora.ejs probablemente usa FECHA_HORA, USUARIO, etc.
    // Como el frontend no está usando API JSON, sino renderizado, aseguramos que el objeto tenga los nombres esperados.
    const registros = rows.map(r => ({
      FECHA_HORA: r.FECHA_HORA,
      USUARIO: r.USUARIO,
      ACCION: r.ACCION,
      DESCRIPCION: r.DESCRIPCION,
      MODULO: r.MODULO
    }));
    res.render("bitacora", { registros });
  } catch (error) {
    console.error(" Error al cargar bitácora:", error);
    res.status(500).send("Error al cargar la bitácora");
  }
});

// ============================================================
// GET /bitacora/parametros - Página de parámetros
// ============================================================
router.get("/parametros", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id_parametro AS "ID_PARAMETRO", 
        parametro AS "PARAMETRO", 
        valor AS "VALOR", 
        descripcion AS "DESCRIPCION"
      FROM tbl_ms_parametros
      ORDER BY id_parametro
    `);
    console.log(" Parámetros encontrados:", rows.length);
    res.render("parametros", { parametros: rows });
  } catch (error) {
    console.error(" Error al cargar parámetros:", error);
    res.status(500).send("Error al cargar los parámetros");
  }
});

// ============================================================
// POST /bitacora/parametros/guardar
// ============================================================
router.post("/parametros/guardar", async (req, res) => {
  try {
    const { parametros } = req.body;

    if (!parametros || !Array.isArray(parametros)) {
      return res.json({ ok: false, mensaje: "Datos inválidos" });
    }

    // Usar transacción para actualizar todos los parámetros
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of parametros) {
        await client.query(
          "UPDATE tbl_ms_parametros SET valor = $1, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_parametro = $2",
          [p.valor, p.id]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, mensaje: "Todos los parámetros guardados correctamente" });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(" Error guardar parámetros:", err);
    res.json({ ok: false, mensaje: "Error al guardar los parámetros" });
  }
});

// ============================================================
// POST /bitacora/parametros/update
// ============================================================
router.post("/parametros/update", async (req, res) => {
  try {
    const { id, valor, usuario } = req.body;

    await pool.query(
      `UPDATE tbl_ms_parametros 
       SET valor = $1, fecha_modificacion = CURRENT_TIMESTAMP, usuario_modificacion = $2 
       WHERE id_parametro = $3`,
      [valor, usuario || 'system', id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(" Error actualizar parámetro:", error);
    res.json({ ok: false, mensaje: "Error al actualizar el parámetro" });
  }
});

// ============================================================
// GET /bitacora/parametros/backup - Generar respaldo de la BD (PostgreSQL)
// ============================================================
router.get("/parametros/backup", async (req, res) => {
  try {
    const idUsuario = req.user?.ID_USUARIO || null; 
    const nombreUsuario = req.user?.USUARIO || "ADMIN_SYSTEM";

   const dbConfig = {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };

    // ============================================================
    // BUSCAR PG_DUMP
    // ============================================================
    function encontrarPgDump() {
      // Rutas comunes en Windows
      const rutasWindows = [
        "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\13\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\12\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\11\\bin\\pg_dump.exe",
        "C:\\Program Files\\PostgreSQL\\10\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\13\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\12\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\11\\bin\\pg_dump.exe",
        "C:\\Program Files (x86)\\PostgreSQL\\10\\bin\\pg_dump.exe"
      ];

      // Rutas en Linux/macOS (si está en PATH)
      const rutasUnix = [
        "/usr/bin/pg_dump",
        "/usr/local/bin/pg_dump",
        "/opt/homebrew/bin/pg_dump",
        "/bin/pg_dump"
      ];

      // Primero intentar con which en sistemas Unix (pero mejor buscar archivos)
      // En sistemas Windows, buscar en las rutas comunes
      const isWindows = process.platform === 'win32';
      const rutas = isWindows ? rutasWindows : rutasUnix;

      for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
          console.log(` pg_dump encontrado en: ${ruta}`);
          return ruta;
        }
      }

      // Si no se encuentra, intentar con "pg_dump" en PATH (solo si está en el PATH)
      try {
        // En sistemas Unix, podemos verificar con which
        if (!isWindows) {
          const which = require('which');
          const pgDumpPath = which.sync('pg_dump', { nothrow: true });
          if (pgDumpPath) {
            console.log(` pg_dump encontrado en PATH: ${pgDumpPath}`);
            return pgDumpPath;
          }
        }
      } catch (e) {
        // Ignorar error
      }

      return null;
    }

    const rutaPgDump = encontrarPgDump();

    if (!rutaPgDump) {
      return res.status(500).send(`
        <h2> Error: No se encontró pg_dump</h2>
        <p>No se encontró el ejecutable de pg_dump en tu sistema.</p>
        <p><strong>Instala PostgreSQL y asegúrate de que pg_dump esté en el PATH.</strong></p>
      `);
    }

    // ============================================================
    // GENERAR BACKUP
    // ============================================================
    const timestampRespaldo = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/\..+/, '')
      .replace(/:/g, '-');
      
    const archivoRespaldoSql = `backup_rocamaya_${timestampRespaldo}.sql`;
    const rutaTemporalBackup = path.join(__dirname, "../", archivoRespaldoSql);

    // Construir comando pg_dump
    // Usar variables de entorno para la contraseña, o usar .pgpass
    // Para simplificar, se puede usar PGPASSWORD en el entorno
   const env = { ...process.env };
    if (dbConfig.password) {
      env.PGPASSWORD = dbConfig.password;
    }

    // Se añade --sslmode=require para permitir conexiones seguras hacia Supabase desde Render
    const comando = `"${rutaPgDump}" -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} --sslmode=require --clean --if-exists --inserts > "${rutaTemporalBackup}"`;

    console.log(`🔄 Ejecutando backup con: ${rutaPgDump}`);
    console.log(`   Comando: ${comando}`);

    exec(comando, { timeout: 120000, env }, async (error, stdout, stderr) => {
      if (fs.existsSync(rutaTemporalBackup)) {
        const stats = fs.statSync(rutaTemporalBackup);
        if (stats.size > 0) {
          console.log(` Backup generado: ${archivoRespaldoSql} (${stats.size} bytes)`);
          
          res.download(rutaTemporalBackup, archivoRespaldoSql, async (downloadError) => {
            try {
              if (fs.existsSync(rutaTemporalBackup)) {
                fs.unlinkSync(rutaTemporalBackup);
                console.log(`🗑️ Archivo temporal eliminado: ${rutaTemporalBackup}`);
              }
            } catch (fsErr) {
              console.error("Error al limpiar archivo temporal:", fsErr);
            }

            if (!downloadError) {
              try {
                await pool.query(
                  `INSERT INTO tbl_ms_bitacora (fecha_hora, id_usuario, accion, descripcion, modulo)
                   VALUES (CURRENT_TIMESTAMP, $1, $2, $3, $4)`,
                  [
                    idUsuario, 
                    "GENERAR_BACKUP", 
                    `El usuario ${nombreUsuario} generó y descargó un respaldo de la base de datos (${archivoRespaldoSql}).`,
                    "SEGURIDAD"
                  ]
                );
                console.log(` Backup registrado en bitácora: ${archivoRespaldoSql}`);
              } catch (bitacoraError) {
                console.error("Error al registrar respaldo en bitácora:", bitacoraError);
              }
            }
          });
          return;
        }
      }

      console.error(" Error al generar backup:", error?.message || stderr);
      res.status(500).send(`Error al generar backup: ${error?.message || stderr}`);
    });

  } catch (error) {
    console.error(" Error en backup:", error);
    res.status(500).send("Error al generar el respaldo: " + error.message);
  }
});

module.exports = router;