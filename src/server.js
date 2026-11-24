// Must be loaded first: forwards rejected promises from async handlers to
// Express's error handler instead of letting them crash the process (-> 502).
require('./utils/asyncErrors');

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sharp = require('sharp');
const FileType = require('file-type');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { randomUUID, randomInt } = require('crypto');
const { z } = require('zod');

const usersRouter = require('./routes/users');
const commsRouter = require('./routes/comms');
const communityRouter = require('./routes/community');

// Configuration & Infrastructure
const env = require('./config/env');
const { pool, invalidateUserCache, closeConnections } = require('./config/database');
const { hashPassword, verifyPassword, safeCompare, hashOtp } = require('./utils/crypto');
const { recordAuditLog } = require('./utils/audit');
const {
  DEFAULT_AVATAR,
  getSafeUrl,
  mapUserRow,
  applyServerPrivacy
} = require('./utils/sanitize');
const { isImageSafeLocally, warmUpModeration } = require('./localModeration');
const { createUploadsHandler } = require('./middleware/uploadsAccess');
const {
  sendOtpCodeEmail,
  sendRegistrationPendingEmail,
  sendAccountApprovedEmail
} = require('./emailService');

// Middleware
const { resolveClientIp, corsMiddleware, helmetMiddleware, csrfProtection, issueCsrfToken, CSRF_COOKIE } = require('./middleware/security');
const {
  globalApiLimiter,
  authLimiter,
  otpRequestLimiter,
  uploadLimiter
} = require('./middleware/rateLimiter');
const { authenticate, optionalAuthenticate, requireRole } = require('./middleware/auth');
const { validateRequest } = require('./middleware/validate');
const { verifyTurnstileToken } = require('./middleware/turnstile');
const { isDisposableEmail } = require('./utils/disposableEmail');
const { ALLOWED_FLOORS, validateBirthInput, validateResidenceHistory, capitalizeName } = require('./utils/validation');
const { moderateRequestText } = require('./middleware/textModeration');

const app = express();

const LOCAL_COUNTRY_NAMES = (() => {
  try {
    const filePath = path.join(__dirname, '../client/public/geo-data/countriesminified.json');
    const countries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new Set(
      (Array.isArray(countries) ? countries : [])
        .map(country => String(country?.name || '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        .filter(Boolean)
    );
  } catch (err) {
    console.error('[GEO DATA]: Unable to load local country dataset:', err.message);
    return new Set();
  }
})();

function isLocalCountry(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return Boolean(normalized && LOCAL_COUNTRY_NAMES.has(normalized));
}

// =============================================================================
// Security & Reverse Proxy Setup
// =============================================================================
app.set('trust proxy', 1);
app.use(resolveClientIp);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(cookieParser());
app.use(csrfProtection);

// OWASP ASVS V11 (Resource Exhaustion): standard JSON bodies are capped at
// 100kb. Avatars/photos are NEVER accepted as inline base64 inside a JSON
// body anymore (see moderateAndNormalizeImage below) — all image data must
// go through the dedicated multipart /api/upload endpoint, which has its
// own independently-configured 15MB multer limit, file-type sniffing, and
// NSFW moderation. This closes the previous gap where large base64 payloads
// could be smuggled into any JSON endpoint via the old 2mb ceiling.
app.use(express.json({ limit: '100kb' }));
app.use('/api', globalApiLimiter);

// OWASP content-safety boundary: every JSON write outside authentication passes
// through the local two-layer text moderation gate before reaching a route.
app.use('/api', moderateRequestText);

// Uploads static directory setup
const uploadsDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Uploaded images are NOT a public static directory: every request is checked
// against the session (see middleware/uploadsAccess.js).
app.use('/uploads', createUploadsHandler(uploadsDir));

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Mount Modular API Routers
app.use('/api/users', usersRouter);
app.use('/api', commsRouter);
app.use('/api/community', communityRouter);

// =============================================================================
// Shared Helpers
// =============================================================================

// Helper for consistent error propagation
function handleServerError(res, err, message = 'An unexpected internal error occurred.') {
  console.error('[SERVER ERROR]:', err);
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A resource with these credentials already exists.' });
  }
  return res.status(500).json({ error: message });
}

// Bounded pagination parser (OWASP ASVS V11 — mirrors routes/community.js)
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

function parsePagination(req, { defaultLimit = DEFAULT_PAGE_LIMIT, maxLimit = MAX_PAGE_LIMIT } = {}) {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (offset > 100000) offset = 100000;

  return { limit, offset };
}

/**
 * Validates image references for storage on a user profile or registration
 * payload. Deliberately restrictive: only a previously-uploaded `/uploads/`
 * asset (already scanned by /api/upload's NSFW + file-type pipeline) or the
 * built-in default avatar sentinel are accepted. Inline base64 data URIs are
 * no longer accepted through JSON endpoints — this both enforces the 100kb
 * body cap above and avoids re-running expensive image moderation inline on
 * arbitrary API routes outside the dedicated, rate-limited upload path.
 */
function normalizeStoredImageRef(inputValue, { allowEmpty = true } = {}) {
  const value = (inputValue || '').toString().trim();
  if (!value) {
    return allowEmpty ? { ok: true, url: '' } : { ok: false, reason: 'An image is required.' };
  }
  if (value === DEFAULT_AVATAR) {
    return { ok: true, url: value };
  }
  if (/^\/uploads\/(?:img|avatar)-[0-9a-f-]{36}\.webp$/i.test(value)) {
    return { ok: true, url: value };
  }
  return { ok: false, reason: 'Images must be uploaded via /api/upload first; direct or inline image data is not accepted here.' };
}

// =============================================================================
// Health Check Endpoint
// =============================================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy' });
  }
});

// =============================================================================
// Authentication & Password Management
// =============================================================================
const loginSchema = z.object({
  identifier: z.string().email(),
  password: z.string().min(1).max(256),
  otpCode: z.string().regex(/^\d{6}$/).optional()
});

app.post('/api/auth/login', authLimiter, validateRequest({ body: loginSchema }), async (req, res) => {
  const { identifier, password, otpCode } = req.body;
  const cleanEmail = identifier.trim().toLowerCase();

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    if (!user.verified && user.role !== 'superadmin') {
      return res.status(403).json({
        error: 'Your account is currently under verification. You will be notified when activated.'
      });
    }

    const isPrivileged = user.role === 'superadmin' || user.is_founder === true;
    if (isPrivileged) {
      if (!otpCode) {
        // Invalidate prior codes to prevent concurrent guessing
        await pool.query(
          `DELETE FROM email_verifications WHERE email = $1 AND purpose = 'login_2fa'`,
          [cleanEmail]
        );

        // Cryptographically secure 6-digit code
        const code = randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
          `INSERT INTO email_verifications (id, email, code, purpose, expires_at, attempts)
           VALUES ($1, $2, $3, 'login_2fa', $4, 0)`,
          [`otp-${randomUUID()}`, cleanEmail, hashOtp(code), expiresAt]
        );

        sendOtpCodeEmail(cleanEmail, code, 'login_2fa').catch(console.error);
        return res.json({ require2FA: true, message: `Verification code sent to ${cleanEmail}` });
      }

      const otpResult = await consumeEmailVerificationCode({
        email: cleanEmail,
        purpose: 'login_2fa',
        code: otpCode.trim()
      });

      if (otpResult.status === 'not_found') {
        return res.status(400).json({ error: 'No active 2FA challenge found or code expired.' });
      }
      if (otpResult.status === 'locked') {
        return res.status(429).json({ error: 'Too many failed 2FA attempts. Please request a new code.' });
      }
      if (otpResult.status === 'invalid') {
        return res.status(400).json({
          error: `Invalid verification code. ${otpResult.remaining > 0 ? otpResult.remaining + ' attempts remaining.' : 'Code locked.'}`
        });
      }
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email, tokenVersion: user.token_version || 1 },
      env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256', issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE }
    );

    const isSecure = env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    issueCsrfToken(res);

    await recordAuditLog(req, user.id, user.name, user.role, 'LOGIN_SUCCESS', null, { email: user.email });
    res.json({ user: mapUserRow(user) });
  } catch (err) {
    handleServerError(res, err, 'Error processing authentication request.');
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    await invalidateUserCache(req.user.id);
  } catch (err) {
    console.error('Logout error:', err);
  }

  const isSecure = env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie('token', { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/' });
  res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: isSecure, sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/csrf', (req, res) => {
  const token = issueCsrfToken(res);
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: token });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/update-credentials - Hardened credential updates with Argon2id
const updateCredentialsSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256).optional(),
  newEmail: z.string().email().optional()
});

app.put('/api/auth/update-credentials', authenticate, validateRequest({ body: updateCredentialsSchema }), async (req, res) => {
  const { currentPassword, newPassword, newEmail } = req.body;

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

    const user = rows[0];
    const isCurrentValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isCurrentValid) {
      return res.status(400).json({ error: 'Current password verification failed.' });
    }

    let updatedHash = user.password_hash;
    if (newPassword) {
      updatedHash = await hashPassword(newPassword);
    }

    let updatedEmail = user.email;
    if (newEmail && newEmail.toLowerCase().trim() !== user.email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 AND id != $2', [newEmail.toLowerCase().trim(), req.user.id]);
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ error: 'This email is already claimed by another account.' });
      }
      updatedEmail = newEmail.toLowerCase().trim();
    }

    // Bump token_version on password changes to revoke all existing session tokens
    const { rows: updated } = await pool.query(
      `UPDATE users SET 
        password_hash = $1, 
        email = $2, 
        token_version = token_version + 1,
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3 RETURNING *`,
      [updatedHash, updatedEmail, req.user.id]
    );

    await invalidateUserCache(req.user.id);
    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, 'CREDENTIALS_UPDATE', null, { email: updatedEmail });

    // Issue refreshed token for current connection
    const token = jwt.sign(
      { id: updated[0].id, role: updated[0].role, email: updated[0].email, tokenVersion: updated[0].token_version },
      env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256', issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE }
    );

    const isSecure = env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    issueCsrfToken(res);

    res.json({ success: true, user: mapUserRow(updated[0]) });
  } catch (err) {
    handleServerError(res, err, 'Failed to update security credentials.');
  }
});

// =============================================================================
// OTP Dispatch & Verification
// =============================================================================
const sendOtpSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(['registration', 'reset_password', 'login_2fa']),
  turnstileToken: z.string().max(2048).optional().nullable()
});

app.post('/api/auth/send-otp', otpRequestLimiter, validateRequest({ body: sendOtpSchema }), async (req, res) => {
  const { email, purpose, turnstileToken } = req.body;
  const cleanEmail = email.toLowerCase().trim();

  try {
    if (purpose === 'registration') {
      const turnstile = await verifyTurnstileToken(turnstileToken, { expectedAction: 'registration_otp', remoteIp: req.ip });
      if (!turnstile.success) return res.status(403).json({ error: 'Bot verification failed. Please retry.' });
      if (isDisposableEmail(cleanEmail)) return res.status(400).json({ error: 'Temporary or disposable email addresses are not allowed for registration.' });
    }

    // Per-account throttle (dual-bucket rate limiting, alongside the
    // per-IP `otpRequestLimiter` applied above): a fresh code for the same
    // email + purpose cannot be requested more than once every 120 seconds.
    const recentCheck = await pool.query(
      `SELECT created_at FROM email_verifications 
       WHERE email = $1 AND purpose = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, purpose]
    );

    if (recentCheck.rows.length > 0) {
      const diffSeconds = Math.floor((Date.now() - new Date(recentCheck.rows[0].created_at).getTime()) / 1000);
      if (diffSeconds < 120) {
        return res.status(429).json({ error: `Please wait ${120 - diffSeconds}s before requesting a new code.` });
      }
    }

    if (purpose === 'registration') {
      const userCheck = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
      if (userCheck.rows.length > 0) {
        // Generic response to prevent harvesting existing resident accounts (ASVS V2 — anti-enumeration)
        return res.json({ success: true, message: 'If this email is eligible, a verification code will be sent.' });
      }
    }

    if (purpose === 'login_2fa') {
      const userCheck = await pool.query(
        `SELECT id FROM users
         WHERE LOWER(TRIM(email)) = $1
           AND (role = 'superadmin' OR is_founder = TRUE)`,
        [cleanEmail]
      );
      if (userCheck.rows.length === 0) {
        return res.json({ success: true, message: 'If this email is eligible, a verification code will be sent.' });
      }
    }

    if (purpose === 'reset_password') {
      const userCheck = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
      if (userCheck.rows.length === 0) {
        // Generic response to prevent user enumeration (ASVS V2)
        return res.json({ success: true, message: 'If an account exists, a code has been dispatched.' });
      }
    }

    // Short, strictly bounded expiration window (5 minutes) per ASVS V2/V3
    // OTP hardening guidance.
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (id, email, code, purpose, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`otp-${randomUUID()}`, cleanEmail, hashOtp(code), purpose, expiresAt]
    );

    sendOtpCodeEmail(cleanEmail, code, purpose).catch(console.error);
    res.json({ success: true, message: 'Verification code sent.' });
  } catch (err) {
    handleServerError(res, err, 'Failed to dispatch verification code.');
  }
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  purpose: z.enum(['registration', 'reset_password', 'login_2fa'])
});

async function consumeEmailVerificationCode({ email, purpose, code }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM email_verifications
       WHERE email = $1 AND purpose = $2 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [email, purpose]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    const record = rows[0];
    if ((record.attempts || 0) >= 5) {
      await client.query('DELETE FROM email_verifications WHERE id = $1', [record.id]);
      await client.query('COMMIT');
      return { status: 'locked' };
    }

    const ok = safeCompare(record.code, hashOtp(code));
    if (!ok) {
      await client.query(
        'UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1',
        [record.id]
      );
      await client.query('COMMIT');
      return { status: 'invalid', remaining: Math.max(0, 4 - (record.attempts || 0)) };
    }

    await client.query('DELETE FROM email_verifications WHERE id = $1', [record.id]);
    await client.query('COMMIT');
    return { status: 'ok', record };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

app.post('/api/auth/verify-otp', authLimiter, validateRequest({ body: verifyOtpSchema }), async (req, res) => {
  const { email, code, purpose } = req.body;
  const cleanEmail = email.toLowerCase().trim();

  try {
    const otpResult = await consumeEmailVerificationCode({
      email: cleanEmail,
      purpose,
      code: code.trim()
    });

    if (otpResult.status === 'not_found' || otpResult.status === 'invalid') {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }
    if (otpResult.status === 'locked') {
      return res.status(429).json({ error: 'Too many failed verification attempts. Please request a new code.' });
    }

    // Issuance of a time-limited token to complete registration and avatar upload
    let registrationToken = null;
    if (purpose === 'registration') {
      registrationToken = jwt.sign(
        { email: cleanEmail, purpose: 'registration_avatar_upload' },
        env.JWT_SECRET,
        { expiresIn: '20m', algorithm: 'HS256', issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE }
      );
    }


    res.json({ success: true, message: 'Code verified successfully.', ...(registrationToken ? { registrationToken } : {}) });
  } catch (err) {
    handleServerError(res, err, 'Error validating code.');
  }
});

// POST /api/auth/reset-password — restored (was missing entirely from the
// modular rewrite, leaving users with no way to complete a password reset
// after requesting an OTP).
const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(256)
});

app.post('/api/auth/reset-password', authLimiter, validateRequest({ body: resetPasswordSchema }), async (req, res) => {
  const { email, code, newPassword } = req.body;
  const cleanEmail = email.toLowerCase().trim();

  try {
    const otpResult = await consumeEmailVerificationCode({
      email: cleanEmail,
      purpose: 'reset_password',
      code: code.trim()
    });

    if (otpResult.status === 'not_found') {
      return res.status(400).json({ error: 'Invalid code or session expired.' });
    }
    if (otpResult.status === 'locked') {
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }
    if (otpResult.status === 'invalid') {
      return res.status(400).json({
        error: `Incorrect code. Attempts remaining: ${otpResult.remaining}`
      });
    }

    const record = otpResult.record;

    // Argon2id (legacy used bcrypt directly here, inconsistent with the
    // rest of the hardened auth stack).
    const passwordHash = await hashPassword(newPassword);

    // Bump token_version to immediately invalidate every existing session
    // for this account (ASVS V3 — session termination on credential
    // change). Legacy did not do this, leaving old sessions valid even
    // after a password reset.
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE LOWER(TRIM(email)) = $2',
      [passwordHash, cleanEmail]
    );
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
    if (userRows.length > 0) {
      await invalidateUserCache(userRows[0].id);
      await recordAuditLog(req, userRows[0].id, cleanEmail, 'system', 'PASSWORD_RESET_VIA_OTP', null, null);
    }

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    handleServerError(res, err, 'Error resetting password.');
  }
});


// Restrictive rate limiter for anonymous/pre-registration uploads (OWASP ASVS V11)
const registrationUploadLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, //15 minutes
  max: 5, // maximum 5 uploads per IP every 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload attempts during registration. Please try again later.' }
});

const uploadAvatarMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // Cap at 2MB per avatar (OWASP V11)
});

function requireRegistrationToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'A valid registration token is required to upload an avatar.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE
    });
    if (decoded.purpose !== 'registration_avatar_upload') {
      return res.status(403).json({ error: 'Invalid token purpose.' });
    }
    req.registrationEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Registration session expired or invalid. Please verify your email again.' });
  }
}



// =============================================================================
// File Uploads
// =============================================================================
app.post('/api/upload', authenticate, uploadLimiter, uploadMemory.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  try {
    const detectedType = await FileType.fromBuffer(req.file.buffer);
    if (!detectedType) {
      return res.status(400).json({ error: 'Corrupted or unreadable file format.' });
    }

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_MIME.includes(detectedType.mime)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are permitted.' });
    }

    const filename = `img-${randomUUID()}.webp`;
    const outputPath = path.join(uploadsDir, filename);

    // Moderation (CPU-bound TF.js) and the resize/WebP encode used to run one
    // after the other. They are independent, so run them together and delete
    // the output if the image turns out to be unsafe.
    const [safetyCheck] = await Promise.all([
      isImageSafeLocally(req.file.buffer),
      sharp(req.file.buffer)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outputPath)
    ]);

    if (!safetyCheck.safe) {
      fs.promises.unlink(outputPath).catch(() => {});
      return res.status(400).json({ error: safetyCheck.reason || 'Image content rejected by moderation.' });
    }

    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    handleServerError(res, err, 'Error processing file upload.');
  }
});


// =============================================================================
// File Uploads for avatar during registration
// =============================================================================
app.post('/api/auth/upload-avatar', requireRegistrationToken, registrationUploadLimiter, uploadAvatarMemory.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  try {
    const detectedType = await FileType.fromBuffer(req.file.buffer);
    if (!detectedType) {
      return res.status(400).json({ error: 'Corrupted or unreadable file format.' });
    }

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_MIME.includes(detectedType.mime)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are permitted.' });
    }

    const filename = `avatar-${randomUUID()}.webp`;
    const outputPath = path.join(uploadsDir, filename);

    // Bounded resolution specific for avatar (400x400) to mitigate DoS attacks.
    // Moderation and encoding run in parallel; unsafe output is removed.
    const [safetyCheck] = await Promise.all([
      isImageSafeLocally(req.file.buffer),
      sharp(req.file.buffer)
        .rotate()
        .resize(400, 400, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(outputPath)
    ]);

    if (!safetyCheck.safe) {
      fs.promises.unlink(outputPath).catch(() => {});
      return res.status(400).json({ error: safetyCheck.reason || 'Image content rejected by moderation.' });
    }

    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    handleServerError(res, err, 'Error processing avatar upload.');
  }
});

// =============================================================================
// Resident Directory & Profiles
// =============================================================================
app.get('/api/users', optionalAuthenticate, async (req, res) => {
  try {
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
    const { limit, offset } = parsePagination(req);

    const params = [];
    let whereClause;
    if (isAdmin) {
      whereClause = 'WHERE is_hidden = FALSE';
    } else if (req.user) {
      // Un residente vede un account in attesa solo se ha ricevuto la notifica
      // di conferma identità che lo riguarda.
      params.push(req.user.id);
      whereClause = `WHERE is_hidden = FALSE AND (
        verified = TRUE OR id IN (
          SELECT target_student_id FROM notifications
           WHERE type = 'identity_confirm'
             AND target_student_id IS NOT NULL
             AND (recipient_id = $1 OR $1 = ANY(COALESCE(recipient_ids, ARRAY[]::text[])))
        )
      )`;
    } else {
      whereClause = 'WHERE is_hidden = FALSE AND verified = TRUE';
    }

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM users ${whereClause}`, params),
      pool.query(
        `SELECT * FROM users ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      )
    ]);

    const sanitized = dataRes.rows.map((r) => applyServerPrivacy(mapUserRow(r), req.user));
    res.json({ items: sanitized, total: countRes.rows[0]?.total ?? 0, limit, offset });
  } catch (err) {
    handleServerError(res, err, 'Failed to fetch directory profiles.');
  }
});

// Registration: fields restored (floor, room, phone, instagram, linkedin,
// story, privacy) that the modular rewrite silently dropped.
// `role`, `id`, `status`, `token_version`, and every other privileged/
// server-controlled field are intentionally ABSENT from this schema — Zod
// strips any unrecognized key by default, so a client cannot self-assign
// verification or privilege state no matter what it sends (OWASP ASVS V5).
const registrationPrivacySchema = z.object({
  firstName: z.enum(['public', 'registered_only', 'private']).optional(),
  lastName: z.enum(['public', 'registered_only', 'private']).optional(),
  email: z.enum(['public', 'registered_only', 'private']).optional(),
  phone: z.enum(['public', 'registered_only', 'private']).optional(),
  instagram: z.enum(['public', 'registered_only', 'private']).optional(),
  linkedin: z.enum(['public', 'registered_only', 'private']).optional(),
  residence: z.enum(['public', 'registered_only', 'private']).optional(),
  floorRoom: z.enum(['public', 'registered_only', 'private']).optional(),
  course: z.enum(['public', 'registered_only', 'private']).optional(),
  studyLevel: z.enum(['public', 'registered_only', 'private']).optional(),
  academicYear: z.enum(['public', 'registered_only', 'private']).optional(),
  yearsInCollege: z.enum(['public', 'registered_only', 'private']).optional(),
  originLocation: z.enum(['public', 'registered_only', 'private']).optional(),
  birthDate: z.enum(['public', 'registered_only', 'private']).optional(),
  story: z.enum(['public', 'registered_only', 'private']).optional(),
  bacheca: z.enum(['public', 'registered_only', 'private']).optional(),
  residencyHistory: z.enum(['public', 'registered_only', 'private']).optional()
}).strict();

const registerUserSchema = z.object({
  firstName: z.string().min(1).max(128),
  lastName: z.string().min(1).max(128),
  email: z.string().email(),
  password: z.string().min(8).max(256),
  residence: z.enum(['Residence_name_1','Residence_name_2','Residence_name_3']),
  floor: z.enum(ALLOWED_FLOORS),
  room: z.string().regex(/^\d+$/).max(30),
  phone: z.string().max(30).optional().nullable(),
  instagram: z.string().max(60).optional().nullable(),
  linkedin: z.string().max(300).optional().nullable(),
  story: z.string().max(3000).optional().nullable(),
  privacy: registrationPrivacySchema.optional().nullable(),
  course: z.string().min(1).max(255),
  firstYearInCollege: z.coerce.number().int().min(1935).max(new Date().getFullYear()),
  firstMonthInCollege: z.coerce.number().int().min(1).max(12),
  isCurrentlyInCollege: z.boolean().default(true),
  departureYear: z.coerce.number().int().min(1935).optional().nullable(),
  departureMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
  studyLevel: z.enum(['BSc', 'MSc (Magistrale)', 'PhD']).default('BSc'),
  academicYear: z.string().default('1st Year'),
  originContinent: z.string().default('Europe'),
  originCountry: z.string().default('Italy'),
  originRegion: z.string().default('Piemonte'),
  originCity: z.string().default(''),
  coords: z.array(z.number().finite()).length(2).refine(([lat,lng]) => lat>=-90 && lat<=90 && lng>=-180 && lng<=180, 'Invalid coordinates').default([45.0683,7.6831]),
  birthDate: z.string().optional().nullable(),
  birthYear: z.coerce.number().int().optional().nullable(),
  avatar: z.string().optional(),
  residencyHistory: z.array(z.object({
    startDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    endDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
    section: z.enum(['Residence_name_1','Residence_name_2','Residence_name_3']),
    floor: z.enum(ALLOWED_FLOORS),
    room: z.string().regex(/^\d+$/).max(30)
  }).strict()).max(20).optional().nullable(),
  turnstileToken: z.string().max(2048),
  emailVerificationToken: z.string().min(1).max(2000)
});

function verifyPurposeToken(token, email, purpose) {
  if (!token || typeof token !== 'string') return false;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE
    });
    return decoded.purpose === purpose && decoded.email === email.toLowerCase().trim();
  } catch {
    return false;
  }
}

// =============================================================================
// Helper: Notify Section & Historical Peers for Endorsement (OWASP Hardened)
// =============================================================================
function parseYearMonth(ymStr, fallbackYear) {
  if (typeof ymStr === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ymStr)) {
    const [y, m] = ymStr.split('-').map(Number);
    return y * 12 + m;
  }
  const y = parseInt(fallbackYear, 10);
  return Number.isFinite(y) ? y * 12 + 1 : null;
}

function extractResidentPeriods(user) {
  const currentTotalMonths = new Date().getFullYear() * 12 + (new Date().getMonth() + 1);
  const periods = [];

  // 1. Primary residency period
  const primarySection = user.residence;
  const startYear = parseInt(user.first_year_in_college ?? user.firstYearInCollege, 10);
  const startMonth = parseInt(user.first_month_in_college ?? user.firstMonthInCollege ?? 1, 10);
  
  if (primarySection && Number.isFinite(startYear)) {
    const startIdx = startYear * 12 + (Number.isFinite(startMonth) ? startMonth : 1);
    let endIdx = currentTotalMonths;

    const inCollege = user.is_currently_in_college ?? user.isCurrentlyInCollege;
    const depYear = parseInt(user.departure_year ?? user.departureYear, 10);
    if (!inCollege && Number.isFinite(depYear)) {
      const depMonth = parseInt(user.departure_month ?? user.departureMonth, 10);
      endIdx = depYear * 12 + (Number.isFinite(depMonth) ? depMonth : 12);
    }
    periods.push({ section: primarySection, start: startIdx, end: Math.max(startIdx, endIdx) });
  }

  // 2. Historical residency periods from residency_history JSONB
  let history = user.residency_history ?? user.residencyHistory;
  if (typeof history === 'string') {
    try { history = JSON.parse(history); } catch { history = []; }
  }

  if (Array.isArray(history)) {
    for (const h of history) {
      if (!h || !h.section || !h.startDate) continue;
      const startIdx = parseYearMonth(h.startDate);
      if (!startIdx) continue;
      const endIdx = h.endDate ? (parseYearMonth(h.endDate) || startIdx) : currentTotalMonths;
      periods.push({ section: h.section, start: startIdx, end: Math.max(startIdx, endIdx) });
    }
  }

  return periods;
}

function doResidencyPeriodsOverlap(candidatePeriods, peerPeriods) {
  for (const cp of candidatePeriods) {
    for (const pp of peerPeriods) {
      if (cp.section === pp.section) {
        // Standard interval collision: Max(startA, startB) <= Min(endA, endB)
        if (Math.max(cp.start, pp.start) <= Math.min(cp.end, pp.end)) {
          return true;
        }
      }
    }
  }
  return false;
}

async function notifySectionPeersForEndorsement(newUser) {
  try {
    if (!newUser || !newUser.id) return;

    const candidatePeriods = extractResidentPeriods(newUser);
    if (candidatePeriods.length === 0) return;

    const targetSections = Array.from(new Set(candidatePeriods.map(p => p.section)));

    const peersQuery = await pool.query(
      `SELECT id, name, first_name, last_name, residence, first_year_in_college, 
              first_month_in_college, is_currently_in_college, departure_year, departure_month, residency_history 
       FROM users 
       WHERE residence = ANY($1::text[])
         AND verified = TRUE 
         AND id != $2 
         AND is_hidden = FALSE 
       LIMIT 200`,
      [targetSections, newUser.id]
    );

    const eligiblePeers = peersQuery.rows.filter(peer => {
      const peerPeriods = extractResidentPeriods(peer);
      return doResidencyPeriodsOverlap(candidatePeriods, peerPeriods);
    });

    if (eligiblePeers.length === 0) return;

    const rawFirst = newUser.first_name || newUser.firstName || '';
    const rawLast = newUser.last_name || newUser.lastName || '';
    const candidateFullName = (newUser.name || `${rawFirst} ${rawLast}`).trim() || 'A new resident';
    const entryYear = newUser.first_year_in_college || newUser.firstYearInCollege || 'Declared period';
    const primarySection = newUser.residence || 'Residence';

    const MAX_DISPATCH = 50;
    const peersToNotify = eligiblePeers.slice(0, MAX_DISPATCH);

    for (const peer of peersToNotify) {
      const notifId = `notif-${randomUUID()}`;
      await pool.query(
        `INSERT INTO notifications (
          id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name,
          type, title, message, status, requested_channels, target_student_id, attachments
        ) VALUES (
          $1, $2, $3::text[], $4, $5, $6,
          $7, $8, $9, $10, $11::text[], $12, $13::jsonb
        )`,
        [
          notifId,
          peer.id,
          [peer.id],
          'individual',
          newUser.id,
          candidateFullName,
          'identity_confirm',
          '🤝 New Resident Identity Confirmation',
          `A new resident, ${candidateFullName} (${newUser.course || 'Student'} - Sez. ${primarySection}, entrance ${entryYear}), has registered and requires peer identity confirmation.\n\nIf you shared time in Residence with them, confirm their identity to assist in activating their profile.`,
          'pending',
          [],
          newUser.id,
          JSON.stringify([])
        ]
      );
    }
  } catch (err) {
    console.error('[PEER NOTIFICATION ERROR]:', err.message);
  }
}

app.post('/api/users/register', authLimiter, validateRequest({ body: registerUserSchema }), async (req, res) => {
  const data = req.body;
  const cleanEmail = data.email.toLowerCase().trim();

  try {
    if (!isLocalCountry(data.originCountry)) {
      return res.status(400).json({ error: 'Select a country from the local geographic dataset.' });
    }

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    if (
      data.firstYearInCollege > currentYear ||
      (data.firstYearInCollege === currentYear && data.firstMonthInCollege > currentMonth)
    ) {
      return res.status(400).json({ error: 'The first month and year in Residence cannot be in the future.' });
    }

    if (!data.isCurrentlyInCollege && (data.departureYear == null || data.departureMonth == null)) {
      return res.status(400).json({ error: 'Departure month and year are required for former residents.' });
    }

    if (data.departureYear != null && data.departureMonth != null) {
      const departureOrdinal = data.departureYear * 12 + data.departureMonth;
      const firstOrdinal = data.firstYearInCollege * 12 + data.firstMonthInCollege;
      if (departureOrdinal < firstOrdinal) {
        return res.status(400).json({ error: 'Departure month and year cannot be earlier than the first month and year in Residence.' });
      }
      if (departureOrdinal > currentYear * 12 + currentMonth) {
        return res.status(400).json({ error: 'Departure month and year cannot be in the future.' });
      }
    }

    if (data.isCurrentlyInCollege && (data.departureYear != null || data.departureMonth != null)) {
      return res.status(400).json({ error: 'Current students cannot have a departure month or year.' });
    }
    if (!verifyPurposeToken(data.emailVerificationToken, cleanEmail, 'registration_avatar_upload')) {
      return res.status(400).json({ error: 'Email verification is required before registration.' });
    }

    const avatarCheck = normalizeStoredImageRef(data.avatar);
    if (!avatarCheck.ok) {
      console.warn('[AVATAR REJECTED]:', avatarCheck.reason);
      return res.status(400).json({ error: 'The selected image is not valid. Please upload it again.' });
    }

    const turnstile = await verifyTurnstileToken(data.turnstileToken, { expectedAction: 'registration_submit', remoteIp: req.ip });
    if (!turnstile.success) return res.status(403).json({ error: 'Bot verification failed. Please retry.' });
    if (isDisposableEmail(cleanEmail)) return res.status(400).json({ error: 'Temporary or disposable email addresses are not allowed for registration.' });
    const birthCheck = validateBirthInput(
      data.birthDate
        ? (data.birthDate.includes('-') ? data.birthDate.split('-').reverse().join('/') : String(data.birthYear || ''))
        : String(data.birthYear || ''),
      { required: true }
    );
    if (!birthCheck.valid) return res.status(400).json({ error: birthCheck.error });

    if (birthCheck.birthYear >= data.firstYearInCollege) {
      return res.status(400).json({ error: 'Birth year must be earlier than the first year in Residence.' });
    }
    if (data.firstYearInCollege - birthCheck.birthYear < 16) {
      return res.status(400).json({ error: 'Applicant must be at least 16 years old at the first year in Residence.' });
    }

    const historyCheck = validateResidenceHistory(data.residencyHistory || [], {
      startDate: `${data.firstYearInCollege}-${String(data.firstMonthInCollege).padStart(2, '0')}`,
      endDate: data.isCurrentlyInCollege ? null : `${data.departureYear}-${String(data.departureMonth).padStart(2, '0')}`,
      section: data.residence
    });
    if (!historyCheck.valid) return res.status(400).json({ error: historyCheck.error });

    const emailCheck = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await hashPassword(data.password);
    const userId = `std-${randomUUID()}`;

    // All public registrations begin unverified as students
    const role = 'student';
    const isVerified = false;
    const status = 'Pending Verification';

    const safeLinkedin = data.linkedin ? getSafeUrl(data.linkedin, '') : null;

    const { rows } = await pool.query(
      `INSERT INTO users (
        id, name, first_name, last_name, email, password_hash, birth_date, birth_year,
        phone, instagram, linkedin, residence, floor, room, first_year_in_college, first_month_in_college,
        is_currently_in_college, departure_year, departure_month, course, academic_year, study_level,
        origin_continent, origin_country, origin_region, origin_city, coords, status,
        role, avatar, story, privacy, verified, residency_history, is_founder
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
        $32::jsonb, $33, $34::jsonb, FALSE
      ) RETURNING *`,
      [
        userId,
        `${capitalizeName(data.firstName).toUpperCase()} ${capitalizeName(data.lastName).toUpperCase()}`,
        capitalizeName(data.firstName),
        capitalizeName(data.lastName),
        cleanEmail,
        passwordHash,
        data.birthDate || null,
        data.birthYear || null,
        data.phone || null,
        data.instagram || null,
        safeLinkedin,
        data.residence,
        data.floor || null,
        data.room || null,
        data.firstYearInCollege,
        data.firstMonthInCollege,
        data.isCurrentlyInCollege,
        data.departureYear || null,
        data.departureMonth || null,
        data.course.trim(),
        data.academicYear,
        data.studyLevel,
        data.originContinent,
        data.originCountry,
        data.originRegion,
        data.originCity,
        data.coords,
        status,
        role,
        avatarCheck.url || DEFAULT_AVATAR,
        data.story || null,
        JSON.stringify(data.privacy || {}),
        isVerified,
        JSON.stringify(historyCheck.value)
      ]
    );

    const created = mapUserRow(rows[0]);
    if (!created.verified) {
      sendRegistrationPendingEmail(created).catch(console.error);
    }
    notifySectionPeersForEndorsement(rows[0]).catch(err => {
      console.error('[PEER ENDORSEMENT TRIGGER ERROR]:', err);
    });

    res.status(201).json(created);
  } catch (err) {
    handleServerError(res, err, 'Registration could not be completed.');
  }
});

// User approval by Admin or SuperAdmin
app.patch('/api/users/:id/approve', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: target } = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (target.length === 0) return res.status(404).json({ error: 'Resident not found.' });

    const { rows } = await pool.query(
      `UPDATE users SET
        verified = TRUE,
        status = CASE WHEN is_currently_in_college = TRUE THEN 'In Residence' ELSE 'Alumni' END
      WHERE id = $1 RETURNING *`,
      [id]
    );

    await invalidateUserCache(id);
    const approved = mapUserRow(rows[0]);
    sendAccountApprovedEmail(approved).catch(console.error);

    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `APPROVE_USER_${approved.name}`, null, { targetId: id });
    res.json(approved);
  } catch (err) {
    handleServerError(res, err, 'Failed to approve resident account.');
  }
});

// =============================================================================
// SuperAdmin Direct Account Creation — restored (was missing entirely)
// =============================================================================
const superadminCreateUserSchema = z.object({
  firstName: z.string().min(1).max(128),
  lastName: z.string().min(1).max(128),
  email: z.string().email(),
  password: z.string().min(8),
  residence: z.enum(['Residence_name_1','Residence_name_2','Residence_name_3']).default('Residence_name_1'),
  course: z.string().max(255).optional().default(''),
  // Optional: the SuperAdmin form does not always know the room. Empty strings
  // are normalised to undefined so they never reach the DB CHECK constraints.
  floor: z.preprocess(v => (v === '' ? undefined : v), z.enum(ALLOWED_FLOORS).optional().nullable()),
  room: z.preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\d+$/).max(30).optional().nullable()),
  firstYearInCollege: z.coerce.number().int().min(1935).max(new Date().getFullYear()).default(new Date().getFullYear()),
  firstMonthInCollege: z.coerce.number().int().min(1).max(12).default(1),
  isCurrentlyInCollege: z.boolean().default(true),
  departureYear: z.coerce.number().int().min(1935).optional().nullable(),
  departureMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
  academicYear: z.string().default('1st Year'),
  studyLevel: z.enum(['BSc', 'MSc (Magistrale)', 'PhD']).default('BSc'),
  originContinent: z.string().default('Europe'),
  originCountry: z.string().default('Italy'),
  originRegion: z.string().default('Piemonte'),
  originCity: z.string().default(''),
  coords: z.array(z.number()).length(2).optional(),
  // Role IS client-settable here, but only because this whole endpoint is
  // already gated to `role: superadmin` below — a privileged actor
  // deliberately vouching for a new account, not self-assignment.
  role: z.enum(['student', 'admin', 'superadmin']).default('student'),
  avatar: z.string().optional(),
  birthDate: z.string().optional().nullable(),
  birthYear: z.coerce.number().int().optional().nullable(),
  privacy: z.record(z.string()).optional().nullable()
});

app.post('/api/users/superadmin-create', authenticate, requireRole('superadmin'), validateRequest({ body: superadminCreateUserSchema }), async (req, res) => {
  const data = req.body;
  const cleanEmail = data.email.toLowerCase().trim();

  try {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    if (
      data.firstYearInCollege > currentYear ||
      (data.firstYearInCollege === currentYear && data.firstMonthInCollege > currentMonth)
    ) {
      return res.status(400).json({ error: 'The first month and year in Residence cannot be in the future.' });
    }

    if (!data.isCurrentlyInCollege && (data.departureYear == null || data.departureMonth == null)) {
      return res.status(400).json({ error: 'Departure month and year are required for former residents.' });
    }

    if (data.departureYear != null && data.departureMonth != null) {
      const departureOrdinal = data.departureYear * 12 + data.departureMonth;
      const firstOrdinal = data.firstYearInCollege * 12 + data.firstMonthInCollege;
      if (departureOrdinal < firstOrdinal) {
        return res.status(400).json({ error: 'Departure month and year cannot be earlier than the first month and year in Residence.' });
      }
      if (departureOrdinal > currentYear * 12 + currentMonth) {
        return res.status(400).json({ error: 'Departure month and year cannot be in the future.' });
      }
    }

    if (data.isCurrentlyInCollege && (data.departureYear != null || data.departureMonth != null)) {
      return res.status(400).json({ error: 'Current students cannot have a departure month or year.' });
    }
    const emailCheck = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const avatarCheck = normalizeStoredImageRef(data.avatar);
    if (!avatarCheck.ok) {
      console.warn('[AVATAR REJECTED]:', avatarCheck.reason);
      return res.status(400).json({ error: 'The selected image is not valid. Please upload it again.' });
    }

    const id = `std-${randomUUID()}`;
    const passwordHash = await hashPassword(data.password);
    const userAvatar = avatarCheck.url || DEFAULT_AVATAR;
    const coordsArray = Array.isArray(data.coords) && data.coords.length === 2 ? data.coords : [45.0683, 7.6831];
    const bYear = data.birthYear || (data.birthDate ? String(data.birthDate).substring(0, 4) : null);
    const inCollege = Boolean(data.isCurrentlyInCollege);
    const userStatus = data.role === 'admin' || data.role === 'superadmin'
      ? data.role
      : (inCollege ? 'In Residence' : 'Alumni');
    const userTags = [data.role, inCollege ? 'In Residence' : 'Alumni'];

    const { rows } = await pool.query(
      `INSERT INTO users (
        id, name, first_name, last_name, email, password_hash, birth_date, birth_year,
        phone, instagram, linkedin, residence, floor, room, first_year_in_college, first_month_in_college,
        is_currently_in_college, departure_year, departure_month, course, academic_year, study_level,
        origin_continent, origin_country, origin_region, origin_city, coords,
        status, role, tags, avatar, story, photos, verified, endorsements,
        is_hidden, has_seen_welcome, bacheca, privacy, residency_history, is_founder
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::jsonb,$34,$35,$36,$37,$38::jsonb,$39::jsonb,$40::jsonb,$41
      ) RETURNING *`,
      [
        id,
        `${capitalizeName(data.firstName).toUpperCase()} ${capitalizeName(data.lastName).toUpperCase()}`,
        capitalizeName(data.firstName),
        capitalizeName(data.lastName),
        cleanEmail,
        passwordHash,
        data.birthDate || null,
        bYear,
        '',
        '',
        '',
        data.residence,
        data.floor || null,
        data.room || null,
        data.firstYearInCollege,
        data.firstMonthInCollege,
        inCollege,
        inCollege ? null : data.departureYear,
        inCollege ? null : data.departureMonth,
        data.course.trim() || 'Non specificato',
        data.academicYear,
        data.studyLevel,
        data.originContinent,
        data.originCountry,
        data.originRegion,
        data.originCity,
        coordsArray,
        userStatus,
        data.role,
        userTags,
        userAvatar,
        '',
        JSON.stringify([{ url: userAvatar, privacy: 'public' }]),
        true,  // verified: TRUE — a SuperAdmin is directly vouching for this account
        [],
        false,
        false,
        JSON.stringify([]),
        JSON.stringify(data.privacy || {}),
        JSON.stringify([]),
        false
      ]
    );

    const createdUser = mapUserRow(rows[0]);
    await invalidateUserCache(id);
    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `SUPERADMIN_CREATE_USER_${createdUser.name}`, null, { targetId: id, role: data.role });

    sendAccountApprovedEmail(createdUser).catch(console.error);

    res.status(201).json(createdUser);
  } catch (err) {
    handleServerError(res, err, 'Error creating resident account.');
  }
});

// =============================================================================
// Forensic Audit Logs Endpoint
// =============================================================================
app.get('/api/audit-logs', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 300 });

    const [countRes, dataRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM audit_logs'),
      pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset])
    ]);

    res.json({ items: dataRes.rows, total: countRes.rows[0]?.total ?? 0, limit, offset });
  } catch (err) {
    handleServerError(res, err, 'Unable to query audit records.');
  }
});

// =============================================================================
// Static Assets & React Frontend Fallback
// =============================================================================
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');

if (fs.existsSync(clientBuildPath)) {
  // Serve the React production bundle
  app.use(express.static(clientBuildPath));

  // Forward all non-API and non-upload GET requests to index.html for React SPA routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// API routes never fall through to the SPA shell. Unknown API endpoints
// return a real 404 instead of being transformed into a misleading 500.
app.use('/api', (req, res, next) => {
  if (!res.headersSent) return res.status(404).json({ error: 'API endpoint not found.' });
  next();
});

// =============================================================================
// Centralized Error Handler (payload-too-large + fallback)
// =============================================================================
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'The data sent exceeds the maximum size allowed (100kb for JSON requests; use /api/upload for images).'
    });
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Uploaded file exceeds the allowed size limit.' });
  }

  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: 'Invalid multipart upload.' });
  }

  console.error('[UNHANDLED ERROR]:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err?.status || 500).json({
    error: 'An unexpected error occurred. Please try again later.'
  });
});

// =============================================================================
// Process-level Safety Nets
// =============================================================================
// A stray rejected promise (e.g. a fire-and-forget email/notification call)
// must never take the whole API down: log it and keep serving. A genuine
// uncaught exception leaves the process in an undefined state, so log it and
// exit non-zero and let Docker's restart policy bring up a clean instance.
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
  setTimeout(() => process.exit(1), 250).unref();
});

// =============================================================================
// Application Startup & Graceful Teardown
// =============================================================================
const initDb = require('./config/initDb');

initDb(pool).then(() => {
  const server = app.listen(env.PORT, async () => {
    console.log(`[BACKEND]: Server operational on port ${env.PORT} in ${env.NODE_ENV} mode.`);

    // Load the NSFW + toxicity models now (in the background) so the first
    // registration / upload does not pay the model load time.
    warmUpModeration().catch(() => {});

    // Auto-promote founder account if specified
    if (env.FOUNDER_EMAIL) {
      try {
        await pool.query(
          `UPDATE users
           SET is_founder = TRUE, role = 'superadmin', verified = TRUE
           WHERE LOWER(TRIM(email)) = $1`,
          [env.FOUNDER_EMAIL.toLowerCase().trim()]
        );
      } catch (err) {
        console.error('[FOUNDER SYNC ERROR]:', err.message);
      }
    }

    if (env.SERVICE_ACCOUNT_EMAIL) {
      try {
        const email = env.SERVICE_ACCOUNT_EMAIL.toLowerCase().trim();
        let result = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [email]);
        if (result.rows.length === 0 && env.SERVICE_ACCOUNT_PASSWORD) {
          const serviceId = `svc-${randomUUID()}`;
          const passwordHash = await hashPassword(env.SERVICE_ACCOUNT_PASSWORD);
          await pool.query(
            `INSERT INTO users (
              id, name, first_name, last_name, email, password_hash, residence, first_year_in_college,
              course, status, role, verified, is_hidden, is_founder, has_seen_welcome
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'superadmin',TRUE,TRUE,FALSE,TRUE)`,
            [serviceId, 'Portal Service Account', 'Portal', 'Service Account', email, passwordHash, 'Residence_name_1', 1935, 'System Service Account', 'SuperAdmin']
          );
        } else {
          await pool.query(
            `UPDATE users SET role = 'superadmin', verified = TRUE, is_hidden = TRUE, is_founder = FALSE
             WHERE LOWER(TRIM(email)) = $1`,
            [email]
          );
        }
      } catch (err) {
        console.error('[SERVICE ACCOUNT SYNC ERROR]:', err.message);
      }
    }
  });

  async function signalHandler(signal) {
    console.log(`[PROCESS]: Received ${signal}. Initiating graceful shutdown sequence...`);
    server.close(async () => {
      await closeConnections();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => signalHandler('SIGTERM'));
  process.on('SIGINT', () => signalHandler('SIGINT'));
}).catch((err) => {
  console.error('[FATAL]: Database schema initialization failed. Server will not start.', err);
  process.exit(1);
});
