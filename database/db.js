const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false // Necesario para conexiones remotas seguras como Supabase
  },
  family: 4, // ⚠️ ESTA LÍNEA ES CLAVE: Fuerza IPv4 y evita el error ECONNREFUSED en Render
  max: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
});

pool.on('connect', () => {
  console.log('✅ Conexión exitosa a PostgreSQL / Supabase!');
});

pool.on('error', (err) => {
  console.error('Error inesperado en el cliente de PostgreSQL:', err);
});

module.exports = pool;