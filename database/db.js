const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  family: 4 // <-- ESTA LÍNEA FORZA A IPv4 Y EVITA EL ERROR ENETUNREACH
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("¡Conexión exitosa a PostgreSQL / Supabase!");
    client.release();
  } catch (err) {
    console.error("Error al conectar con PostgreSQL:", err.message);
  }
}

testConnection();

module.exports = pool;