const { isTextSafeLocally } = require('../localModeration');

const IGNORED_KEYS = new Set([
  'password', 'currentPassword', 'newPassword', 'passwordHash',
  'email', 'newEmail', 'identifier', 'otpCode', 'code', 'token',
  'csrfToken', 'turnstileToken', 'url', 'link', 'meetingLink',
  'chatLink', 'coverImageUrl', 'photoUrl', 'portfolioLink',
  'contactInfo', 'id', 'userId', 'creatorId', 'sellerId', 'donorId',
  'startupId', 'clubId', 'itemId', 'status', 'role', 'commitmentType',
  'firstYearInCollege', 'firstMonthInCollege', 'lat', 'lng',
  'latitude', 'longitude', 'emailVerificationToken', 'senderName',
  // Structured / enumerated form values: never free prose, so they must not
  // cost a model inference (registration used to run ~30 of them in series).
  'residence', 'floor', 'room', 'floorRoom', 'section', 'phone',
  'academicYear', 'studyLevel', 'birthDate', 'birthYear',
  'startDate', 'endDate', 'departureYear', 'departureMonth',
  'firstYearInCollege', 'firstMonthInCollege', 'isCurrentlyInCollege',
  'privacy', 'entryType', 'avatar', 'photos', 'coords', 'tags', 'type', 'kind'
  // Free-text-ish fields (course, originCity, instagram, priceTag, ...) are
  // intentionally NOT ignored: they still get the profanity layer, and the
  // model skips them automatically because they are shorter than a sentence.
]);

// Trusted, admin-only endpoints that carry no free text.
const SKIPPED_PATHS = new Set(['/users/superadmin-create']);

const MAX_TOTAL_TEXT_FIELDS = 30;

function shouldInspectString(value, key) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || IGNORED_KEYS.has(String(key))) return false;

  // Technical values should not consume moderation-model capacity.
  if (/^[0-9a-f]{24,}$/i.test(trimmed)) return false;
  if (/^[a-z0-9_-]{1,80}:\/\//i.test(trimmed)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;

  return true;
}

function collectTextFields(value, path = [], output = []) {
  if (output.length >= MAX_TOTAL_TEXT_FIELDS || value == null) return output;

  if (typeof value === 'string') {
    if (shouldInspectString(value, path[path.length - 1])) {
      output.push({ path, value });
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextFields(item, [...path, index], output));
    return output;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (output.length >= MAX_TOTAL_TEXT_FIELDS) break;
      if (IGNORED_KEYS.has(key)) continue;
      collectTextFields(child, [...path, key], output);
    }
  }

  return output;
}

function isAuthPath(req) {
  return req.path === '/auth' || req.path.startsWith('/auth/') || SKIPPED_PATHS.has(req.path);
}

async function moderateRequestText(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || isAuthPath(req)) {
    return next();
  }

  const fields = collectTextFields(req.body);
  if (fields.length === 0) return next();

  // Pass 1 is the cheap synchronous profanity layer on every field; the ML
  // layer (inside isTextSafeLocally) only runs for real prose, and a field
  // that already failed pass 1 never reaches it.
  for (const field of fields) {
    const result = await isTextSafeLocally(field.value);
    if (!result.safe) {
      // Which field / layer / score triggered is logged, never returned.
      console.warn(`[TEXT MODERATION]: ${req.method} ${req.originalUrl} blocked (layer=${result.layer || 'n/a'}, field=${field.path.join('.')})`);
      return res.status(result.layer === 'model-error' ? 503 : 400).json({
        error: result.layer === 'model-error'
          ? 'Content check is temporarily unavailable. Please try again later.'
          : result.layer === 'input'
            ? 'The text you entered is too long.'
            : 'Your text was flagged as potentially offensive or inappropriate. Please rephrase it and try again.'
      });
    }
  }

  return next();
}

module.exports = { moderateRequestText };
