const path = require('path');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/database');

/**
 * Session-gated delivery of everything under /uploads.
 *
 * Replaces the old express.static mount, which served any file to anyone who
 * knew (or leaked) its URL. Rules:
 *
 *  - A valid, verified session  -> every uploaded image is served.
 *  - No session (or not verified) -> 404, EXCEPT images that belong to a
 *    visible, verified resident's PUBLIC profile content:
 *      * a profile photo / avatar whose own privacy is "public";
 *      * an image used in the resident's bacheca (cover image or photo tile)
 *        while the resident's bacheca privacy is "public".
 *    That keeps the privacy settings meaningful for the logged-out directory
 *    while every other image (hidden photos, hidden bacheca, marketplace,
 *    recipes, time capsule, concern letter, pending accounts, ...) needs a
 *    session.
 *    Set UPLOADS_ANON_PUBLIC_PHOTOS=false to require a session for ALL images.
 *
 * 404 (not 401/403) is returned to anonymous visitors so the endpoint does not
 * reveal which file names exist.
 */

const JWT_VERIFY_OPTIONS = {
  algorithms: ['HS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE
};

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:webp|png|jpe?g)$/i;
const ALLOW_ANON_PUBLIC_PHOTOS = String(process.env.UPLOADS_ANON_PUBLIC_PHOTOS || 'true').toLowerCase() !== 'false';

// A page can request 100+ avatars at once: do not hit PostgreSQL for each one.
// Session revocation (token_version bump) therefore takes effect on images
// within SESSION_CACHE_TTL_MS at most; API routes still check it on every call.
const SESSION_CACHE_TTL_MS = 30 * 1000;
const PUBLIC_CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 5000;

const sessionCache = new Map(); // userId -> { tokenVersion, ok, exp }
const publicCache = new Map();  // filename -> { ok, exp }

function remember(map, key, value, ttl) {
  if (map.size >= CACHE_MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, { ...value, exp: Date.now() + ttl });
}

async function hasValidSession(req) {
  const token = req.cookies?.token || (
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null
  );
  if (!token) return false;

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS);
  } catch {
    return false;
  }

  const userId = String(decoded.id);
  const cached = sessionCache.get(userId);
  if (cached && cached.exp > Date.now() && cached.tokenVersion === decoded.tokenVersion) {
    return cached.ok;
  }

  const { rows } = await pool.query(
    'SELECT token_version, verified, role FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  // Same acceptance rule as authenticate(): existing account, current token
  // version, and verified (superadmin is always allowed).
  const ok = Boolean(
    user &&
    (user.token_version || 1) === decoded.tokenVersion &&
    (user.verified || user.role === 'superadmin')
  );
  remember(sessionCache, userId, { tokenVersion: decoded.tokenVersion, ok }, SESSION_CACHE_TTL_MS);
  return ok;
}

// Mirrors applyServerPrivacy(): a photo is public when its own entry says so;
// an avatar that has no entry in `photos` (older accounts) counts as public.
const PUBLIC_IMAGE_SQL = `
  (WITH photo_urls AS (
    SELECT u.id, u.avatar,
           CASE WHEN jsonb_typeof(p) = 'object' THEN p->>'url' ELSE p #>> '{}' END AS url,
           CASE WHEN jsonb_typeof(p) = 'object' THEN COALESCE(p->>'privacy', 'public') ELSE 'public' END AS privacy
    FROM users u
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(u.photos) = 'array' THEN u.photos ELSE '[]'::jsonb END
    ) AS p ON TRUE
    WHERE u.is_hidden = FALSE AND u.verified = TRUE
      AND (u.avatar = $1 OR u.photos::text LIKE '%' || $1 || '%')
  )
  SELECT 1 FROM photo_urls
  WHERE (url = $1 AND privacy = 'public')
     OR (avatar = $1 AND NOT EXISTS (
          SELECT 1 FROM photo_urls pu WHERE pu.id = photo_urls.id AND pu.url = $1
        ))
  LIMIT 1)
  UNION ALL
  -- Bacheca images: public as long as the owner's bacheca privacy is public
  -- (the default when the setting is missing), mirroring applyServerPrivacy().
  (SELECT 1
   FROM users u
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(u.bacheca) = 'array' THEN u.bacheca ELSE '[]'::jsonb END
   ) AS b
   WHERE u.is_hidden = FALSE AND u.verified = TRUE
     AND COALESCE(u.privacy->>'bacheca', 'public') = 'public'
     AND jsonb_typeof(b) = 'object'
     AND (b->>'coverImage' = $1 OR (COALESCE(b->>'type', '') <> 'quote' AND b->>'content' = $1))
   LIMIT 1)
  LIMIT 1`;

async function isPublicProfileImage(filename) {
  const cached = publicCache.get(filename);
  if (cached && cached.exp > Date.now()) return cached.ok;

  const url = `/uploads/${filename}`;
  const { rowCount } = await pool.query(PUBLIC_IMAGE_SQL, [url]);
  const ok = rowCount > 0;
  remember(publicCache, filename, { ok }, PUBLIC_CACHE_TTL_MS);
  return ok;
}

async function isConcernLetterImage(filename) {
  const { rows } = await pool.query(
    `SELECT 1 FROM system_settings
      WHERE key = 'concernLetter' AND strpos(value, $1) > 0
      LIMIT 1`,
    ['/uploads/' + filename]
  );
  return rows.length > 0;
}

function createUploadsHandler(uploadsDir) {
  const root = path.resolve(uploadsDir);

  return async function serveUpload(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).end();
    }

    // Single path segment, whitelist characters: no traversal, no sub-folders.
    // Percent-encoded input is NOT decoded: a legitimate name never needs it,
    // and "%2e%2e%2f"-style tricks simply fail the whitelist.
    const filename = req.path.replace(/^\//, '');
    if (!SAFE_FILENAME_RE.test(filename)) {
      return res.status(404).end();
    }

    try {
      let allowed = await hasValidSession(req);
      if (!allowed && ALLOW_ANON_PUBLIC_PHOTOS) {
        allowed = await isPublicProfileImage(filename) || await isConcernLetterImage(filename);
      }

      // Never let a shared cache (CDN / tunnel) store an answer that depends
      // on who is asking.
      res.set('Vary', 'Cookie, Authorization');

      if (!allowed) {
        res.set('Cache-Control', 'no-store');
        return res.status(404).end();
      }

      return res.sendFile(filename, {
        root,
        dotfiles: 'deny',
        headers: {
          'Cache-Control': 'private, max-age=600',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Disposition': 'inline'
        }
      }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    } catch (err) {
      console.error('[UPLOADS ACCESS]:', err);
      if (!res.headersSent) res.status(500).end();
    }
  };
}

module.exports = { createUploadsHandler };
