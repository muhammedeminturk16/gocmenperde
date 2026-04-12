const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL tanımlı değil. API istekleri veritabanına bağlanamayabilir.');
}

const sslEnabled = String(process.env.PG_SSL || '').toLowerCase() === 'true' || /sslmode=require/i.test(String(connectionString || ''));

const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 12),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

module.exports = { pool };
