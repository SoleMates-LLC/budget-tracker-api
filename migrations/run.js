// migrations/run.js
// Run with: node migrations/run.js
// Rollback: node migrations/run.js rollback  (drops all tables — dev only!)
require('dotenv').config();
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }
);

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    const migrations = ['001_initial_schema.sql', '002_email_auth.sql'];
    for (const file of migrations) {
      const sqlFile = path.join(__dirname, file);
      const sql     = fs.readFileSync(sqlFile, 'utf8');
      await client.query(sql);
      console.log(`✅ ${file} applied successfully.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function rollback() {
  const client = await pool.connect();
  try {
    console.log('⚠️  Rolling back — dropping all tables...');
    await client.query(`
      DROP VIEW  IF EXISTS monthly_spending CASCADE;
      DROP TABLE IF EXISTS expenses        CASCADE;
      DROP TABLE IF EXISTS budgets         CASCADE;
      DROP TABLE IF EXISTS categories      CASCADE;
      DROP TABLE IF EXISTS refresh_tokens  CASCADE;
      DROP TABLE IF EXISTS users           CASCADE;
    `);
    console.log('✅ Rollback complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[2] === 'rollback') {
  rollback().catch(console.error);
} else {
  migrate().catch(console.error);
}
