const express = require("express");
const router = express.Router();
const pool = require("../database/db");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

// ============================================================
// GET /bitacora - Página principal de bitácora
// ============================================================
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT b.FECHA_HORA, u.USUARIO, b.ACCION, b.DESCRIPCION, b.MODULO
      FROM TBL_MS_BITACORA b
      LEFT JOIN TBL_MS_USUARIO u ON b.ID_USUARIO = u.ID_USUARIO
      ORDER BY b.FECHA_HORA DESC LIMIT 50
    `);
    res.render("bitacora", { registros: rows });
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
    const [rows] = await pool.query(`
      SELECT ID_PARAMETRO, PARAMETRO, VALOR, DESCRIPCION
      FROM TBL_MS_PARAMETROS
      ORDER BY ID_PARAMETRO
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

    const promises = parametros.map(p => {
      return pool.query(
        "UPDATE TBL_MS_PARAMETROS SET VALOR = ?, FECHA_MODIFICACION = NOW() WHERE ID_PARAMETRO = ?",
        [p.valor, p.id]
      );
    });

    await Promise.all(promises);
    res.json({ ok: true, mensaje: "Todos los parámetros guardados correctamente" });
    
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
      `UPDATE TBL_MS_PARAMETROS 
       SET VALOR = ?, FECHA_MODIFICACION = NOW(), USUARIO_MODIFICACION = ? 
       WHERE ID_PARAMETRO = ?`,
      [valor, usuario || 'system', id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(" Error actualizar parámetro:", error);
    res.json({ ok: false, mensaje: "Error al actualizar el parámetro" });
  }
});

// ============================================================
// GET /bitacora/parametros/backup - Generar respaldo de la BD
// ============================================================
router.get("/parametros/backup", async (req, res) => {
  try {
    const idUsuario = req.user?.ID_USUARIO || null; 
    const nombreUsuario = req.user?.USUARIO || "ADMIN_SYSTEM";

    const dbConfig = {
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "123456",
      database: process.env.DB_NAME || "Roca_Maya"
    };

    // ============================================================
    // BUSCAR MYSQLDUMP
    // ============================================================
    function encontrarMysqldump() {
      const rutas = [
        "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe",
        "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe",
        "C:\\Program Files\\MySQL\\MySQL Server 9.0\\bin\\mysqldump.exe",
        "C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe",
        "C:\\Program Files (x86)\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe",
        "C:\\Program Files\\MySQL\\MySQL Workbench 8.0\\mysqldump.exe",
        "C:\\xampp\\mysql\\bin\\mysqldump.exe",
        "C:\\wamp64\\bin\\mysql\\mysql8.0.31\\bin\\mysqldump.exe"
      ];

      for (const ruta of rutas) {
        if (fs.existsSync(ruta)) {
          console.log(` mysqldump encontrado en: ${ruta}`);
          return ruta;
        }
      }
      return null;
    }

    const rutaMysqldump = encontrarMysqldump();

    if (!rutaMysqldump) {
      return res.status(500).send(`
        <h2> Error: No se encontró mysqldump</h2>
        <p>No se encontró el ejecutable de mysqldump en tu sistema.</p>
        <p><strong>Instala XAMPP, WAMP o MySQL Server.</strong></p>
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

    const passwordSqlDump = dbConfig.password ? `-p${dbConfig.password}` : "";
    const comando = `"${rutaMysqldump}" -h ${dbConfig.host} -u ${dbConfig.user} ${passwordSqlDump} --skip-triggers --complete-insert --add-drop-table ${dbConfig.database} > "${rutaTemporalBackup}"`;

    console.log(`🔄 Ejecutando backup con: ${rutaMysqldump}`);

    const { exec } = require('child_process');
    exec(comando, { timeout: 120000 }, async (error, stdout, stderr) => {
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
                  `INSERT INTO TBL_MS_BITACORA (FECHA_HORA, ID_USUARIO, ACCION, DESCRIPCION, MODULO)
                   VALUES (NOW(), ?, ?, ?, ?)`,
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