const pool = require('./database/db'); // Ajusta la ruta si tu archivo de conexión está en otro lugar

async function desbloquearAdmin() {
  try {
    const query = `
      UPDATE "TBL_MS_USUARIO" 
      SET "ESTADO" = 'ACTIVO', 
          "CONTRASENA" = '$2b$10$wK1V5P9nF7v8uXp5tKxL7e3FkZ5xV5nF7v8uXp5tKxL7e3FkZ5xV',
          "INTENTOS_FALLIDOS" = 0
      WHERE "USUARIO" = 'ADMIN';
    `;
    
    await pool.query(query);
    console.log("¡Usuario ADMIN desbloqueado y contraseña restablecida con éxito!");
    process.exit(0);
  } catch (error) {
    console.error("Error al desbloquear el usuario:", error);
    process.exit(1);
  }
}

desbloquearAdmin();