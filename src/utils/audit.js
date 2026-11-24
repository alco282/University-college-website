const { randomUUID } = require('crypto');
const { pool } = require('../config/database');

const SENSITIVE_KEYS = /password|token|secret|pepper|authorization|cookie|code_hash/i;

function redactAuditState(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redactAuditState(v, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactAuditState(val, depth + 1);
  }
  return out;
}

/**
 * Logs an administrative, authentication, or mutation action into the immutable audit_logs table.
 *
 * @param {import('express').Request} req
 * @param {string|null} userId - Unique identifier of acting subject
 * @param {string} userName - Display name of actor
 * @param {string} userRole - Role of actor (e.g., student, admin, superadmin)
 * @param {string} action - Action descriptor identifier
 * @param {object|null} previousState - Snapshot prior to change
 * @param {object|null} newState - Snapshot subsequent to change
 */
async function recordAuditLog(req, userId, userName, userRole, action, previousState = null, newState = null) {
  const id = `log-${randomUUID()}`;
  const ip = req?.realClientIp || req?.socket?.remoteAddress || '127.0.0.1';
  const userAgent = req?.headers ? (req.headers['user-agent'] || 'Unknown Client') : 'System Internal';

  try {
    await pool.query(
      `INSERT INTO audit_logs (
        id, user_id, user_name, user_role, action, ip_address, user_agent, previous_state, new_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        userId || null,
        userName || 'System',
        userRole || 'system',
        action,
        ip,
        userAgent,
        previousState ? JSON.stringify(previousState) : null,
        newState ? JSON.stringify(newState) : null
      ]
    );
  } catch (err) {
    // Fail-safe error output; failure to write audit logs must never compromise primary response path
    console.error('[AUDIT LOGGING FAILURE]:', err.message);
  }
}

module.exports = {
  recordAuditLog
};