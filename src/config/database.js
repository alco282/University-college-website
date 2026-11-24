const { Pool } = require('pg');
const { createClient } = require('redis');
const env = require('./env');

// =============================================================================
// PostgreSQL Connection Pool Configuration
// =============================================================================
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 25,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000, // Terminate any query executing longer than 10s
  query_timeout: 10000
});

pool.on('error', (err) => {
  console.error('[DATABASE POOL ERROR]: Unexpected idle client destruction:', err.message);
});

// =============================================================================
// Redis Cache Client Configuration
// =============================================================================
const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('[REDIS ERROR]: Reconnect limit reached. Shutting down connection attempts.');
        return new Error('Redis connection failed permanently.');
      }
      return Math.min(retries * 200, 3000);
    }
  }
});

redisClient.on('error', (err) => {
  console.error('[REDIS CLIENT ERROR]:', err.message);
});

redisClient.on('connect', () => {
  console.log('[REDIS]: Distributed cache connection established.');
});

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('[REDIS INITIALIZATION FAILURE]:', err.message);
  }
})();

// =============================================================================
// Cache Invalidation Utilities (Resolves Missing Identifier Flaw)
// =============================================================================
async function invalidateUserCache(userId) {
  if (!userId) return;
  try {
    await redisClient.del(`cache:user:${userId}`);
  } catch (err) {
    console.error(`[CACHE ERROR]: Failed to invalidate cache for user ${userId}:`, err.message);
  }
}

// =============================================================================
// Graceful Teardown Handler
// =============================================================================
async function closeConnections() {
  console.log('[SYSTEM TEARDOWN]: Closing database and cache connection pools...');
  try {
    await pool.end();
    await redisClient.quit();
    console.log('[SYSTEM TEARDOWN]: All database interfaces closed safely.');
  } catch (err) {
    console.error('[SYSTEM TEARDOWN ERROR]:', err.message);
  }
}

module.exports = {
  pool,
  redisClient,
  invalidateUserCache,
  closeConnections
};