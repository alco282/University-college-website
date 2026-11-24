const argon2 = require('argon2');
const crypto = require('crypto');
const env = require('../config/env');

// =============================================================================
// Argon2id Hashing Options (OWASP ASVS 2.1.1 / RFC 9106)
// =============================================================================
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,       // 3 iterations
  parallelism: 2,    // 2 parallel threads
  hashLength: 32
};

/**
 * Derives a keyed HMAC pepper to defend against offline rainbow table creation
 * in the event of database exfiltration.
 * @param {string} password 
 * @returns {string} Peppered password representation
 */
function applyPepper(password) {
  return crypto
    .createHmac('sha256', env.PASSWORD_PEPPER)
    .update(password)
    .digest('hex');
}

/**
 * Hashes a plaintext password using Argon2id with memory-hard parameters.
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password input.');
  }
  const peppered = applyPepper(password);
  return await argon2.hash(peppered, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash in constant time.
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
  if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    const peppered = applyPepper(password);
    return await argon2.verify(hash, peppered);
  } catch (err) {
    console.error('[CRYPTO VERIFICATION ERROR]:', err.message);
    return false;
  }
}

/**
 * Constant-time equality comparison between two strings to eliminate timing attacks.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
function hashOtp(code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new Error('Invalid OTP format.');
  }
  // Prefer a dedicated OTP secret; fall back to the password pepper so existing
  // deployments remain compatible while keeping OTP storage independent from
  // JWT signing keys when the new secret is configured.
  const otpSecret = env.OTP_HMAC_SECRET || env.PASSWORD_PEPPER;
  return crypto.createHmac('sha256', otpSecret).update(code).digest('hex');
}

/**
 * Constant-time equality comparison between two strings to eliminate timing attacks.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashPassword,
  verifyPassword,
  hashOtp,
  safeCompare
};