// src/config/database.js
const { Pool } = require('pg');
const logger   = require('./logger');

// Railway and most cloud providers inject DATABASE_URL — prefer it over individual vars
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
  ...poolConfig,
  max:                     20,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    logger.error('Failed to connect to PostgreSQL', { error: err.message });
    process.exit(1);
  }
  logger.info('✅ PostgreSQL connected successfully');
  release();
});

/**
 * Convenience wrapper — runs a parameterised query and returns rows.
 * Usage: const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
 */
const query = (text, params) => pool.query(text, params);

/**
 * Transaction helper.
 * Usage:
 *   const result = await db.transaction(async (client) => {
 *     await client.query('INSERT ...');
 *     return await client.query('SELECT ...');
 *   });
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, transaction };
