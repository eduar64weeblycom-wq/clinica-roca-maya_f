const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("PostgreSQL pool connected successfully");
    client.release();
  } catch (err) {
    console.error("PostgreSQL connection error:", err.message);
  }
}

testConnection();

module.exports = pool;