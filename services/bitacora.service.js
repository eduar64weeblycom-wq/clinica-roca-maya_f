const pool = require("../database/db");

async function registrarBitacora({
  usuario,
  accion,
  descripcion,
  modulo = "AUTENTICACIÓN",
  idRegistro = null,
  tabla = null,
  estado = "ÉXITO",
  detalleError = null,
  req = null,
}) {
  try {
    let idUsuario = null;

    // Buscar el ID del usuario
    if (usuario && typeof usuario === "string") {
      const resultado = await pool.query(
        `SELECT "ID_USUARIO" FROM "TBL_MS_USUARIO" WHERE "USUARIO" = $1`,
        [usuario]
      );
      const rows = resultado.rows;
      if (rows.length) idUsuario = rows[0].ID_USUARIO;
    } else if (typeof usuario === "number") {
      idUsuario = usuario;
    }

    // Si no se encontró usuario, usar el admin por defecto
    if (!idUsuario) {
      const resultadoSys = await pool.query(
        `SELECT "ID_USUARIO" FROM "TBL_MS_USUARIO" WHERE "USUARIO" = 'ADMIN'`
      );
      const sys = resultadoSys.rows;
      idUsuario = sys && sys.length ? sys[0].ID_USUARIO : 1;
    }

    // Obtener IP y navegador (si hay req)
    const ipCliente = req
      ? req.ip ||
        req.headers["x-forwarded-for"] ||
        req.connection.remoteAddress
      : "127.0.0.1";

    const userAgent = req
      ? req.get("User-Agent") || "Desconocido"
      : "Sistema";

    // Inserción directa corregida sin ID_REGISTRO ni TABLA
    await pool.query(
      `INSERT INTO "TBL_MS_BITACORA" (
        "ID_USUARIO", "ACCION", "DESCRIPCION", "MODULO", 
        "IP_CLIENTE", "USER_AGENT", "ESTADO", "DETALLE_ERROR", "ORIGEN", "FECHA"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        idUsuario,
        accion,
        descripcion,
        modulo,
        ipCliente,
        userAgent,
        estado,
        detalleError,
        "SISTEMA_WEB",
      ]
    );
  } catch (err) {
    console.error("bitacora error:", err);
  }
}

module.exports = { registrarBitacora };