const env = require('../config/env');

function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const cleanIp = ip.replace(/^::ffff:/, '').trim();
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') return false;
  // Exclude RFC 1918 private ranges and link-local addresses
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(cleanIp)) return false;
  if (/^(169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(cleanIp)) return false;
  return true;
}

async function verifyTurnstileToken(token, { expectedAction, remoteIp } = {}) {
  // Allow dev bypass strictly outside of production
  const isDev = env.NODE_ENV !== 'production';
  if (isDev && (!token || token === 'dev-bypass-token' || !env.TURNSTILE_SECRET_KEY)) {
    return { success: true, devBypass: true };
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: false, errorCodes: ['missing-secret-key'] };
  }

  if (!token || typeof token !== 'string' || token.length > 2048) {
    return { success: false, errorCodes: ['invalid-token-format'] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const form = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token
    });

    // Cloudflare rejects localhost or private IPs with invalid-remoteip
    if (remoteIp && isPublicIp(remoteIp)) {
      form.set('remoteip', remoteIp);
    }

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal
    });

    if (!response.ok) return { success: false, errorCodes: ['cloudflare-api-error'] };

    const result = await response.json();
    if (!result.success) {
      return { success: false, errorCodes: result['error-codes'] || [] };
    }

    // Determine if Cloudflare test mode or official dummy keys are being used
    const isDummySecret = String(env.TURNSTILE_SECRET_KEY).startsWith('1x00000000000000000000');
    const isTestMode =
      env.TURNSTILE_TEST_MODE === true ||
      String(env.TURNSTILE_TEST_MODE).toLowerCase() === 'true' ||
      isDummySecret ||
      isDev;

    // Official dummy keys return action "" or "test"
    if (expectedAction) {
      const matchesAction = result.action === expectedAction;
      const isTestDummyAction = isTestMode && (result.action === 'test' || !result.action);
      if (!matchesAction && !isTestDummyAction) {
        return { success: false, errorCodes: ['action-mismatch'] };
      }
    }

    const allowed = String(env.TURNSTILE_ALLOWED_HOSTNAMES || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    if (!isTestMode && allowed.length > 0) {
      const host = String(result.hostname || '').toLowerCase();
      if (!host || !allowed.includes(host)) {
        return { success: false, errorCodes: ['hostname-mismatch'] };
      }
    }

    return { success: true, testMode: isTestMode };
  } catch (err) {
    return { success: false, errorCodes: [err.name === 'AbortError' ? 'timeout' : 'network-error'] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verifyTurnstileToken };