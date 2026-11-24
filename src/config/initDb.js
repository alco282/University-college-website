const fs = require('fs');
const path = require('path');

/**
 * Initializes and validates PostgreSQL tables, foreign keys, and indexes idempotently.
 * 
 * @param {import('pg').Pool} pool - Database connection pool
 */
async function initDb(pool) {
  console.log('[DATABASE INIT]: Validating database schema integrity...');

  const schemaPath = path.resolve(__dirname, '../../schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.warn('[DATABASE INIT]: schema.sql not found at expected root path. Skipping manual execution.');
    return;
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query('COMMIT');
    console.log('[DATABASE INIT]: Database schema verified and synchronized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DATABASE INIT FATAL]: Failed applying database schema:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = initDb;