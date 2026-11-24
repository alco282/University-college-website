const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient } = require('../config/database');

/**
 * Creates a rate limiter instance backed by Redis.
 * Falls back to in-memory if Redis connection is temporarily unavailable.
 *
 * @param {object} options
 * @param {number} options.windowMs - Window time in milliseconds
 * @param {number} options.max - Max requests per window
 * @param {string} options.prefix - Redis key prefix
 * @param {string} options.message - Error message returned on breach
 */
function createDistributedLimiter({ windowMs, max, prefix, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Keep IP as the primary partition and add a normalized account/email
      // identifier for authentication and OTP endpoints to resist distributed
      // password-spraying and OTP guessing.
      const ip = req.realClientIp || req.ip || '127.0.0.1';
      if ((prefix === 'auth' || prefix === 'otp') && req.body?.identifier) {
        return `${ip}:acct:${String(req.body.identifier).trim().toLowerCase()}`;
      }
      if (prefix === 'otp' && req.body?.email) {
        return `${ip}:email:${String(req.body.email).trim().toLowerCase()}`;
      }
      return ip;
    },
    handler: (req, res) => {
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.'
      });
    },
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: `rl:${prefix}:`
    })
  });
}

// 1. Global API Limiter: 3000 requests per 15 minutes per IP
const globalApiLimiter = createDistributedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12000,
  prefix: 'global',
  message: 'System traffic threshold exceeded. Please try again shortly.'
});

// 2. Authentication Limiter: 15 attempts per 5 minutes per IP (Brute-force protection)
const authLimiter = createDistributedLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  prefix: 'auth',
  message: 'Too many authentication attempts. Access locked for 5 minutes.'
});

// 3. Sensitive Actions Limiter: OTP requests (5 per 10 minutes per IP)
const otpRequestLimiter = createDistributedLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  prefix: 'otp',
  message: 'Too many verification code requests. Please wait 10 minutes.'
});

// 4. File Upload Limiter: 30 uploads per 10 minutes per IP
const uploadLimiter = createDistributedLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  prefix: 'upload',
  message: 'Upload quota reached. Please wait before submitting more files.'
});

module.exports = {
  globalApiLimiter,
  authLimiter,
  otpRequestLimiter,
  uploadLimiter
};