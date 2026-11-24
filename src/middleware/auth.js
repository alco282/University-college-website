const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/database');
const { mapUserRow } = require('../utils/sanitize');

const JWT_VERIFY_OPTIONS = {
  algorithms: ['HS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE
};

/**
 * Validates the JWT from HttpOnly cookie or Authorization Bearer header.
 * Verifies session revocation using token_version in PostgreSQL.
 */
async function authenticate(req, res, next) {
  const token = req.cookies?.token || (
    req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] 
      : null
  );

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No active session token found.' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS);
    const userId = String(decoded.id);

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Account no longer exists or was deactivated.' });
    }

    const user = rows[0];

    // Anti-replay and revocation check: if token_version was incremented, reject token
    if ((user.token_version || 1) !== decoded.tokenVersion) {
      return res.status(401).json({ error: 'Session has been invalidated. Please log in again.' });
    }

    // Unverified accounts cannot access authenticated endpoints (unless superadmin)
    if (!user.verified && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Account is pending administrative verification.' });
    }

    req.user = mapUserRow(user);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return res.status(403).json({ error: 'Invalid or corrupted session signature.' });
    }
    console.error('[AUTH] Unexpected error while checking the session:', err);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please retry.' });
  }
}

/**
 * Optional authentication middleware: attaches user if token is valid,
 * but proceeds as unauthenticated guest if no token is present.
 */
async function optionalAuthenticate(req, res, next) {
  const token = req.cookies?.token || (
    req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] 
      : null
  );

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [String(decoded.id)]);
    
    if (rows.length > 0 && (rows[0].token_version || 1) === decoded.tokenVersion) {
      req.user = mapUserRow(rows[0]);
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }
  next();
}

/**
 * Enforces Role-Based Access Control (RBAC).
 * @param  {...string} roles Allowed roles ('student', 'admin', 'superadmin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient security permissions.' });
    }
    next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole
};