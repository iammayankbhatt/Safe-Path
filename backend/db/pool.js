const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'safepath',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      }
);

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err.message);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('❌ DB connection test failed:', err.message);
  } else {
    console.log('✅ DB connection test passed:', result.rows[0].now);
  }
});

module.exports = pool;
