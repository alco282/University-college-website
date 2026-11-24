/**
 * University Residence Portal - Client-Side Security & Validation Utilities
 * Implements strict sanitization, URL validation (OWASP ASVS Level 2), and strict date/residence validation.
 */

/**
 * Validates and strictly normalizes an arbitrary URL.
 * Defends against javascript:, data:, vbscript:, and protocol-relative (//) bypasses.
 *
 * @param {string} inputUrl - The URL candidate to sanitize.
 * @param {string} defaultFallback - Fallback URL if validation fails.
 * @returns {string} Safe URL.
 */


export const FLOOR_OPTIONS = Object.freeze([
  '0 floor',
  '1st floor',
  '2nd floor',
  '3rd floor',
  '4th floor',
  '5th floor'
]);


export function getSafeUrl(inputUrl, defaultFallback = '#') {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return defaultFallback;
  }

  const trimmed = inputUrl.trim();
  if (!trimmed || trimmed.length > 2000) {
    return defaultFallback;
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    if (trimmed.includes('..') || trimmed.includes('\\')) {
      return defaultFallback;
    }
    if (!trimmed.startsWith('/uploads/') && !trimmed.startsWith('/tiles/')) {
      return defaultFallback;
    }
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const dangerousProtocols = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'blob:',
    'about:'
  ];

  if (dangerousProtocols.some((proto) => lower.startsWith(proto))) {
    return defaultFallback;
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.username || parsed.password) {
        return defaultFallback;
      }
      return parsed.href;
    }
    return defaultFallback;
  } catch {
    return defaultFallback;
  }
}

/**
 * Escapes unsafe characters for direct injection into dynamic HTML templates (e.g. Leaflet popups).
 * Prevents DOM-based Cross-Site Scripting (DOM XSS).
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates college entrance year, release year, and birth date consistency.
 */
export function validateCollegeAndBirth(
  firstMonthStr,
  isCurrentlyIn,
  departureYearStr,
  birthDateStr,
  birthYearStr,
  { requireBirth = false } = {}
) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const normalizedFirst = String(firstMonthStr ?? '').trim();
  let startYear = null;
  let startMonth = null;

  if (/^\d{4}-\d{2}$/.test(normalizedFirst)) {
    startYear = Number(normalizedFirst.slice(0, 4));
    startMonth = Number(normalizedFirst.slice(5, 7));
    if (startMonth < 1 || startMonth > 12) {
      return { valid: false, error: 'Select a valid admission month and year.' };
    }
    if (
      startYear < 1935 ||
      startYear > currentYear ||
      (startYear === currentYear && startMonth > currentMonth)
    ) {
      return {
        valid: false,
        error: `The month and year of admission must be between 01/1935 and ${String(currentMonth).padStart(2, '0')}/${currentYear}.`
      };
    }
  } else if (/^\d{4}$/.test(normalizedFirst)) {
    // Backward-compatible handling for existing profile records that only
    // contain the historical admission year.
    startYear = Number(normalizedFirst);
    if (startYear < 1935 || startYear > currentYear) {
      return {
        valid: false,
        error: `The year of admission must be between 1935 and ${currentYear}.`
      };
    }
  } else {
    return {
      valid: false,
      error: 'Select the month and year of admission.'
    };
  }

  if (!isCurrentlyIn) {
    const departure = String(departureYearStr ?? '').trim();
    const match = departure.match(/^(\d{4})-(\d{2})$/);
    const endYear = match ? Number(match[1]) : Number.NaN;
    const endMonth = match ? Number(match[2]) : Number.NaN;
    if (!match || !Number.isInteger(endYear) || !Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12 || endYear < 1935 || endYear > currentYear || (endYear === currentYear && endMonth > currentMonth)) {
      return { valid: false, error: `The departure month and year cannot be in the future and must be valid (up to ${String(currentMonth).padStart(2, '0')}/${currentYear}).` };
    }
    if (endYear * 12 + endMonth < startYear * 12 + (startMonth || 1)) {
      return { valid: false, error: `Departure month and year (${String(endMonth).padStart(2, '0')}/${endYear}) cannot precede the entrance month and year.` };
    }
  }

  let bYear = null;
  if (birthDateStr && String(birthDateStr).length >= 4) {
    bYear = Number.parseInt(String(birthDateStr).substring(0, 4), 10);
  } else if (birthYearStr !== null && birthYearStr !== undefined && String(birthYearStr).trim() !== '') {
    bYear = Number.parseInt(String(birthYearStr), 10);
  }

  if (bYear === null || Number.isNaN(bYear)) {
    if (!requireBirth) return { valid: true };
    return {
      valid: false,
      error: 'Date of birth is required (enter a full date or at least the birth year).'
    };
  }

  if (bYear > currentYear) {
    return { valid: false, error: 'The birth date cannot be set in the future.' };
  }
  if (bYear < 1915) {
    return { valid: false, error: 'Please enter a valid birth year (1915 or later).' };
  }
  if (bYear >= startYear) {
    return {
      valid: false,
      error: `Birth year (${bYear}) cannot be equal to or later than the entrance year (${startYear}).`
    };
  }
  if (startYear - bYear < 16) {
    return {
      valid: false,
      error: `Age requirement not satisfied: applicant must be at least 16 years old at entrance year (${startYear}).`
    };
  }

  return { valid: true };
}


export function validateResidenceFields(floor, room) {
  if (!FLOOR_OPTIONS.includes(floor)) {
    return { valid: false, error: 'Select a valid floor.' };
  }

  if (!/^[0-9]+$/.test(String(room ?? ''))) {
    return { valid: false, error: 'Room number must contain digits only.' };
  }

  return { valid: true };
}

export function normalizeRoomInput(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

/**
 * Evaluates whether a user attribute can be displayed based on privacy policy and session role.
 */
export function canViewField(fieldKey, targetStudent, currentUser) {
  if (!targetStudent) return false;

  if (
    currentUser?.role === 'superadmin' ||
    currentUser?.role === 'admin' ||
    currentUser?.id === targetStudent.id
  ) {
    return true;
  }

  const setting = targetStudent.privacy?.[fieldKey] || 'public';
  if (setting === 'public') return true;
  if (setting === 'registered_only') return Boolean(currentUser);

  return false;
}

/**
 * Evaluates whether an individual photo can be displayed based on individual photo privacy.
 */
export function canViewPhoto(photoObj, targetStudent, currentUser) {
  if (!targetStudent) return false;

  // "public" -> everyone. Anything else is "hidden" = logged-in users only.
  // No owner/admin special case: they are logged in, so the rule already
  // covers them, and an anonymous visitor never sees a hidden photo.
  const photoPrivacy = (photoObj && typeof photoObj === 'object') ? (photoObj.privacy || 'public') : 'public';
  return photoPrivacy === 'public' ? true : Boolean(currentUser);
}

export function parseBirthInput(raw) {
  const trimmed = String(raw ?? '').trim();

  // Empty is intentionally not an error here.
  // Required-field validation is handled when the form is submitted.
  if (!trimmed) {
    return {
      birthDate: null,
      birthYear: null,
      error: null
    };
  }

  if (!/^[0-9./-]+$/.test(trimmed)) {
    return {
      birthDate: null,
      birthYear: null,
      error: 'Birth date may contain only digits and /, - or . separators.'
    };
  }

  // Year-only input is explicitly supported.
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    const currentYear = new Date().getFullYear();

    if (year < 1915 || year > currentYear) {
      return {
        birthDate: null,
        birthYear: null,
        error: `Enter a birth year between 1915 and ${currentYear}.`
      };
    }

    return {
      birthDate: null,
      birthYear: year,
      error: null
    };
  }

  // Full date: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY,
  // with two-digit years also accepted.
  const match = trimmed.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/
  );

  if (!match) {
    return {
      birthDate: null,
      birthYear: null,
      error: 'Use DD/MM/YYYY, DD/MM/YY, or YYYY.'
    };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  let year = Number(match[3]);
  const currentYear = new Date().getFullYear();

  if (match[3].length === 2) {
    const currentYY = currentYear % 100;
    year = year <= currentYY ? 2000 + year : 1900 + year;
  }

  if (year < 1915 || year > currentYear) {
    return {
      birthDate: null,
      birthYear: null,
      error: `Enter a birth year between 1915 and ${currentYear}.`
    };
  }

  // UTC avoids timezone-related date rollover during validation.
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return {
      birthDate: null,
      birthYear: null,
      error: 'Enter a real calendar date.'
    };
  }

  if (date.getTime() > Date.now()) {
    return {
      birthDate: null,
      birthYear: null,
      error: 'The birth date cannot be in the future.'
    };
  }

  return {
    birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    birthYear: year,
    error: null
  };
}


/**
 * Avatar to show in Yearbook, Map and cards. It follows the privacy of the
 * photo the avatar points to: public -> everyone, hidden -> logged-in users
 * only. An avatar not listed in `photos` counts as public.
 */
export function getVisibleAvatar(student, currentUser, fallback) {
  if (!student || !student.avatar) return fallback;
  const entry = Array.isArray(student.photos)
    ? student.photos.find(p => (typeof p === 'object' ? p?.url : p) === student.avatar)
    : null;
  if (!entry) return student.avatar;
  return canViewPhoto(entry, student, currentUser) ? student.avatar : fallback;
}
