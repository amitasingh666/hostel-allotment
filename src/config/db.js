require('dotenv').config({ quiet: true });

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 10,
  connectionTimeoutMillis: 5000,
});

// An idle connection can be dropped by the database (e.g. the container restarts).
// Without this handler that error would crash the whole process.
pool.on('error', (err) => {
  console.error('Unexpected database connection error:', err.message);
});

/**
 * Runs `work` inside a single database transaction.
 *
 * `work` receives the transaction's client and must use it for every query,
 * because all statements of a transaction have to run on the same connection.
 * Commits if `work` resolves, rolls back if it throws, and always returns
 * the connection to the pool.
 */
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Resolves if the database answers a trivial query, rejects otherwise. */
async function checkConnection() {
  await pool.query('SELECT 1');
}

module.exports = { pool, withTransaction, checkConnection };
