const { randomUUID } = require('crypto');

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%239CA3AF'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

/**
 * Validates and strictly normalizes an arbitrary URL string.
 * Enforces http/https protocols or approved relative path prefixes.
 */
function getSafeUrl(inputUrl, defaultFallback = '') {
  if (!inputUrl || typeof inputUrl !== 'string') return defaultFallback;
  const trimmed = inputUrl.trim();
  if (!trimmed || trimmed.length > 2000) return defaultFallback;

  // Allow only known relative asset namespaces. Reject traversal and
  // backslash-based path normalization tricks.
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/tiles/')) {
    if (
      trimmed.includes('..') ||
      trimmed.includes('\\\\') ||
      !trimmed.startsWith('/') ||
      trimmed.startsWith('//')
    ) {
      return defaultFallback;
    }
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'];
  if (dangerousProtocols.some(proto => lower.startsWith(proto)) || trimmed.startsWith('//')) {
    return defaultFallback;
  }

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return defaultFallback;
    if (parsed.username || parsed.password) return defaultFallback;
    return parsed.href;
  } catch {
    return defaultFallback;
  }
}

/**
 * Maps raw PostgreSQL user row into camelCase object structure.
 */
function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    birthDate: row.birth_date,
    birthYear: row.birth_year ? String(row.birth_year) : (row.birth_date ? row.birth_date.substring(0, 4) : ''),
    phone: row.phone,
    instagram: row.instagram,
    linkedin: row.linkedin,
    residence: row.residence,
    floor: row.floor,
    room: row.room,
    firstYearInCollege: String(row.first_year_in_college),
    firstMonthInCollege: row.first_month_in_college ? String(row.first_month_in_college).padStart(2, '0') : '01',
    isCurrentlyInCollege: Boolean(row.is_currently_in_college),
    departureYear: row.departure_year ? String(row.departure_year) : null,
    departureMonth: row.departure_month ? String(row.departure_month).padStart(2, '0') : null,
    course: row.course,
    academicYear: row.academic_year,
    studyLevel: row.study_level,
    originContinent: row.origin_continent || 'Europe',
    originCountry: row.origin_country || 'Italy',
    originRegion: row.origin_region || 'Piemonte',
    originCity: row.origin_city || '',
    coords: row.coords ? row.coords.map(Number) : [45.0683, 7.6831],
    status: row.status,
    role: row.role,
    isFounder: Boolean(row.is_founder),
    tags: row.tags || [],
    avatar: row.avatar || DEFAULT_AVATAR,
    story: row.story,
    photos: row.photos || [{ url: row.avatar || DEFAULT_AVATAR, privacy: 'public' }],
    verified: Boolean(row.verified),
    endorsements: row.endorsements || [],
    isHidden: Boolean(row.is_hidden),
    hasSeenWelcome: Boolean(row.has_seen_welcome),
    bacheca: row.bacheca || [],
    residencyHistory: row.residency_history || [],
    privacy: (row.privacy && typeof row.privacy === 'object' && Object.keys(row.privacy).length > 0)
      ? row.privacy
      : {
        firstName: 'public',
        lastName: 'public',
        residence: 'public',
        floorRoom: 'public',
        course: 'public',
        studyLevel: 'public',
        academicYear: 'public',
        yearsInCollege: 'public',
        originLocation: 'public',
        birthDate: 'public',
        story: 'public',
        bacheca: 'public',
        residencyHistory: 'public'
      }
  };
}

/**
 * Applies Zero-Trust field masking based on user's privacy matrix and requester context.
 */
function applyServerPrivacy(targetUser, requestingUser) {
  if (!targetUser) return null;

  const isSuperAdmin = requestingUser?.role === 'superadmin';
  const isAdmin = requestingUser?.role === 'admin' || isSuperAdmin;
  const isOwner = requestingUser && String(requestingUser.id) === String(targetUser.id);
  const isLoggedIn = Boolean(requestingUser);

  if (isOwner || isAdmin) {
    return targetUser;
  }

  const p = targetUser.privacy || {};
  const isAllowed = (fieldKey) => {
    const setting = p[fieldKey] || 'public';
    if (setting === 'public') return true;
    if (setting === 'registered_only') return isLoggedIn;
    return false;
  };

  // Photo rule: "public" is visible to everyone; ANY other value means
  // "hidden" = visible only to logged-in users (owner, students and admins
  // are all logged in, so they all see it; anonymous visitors never do).
  const isPhotoAllowed = (photoObj) => {
    const photoPrivacy = (photoObj && typeof photoObj === 'object') ? (photoObj.privacy || 'public') : 'public';
    return photoPrivacy === 'public' ? true : isLoggedIn;
  };

  const visiblePhotos = Array.isArray(targetUser.photos)
    ? targetUser.photos.filter(isPhotoAllowed)
    : [];
  // The avatar follows the privacy of the photo entry it points to. If that
  // photo is hidden from this viewer the avatar is hidden too (default avatar),
  // instead of silently swapping in a different photo. An avatar that is not
  // listed in `photos` at all (accounts registered before photos were tracked)
  // keeps the previous behaviour: public.
  const avatarUrlOf = (photo) => (typeof photo === 'object' ? photo?.url : photo);
  const avatarEntry = Array.isArray(targetUser.photos)
    ? targetUser.photos.find((photo) => avatarUrlOf(photo) === targetUser.avatar)
    : null;
  const visibleAvatar = !targetUser.avatar
    ? DEFAULT_AVATAR
    : (!avatarEntry || isPhotoAllowed(avatarEntry))
      ? targetUser.avatar
      : DEFAULT_AVATAR;

  const isResidencyHistoryAllowed = isAllowed('residencyHistory');

  return {
    id: targetUser.id,
    name: (isAllowed('firstName') || isAllowed('lastName')) ? targetUser.name : 'Resident Member',
    firstName: isAllowed('firstName') ? targetUser.firstName : null,
    lastName: isAllowed('lastName') ? targetUser.lastName : null,
    email: isAllowed('email') ? targetUser.email : null,
    phone: isAllowed('phone') ? targetUser.phone : null,
    instagram: isAllowed('instagram') ? targetUser.instagram : null,
    linkedin: isAllowed('linkedin') ? targetUser.linkedin : null,
    residence: isAllowed('residence') ? targetUser.residence : null,
    floor: isAllowed('floorRoom') ? targetUser.floor : null,
    room: isAllowed('floorRoom') ? targetUser.room : null,
    course: isAllowed('course') ? targetUser.course : null,
    studyLevel: isAllowed('studyLevel') ? targetUser.studyLevel : null,
    academicYear: isAllowed('academicYear') ? targetUser.academicYear : null,
    firstYearInCollege: isAllowed('yearsInCollege') ? targetUser.firstYearInCollege : null,
    firstMonthInCollege: isAllowed('yearsInCollege') ? targetUser.firstMonthInCollege : null,
    departureYear: isAllowed('yearsInCollege') ? targetUser.departureYear : null,
    departureMonth: isAllowed('yearsInCollege') ? targetUser.departureMonth : null,
    originContinent: isAllowed('originLocation') ? targetUser.originContinent : null,
    originCountry: isAllowed('originLocation') ? targetUser.originCountry : null,
    originRegion: isAllowed('originLocation') ? targetUser.originRegion : null,
    originCity: isAllowed('originLocation') ? targetUser.originCity : null,
    coords: isAllowed('originLocation') ? targetUser.coords : null,
    birthDate: isAllowed('birthDate') ? targetUser.birthDate : null,
    birthYear: isAllowed('birthDate') ? targetUser.birthYear : null,
    story: isAllowed('story') ? targetUser.story : null,
    bacheca: isAllowed('bacheca') ? targetUser.bacheca : [],
    residencyHistory: isResidencyHistoryAllowed ? (() => {
      const primary = targetUser.residence && targetUser.firstYearInCollege
        ? {
            startDate: `${targetUser.firstYearInCollege}-${String(targetUser.firstMonthInCollege || '01').padStart(2, '0')}`,
            endDate: targetUser.isCurrentlyInCollege
              ? null
              : (targetUser.departureYear
                ? `${targetUser.departureYear}-${String(targetUser.departureMonth || '12').padStart(2, '0')}`
                : null),
            section: targetUser.residence,
            floor: targetUser.floor || '—',
            room: targetUser.room || '—'
          }
        : null;

      let history = Array.isArray(targetUser.residencyHistory)
        ? [...targetUser.residencyHistory]
        : [];

      // The current General Info stay must always appear in Residence History.
      // Replace a row with the same start month rather than creating duplicates.
      if (primary) {
        history = history.filter(entry => entry?.startDate !== primary.startDate);
        history.push(primary);
      }

      return history.sort((a, b) =>
        String(a?.startDate || '').localeCompare(String(b?.startDate || ''))
      );
    })() : [],
    photos: visiblePhotos,
    avatar: visibleAvatar,
    role: targetUser.role,
    verified: targetUser.verified,
    isCurrentlyInCollege: targetUser.isCurrentlyInCollege,
    isFounder: targetUser.isFounder,
    // Do not expose endorsement IDs, document-verification state, hidden flags,
    // or the raw privacy matrix to other residents.
    privacy: undefined
  };
}

/**
 * Calculates ICAO 9303 check digit with 7-3-1 weighting scheme.
 */
function calculateIcaoCheckDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  const clean = (str || '').toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    let val = 0;
    if (char >= '0' && char <= '9') {
      val = parseInt(char, 10);
    } else if (char >= 'A' && char <= 'Z') {
      val = char.charCodeAt(0) - 55;
    } else if (char === '<') {
      val = 0;
    }
    sum += val * weights[i % 3];
  }
  return sum % 10;
}

module.exports = {
  DEFAULT_AVATAR,
  getSafeUrl,
  mapUserRow,
  applyServerPrivacy,
  calculateIcaoCheckDigit
};