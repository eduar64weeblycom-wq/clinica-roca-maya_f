const pool = require('./database/db');
const bcrypt = require('bcrypt');

async function setAdmin() {
  try {
    const hash = await bcrypt.hash('Admin123*', 10);
    const resultado = await pool.query(`
      UPDATE "TBL_MS_USUARIO" 
      SET "CONTRASENA" = $1, 
          "ESTADO" = 'ACTIVO', 
          "INTENTOS_FALLIDOS" = 0, 
          "ID_ROL" = 1 
      WHERE UPPER("USUARIO") = 'ADMIN';
    `, [hash]);
    
    console.log(`¡Listo! Filas actualizadas: ${resultado.rowCount}`);
    process.exit(0);
  } catch (e) {
    console.error("Error al actualizar ADMIN:", e);
    process.exit(1);
  }
}

setAdmin();