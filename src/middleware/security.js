const helmet = require('helmet');
const cors = require('cors');
const { isIP } = require('net');
const { randomBytes, timingSafeEqual } = require('crypto');
const env = require('../config/env');

// =============================================================================
// Verified Client IP Resolution Middleware (Cloudflare Tunnel Aware)
// =============================================================================
/**
 * Resolves the real client IP address for a deployment fronted by a
 * Cloudflare Tunnel (`cloudflared`).
 *
 * SECURITY MODEL / RATIONALE:
 * -----------------------------------------------------------------------
 * `cloudflared` terminates the tunnel at Cloudflare's edge and forwards the
 * request to this container over the private `app_net` Docker bridge. Along
 * the way, Cloudflare's edge attaches a `CF-Connecting-IP` header that
 * reflects the true public IP of the visitor. Critically, Cloudflare's edge
 * always overwrites any client-supplied `CF-Connecting-IP` header before it
 * reaches cloudflared — so as long as this application is reached *only*
 * through the tunnel, the header cannot be forged by an external client.
 *
 * We therefore treat `CF-Connecting-IP` as authoritative for rate-limiting,
 * audit logging, and brute-force protection, but ONLY when it is present
 * and passes strict IP-format validation (`net.isIP`). A malformed or
 * missing header is never trusted blindly.
 *
 * We deliberately do NOT trust the generic `X-Forwarded-For` header chain
 * from the public internet for this decision: unlike `CF-Connecting-IP`,
 * `X-Forwarded-For` can contain attacker-supplied entries appended in front
 * of the real chain, and correctly parsing "the right hop" requires trusting
 * the exact proxy topology. `CF-Connecting-IP` avoids that ambiguity
 * entirely when Cloudflare is the sole ingress path.
 *
 * IMPORTANT DEPLOYMENT CAVEAT (see docker-compose.yml review):
 * This guarantee holds only if the `app` container's port is NOT also
 * published directly on the Docker host. If `ports: ["5000:5000"]` remains
 * on the `app` service, an attacker who can reach the host directly bypasses
 * Cloudflare entirely and can set `CF-Connecting-IP` to any value they like.
 * This middleware cannot compensate for that exposure by itself — the fix
 * belongs in `docker-compose.yml` (remove the host port publish for `app`
 * in production and let `cloudflared` be the only ingress on `app_net`).
 * That change is scheduled later in this delivery plan; until it lands,
 * treat IP-based rate limiting and audit trails as best-effort, not proof.
 */
function resolveClientIp(req, res, next) {
  const cfIpHeader = req.headers['cf-connecting-ip'];
  const cfIp = Array.isArray(cfIpHeader) ? cfIpHeader[0] : cfIpHeader;

  if (typeof cfIp === 'string' && cfIp.trim() && isIP(cfIp.trim())) {
    req.realClientIp = cfIp.trim();
    return next();
  }

  // Fallback path: no valid CF-Connecting-IP present (e.g. local development
  // without the tunnel, or a health-check hitting the container directly).
  // Express's own proxy-aware `req.ip` is used here, which respects the
  // `trust proxy` hop count configured in server.js.
  req.realClientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  next();
}

// =============================================================================
// CSRF protection for cookie-authenticated state-changing requests
// =============================================================================
const CSRF_COOKIE = env.NODE_ENV === 'production' ? '__Host-csrf_token' : 'csrf_token';

function issueCsrfToken(res) {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  return token;
}

function csrfProtection(req, res, next) {
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!stateChanging) return next();

  // Bearer-token-only requests (e.g. registration avatar upload) are not
  // vulnerable to cookie CSRF. Cookie-authenticated requests must prove
  // possession of the same-origin-readable CSRF token.
  const hasSessionCookie = Boolean(req.cookies?.token);
  if (!hasSessionCookie) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');

  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length !== 43 ||
    headerToken.length !== 43
  ) {
    return res.status(403).json({ error: 'CSRF validation failed.' });
  }

  try {
    const a = Buffer.from(cookieToken, 'utf8');
    const b = Buffer.from(headerToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'CSRF validation failed.' });
    }
  } catch {
    return res.status(403).json({ error: 'CSRF validation failed.' });
  }

  next();
}

// =============================================================================
// Strict CORS Configuration (Exact Matching Only)
// =============================================================================
const allowedOrigins = new Set([
  env.FRONTEND_URL,
  ...(env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : [])
].filter(Boolean));

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Permit server-to-server or non-browser tools (no Origin header)
    if (!origin) {
      return callback(null, true);
    }

    // Strict exact matching to stop subdomain takeovers or suffix bypasses
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Blocked by CORS policy: Origin unauthorized.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  exposedHeaders: ['Set-Cookie']
});

// =============================================================================
// Helmet HTTP Headers Hardening
// =============================================================================
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://basemaps.cartocdn.com",
        "https://*.basemaps.cartocdn.com",
        "https://*.tile.openstreetmap.org",
        "https://open.spotify.com",
        "https://i.scdn.co"
      ],
      connectSrc: [
        "'self'",
        "https://nominatim.openstreetmap.org",
        "https://basemaps.cartocdn.com",
        "https://open.spotify.com",
        "https://challenges.cloudflare.com"
      ],
      // The Jukebox feature (see App2.js) embeds the Spotify Web Player via
      // <iframe src="https://open.spotify.com/embed/track/...">. The prior
      // `frameSrc: ["'none'"]` silently blocked this at the browser level
      // even when the backend route worked correctly. We scope the
      // allowance to exactly the Spotify embed origin — no wildcard framing
      // is permitted, so clickjacking protection for the rest of the app is
      // unaffected.
      frameSrc: ["https://open.spotify.com", "https://challenges.cloudflare.com", "https://www.google.com", "https://maps.google.com"],
      objectSrc: ["'none'"],
      // Prevent this application itself from being framed by third parties
      // (defense in depth alongside the X-Frame-Options meta tag in
      // index.html).
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
});

module.exports = {
  resolveClientIp,
  corsMiddleware,
  helmetMiddleware,
  csrfProtection,
  issueCsrfToken,
  CSRF_COOKIE
};
