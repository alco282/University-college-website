/**
 * University Residence Portal - Centralized API Service Client
 * Standardizes fetch operations, authentication credentials, and response normalization.
 */

const API_BASE = '/api';

// The CSRF cookie is deliberately NOT HttpOnly (double-submit cookie pattern),
// specifically so client-side JS can read its current value. The server
// rotates this cookie on every login/registration/2FA success to prevent
// session fixation, so the token MUST be re-read from the cookie on every
// request rather than cached in a JS variable — a cached value goes stale
// the instant the server issues a new cookie, causing every subsequent
// state-changing request (image uploads, profile saves, etc.) to fail with
// "CSRF verification failed" until the page is reloaded.
function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?csrf_token=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

let csrfBootstrapPromise = null;

async function ensureCsrfToken(forceRefresh = false) {
  if (!forceRefresh) {
    const existing = readCsrfCookie();
    if (existing) return existing;
  }

  if (csrfBootstrapPromise) return csrfBootstrapPromise;

  csrfBootstrapPromise = (async () => {
  const existing = readCsrfCookie();
  if (existing) return existing;

  try {
    const response = await fetch(`${API_BASE}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error('CSRF bootstrap failed');
    const data = await response.json();
    // The bootstrap endpoint also sets the cookie via Set-Cookie; prefer
    // reading it back from the cookie jar so we stay in sync going forward,
    // falling back to the response body only if the cookie read fails
    // (e.g. transient timing edge-cases).
    const token = readCsrfCookie() || data?.csrfToken || null;
    if (!token) throw new Error('CSRF bootstrap response did not contain a token.');
    return token;
  } catch {
    throw new ApiError('Unable to initialize secure request protection.', 0);
  } finally {
    csrfBootstrapPromise = null;
  }
  })();

  return csrfBootstrapPromise;
}


/**
 * Standard HTTP Error with normalized status code and payload.
 */
export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Message that is safe to show to a person. Only ApiError carries a message
 * that was either written by our own server for the user or replaced by a
 * fixed generic text above. Any other exception (TypeError, ReferenceError,
 * JSON parse errors, ...) exposes code internals, so it yields `undefined` and
 * the caller's own generic fallback text is shown instead.
 */
export function safeErrorMessage(err) {
  return err instanceof ApiError ? err.message : undefined;
}

/**
 * Centralized fetch wrapper executing defense-in-depth headers and payload serialization.
 *
 * @param {string} endpoint - API relative route.
 * @param {object} options - Fetch options.
 * @returns {Promise<any>} Parsed JSON response.
 */
const inFlightMutations = new Map();

export function request(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || options.body instanceof FormData) {
    return performRequest(endpoint, options);
  }

  // A double click (or clicks queued while the page was busy) on a submit
  // button must not create the same record several times: an identical
  // mutation that is still in flight shares the first request's promise.
  let key;
  try { key = `${method} ${endpoint} ${JSON.stringify(options.body ?? null)}`; } catch { return performRequest(endpoint, options); }
  if (inFlightMutations.has(key)) return inFlightMutations.get(key);

  const promise = performRequest(endpoint, options).finally(() => inFlightMutations.delete(key));
  inFlightMutations.set(key, promise);
  return promise;
}

async function performRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method || 'GET')) {
    const token = await ensureCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  // Automatically attach JSON Content-Type if payload is present and not FormData
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include' // Always pass secure HttpOnly session cookies
  };

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    throw new ApiError('Network connection failure. Check server connectivity.', 0);
  }

  // If the session was rotated between the bootstrap and this request,
  // refresh the double-submit token once and retry the same idempotent
  // client request. The retry is bounded to one attempt.
  if (response.status === 403 && response.headers.get('content-type')?.includes('application/json')) {
    let challengeData = null;
    try {
      challengeData = await response.clone().json();
    } catch {
      challengeData = null;
    }

    if (challengeData?.error === 'CSRF validation failed.') {
      try {
        const freshToken = await ensureCsrfToken(true);
        fetchOptions.headers['X-CSRF-Token'] = freshToken;
        response = await fetch(url, fetchOptions);
      } catch {
        throw new ApiError('Unable to refresh secure request protection.', 0);
      }
    }
  }

  let data = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    // 502/503/504 come from the edge (Cloudflare tunnel) rather than from the
    // API — the body is an HTML/plain-text error page, not something a
    // resident should ever see in a toast. It usually just means the API
    // container is restarting for a few seconds.
    const isGatewayError = [502, 503, 504].includes(response.status);

    // OWASP: never show raw server output to the user. Server errors (5xx)
    // and anything that is not a controlled JSON { error } message get a fixed
    // generic text; field names / schema details are not displayed at all.
    const isServerError = response.status >= 500;
    const serverMessage = (!isServerError && data && typeof data === 'object' && typeof data.error === 'string' && data.error.length < 300)
      ? data.error
      : null;
    const errorMessage = isGatewayError
      ? 'The server is temporarily unreachable (it may be restarting). Nothing was lost — please wait a few seconds and try again.'
      : isServerError
        ? 'Something went wrong on our side. Please try again later.'
        : (serverMessage || 'The request could not be completed. Please check your input and try again.');

    throw new ApiError(errorMessage, response.status, isServerError ? null : data);
  }

  return data;
}

/**
 * Serializes a { limit, offset, ...extra } params object into a query
 * string. Every paginated GET route on the backend now returns an envelope
 * of the shape `{ items, total, limit, offset }` instead of a bare array —
 * callers consuming these responses need to read `.items`, not treat the
 * response itself as an array. Left un-paginated (no params needed), a call
 * simply uses the backend's own defaults (20 per page, capped at 100).
 */
function buildQuery(params = {}) {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (usable.length === 0) return '';
  const qs = new URLSearchParams(usable.map(([k, v]) => [k, String(v)]));
  return `?${qs.toString()}`;
}

// =============================================================================
// Authentication & Session Endpoints
// =============================================================================
export const authApi = {
  getMe: (signal) => request('/auth/me', { method: 'GET', signal }),

  login: (identifier, password, otpCode) =>
    request('/auth/login', {
      method: 'POST',
      body: { identifier, password, otpCode }
    }),

  logout: async () => request('/auth/logout', { method: 'POST' }),

  sendOtp: (email, purpose, turnstileToken = null) =>
    request('/auth/send-otp', {
      method: 'POST',
      body: { email, purpose, turnstileToken }
    }),

  verifyOtp: (email, code, purpose) =>
    request('/auth/verify-otp', {
      method: 'POST',
      body: { email, code, purpose }
    }),

  resetPassword: (email, code, newPassword) =>
    request('/auth/reset-password', {
      method: 'POST',
      body: { email, code, newPassword }
    }),

  updateCredentials: (credentialsData) =>
    request('/auth/update-credentials', {
      method: 'PUT',
      body: credentialsData
    })
};

// =============================================================================
// User & Directory Management Endpoints
// =============================================================================
export const userApi = {
  /**
   * Returns `{ items, total, limit, offset }`. Pass `{ limit, offset }` to
   * page through the directory; omit for the server's default page size.
   */
  getAllUsers: (params = {}, signal) => request(`/users${buildQuery(params)}`, { method: 'GET', signal }),

  registerUser: (userData) =>
    request('/users/register', { method: 'POST', body: userData }),

  updateProfile: (userId, profileData) =>
    request(`/users/${userId}`, {
      method: 'PUT',
      body: profileData
    }),

  superadminCreateUser: (userData) =>
    request('/users/superadmin-create', {
      method: 'POST',
      body: userData
    }),

  approveUser: (userId) =>
    request(`/users/${userId}/approve`, {
      method: 'PATCH'
    }),

  updateUserRole: (userId, rolePayload) =>
    request(`/users/${userId}/role`, {
      method: 'PATCH',
      body: rolePayload
    }),

  deleteUser: (userId) =>
    request(`/users/${userId}`, {
      method: 'DELETE'
    }),

  dismissWelcome: () =>
    request('/users/dismiss-welcome', {
      method: 'POST'
    }),

  endorseUser: (userId) =>
    request(`/users/${userId}/endorse`, {
      method: 'POST'
    }),

  getEndorsers: (userId, signal) =>
    request(`/users/${userId}/endorsers`, {
      method: 'GET',
      signal
    }),

};

// =============================================================================
// Communications, Notifications & Audit Endpoints
// =============================================================================
export const commsApi = {
  getNotifications: (signal) => request('/notifications', { method: 'GET', signal }),
  getContactShares: (signal) => request('/contact-shares', { method: 'GET', signal }),

  sendNotification: (notificationData) =>
    request('/notifications', {
      method: 'POST',
      body: notificationData
    }),

  updateNotificationStatus: (notifId, status) =>
    request(`/notifications/${notifId}/status`, {
      method: 'PATCH',
      body: { status }
    }),

  deleteNotification: (notifId) =>
    request(`/notifications/${notifId}`, {
      method: 'DELETE'
    }),

  getAdminChat: (signal) => request('/admin-chat', { method: 'GET', signal }),

  sendAdminChatMessage: (text, senderName) =>
    request('/admin-chat', {
      method: 'POST',
      body: { text, senderName }
    }),

  getSuggestions: (signal) => request('/suggestions', { method: 'GET', signal }),

  respondJoinRequest: (requestId, decision) => request(`/community/join-requests/${requestId}/respond`, { method: 'POST', body: { decision } }),

  submitSuggestion: (suggestionData) =>
    request('/suggestions', {
      method: 'POST',
      body: suggestionData
    }),

  /** Returns `{ items, total, limit, offset }`. */
  getAuditLogs: (params = {}, signal) => request(`/audit-logs${buildQuery(params)}`, { method: 'GET', signal }),

  getSettings: (signal) => request('/settings', { method: 'GET', signal }),

  updateSetting: (key, value) =>
    request(`/settings/${key}`, {
      method: 'PUT',
      body: { value }
    }),

  getMapConfig: (signal) => request('/config', { method: 'GET', signal })
};

// =============================================================================
// File Upload & Asset Services
// =============================================================================

const UPLOAD_MAX_DIMENSION = 1600;
const UPLOAD_SKIP_BELOW_BYTES = 350 * 1024; // already small: do not re-encode

/**
 * Shrinks a photo in the browser BEFORE uploading. Phone photos are 3-12 MB,
 * but the server re-encodes everything to <=1600px WebP anyway, so sending the
 * original only wastes upload time. Falls back to the untouched file on any
 * failure (unsupported format, no canvas support, ...).
 */
export async function prepareImageForUpload(file, maxDimension = UPLOAD_MAX_DIMENSION) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    if (file.size <= UPLOAD_SKIP_BELOW_BYTES) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/**
 * multipart upload with real progress (fetch() cannot report upload progress,
 * XMLHttpRequest can).
 */
function postFormWithProgress(url, formData, { headers = {}, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.setRequestHeader('Accept', 'application/json');

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          // Reserve the last 5% for server-side moderation/encoding.
          onProgress(Math.min(95, Math.round((evt.loaded / evt.total) * 95)));
        }
      };
      xhr.upload.onload = () => onProgress(95);
    }

    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ status: xhr.status, data });
      } else {
        reject(new ApiError(
          xhr.status >= 500
            ? 'Something went wrong on our side. Please try again later.'
            : ((data && typeof data.error === 'string' && data.error.length < 300 && data.error) || (xhr.status === 413 ? 'The file is too large.' : 'Error uploading file.')),
          xhr.status,
          xhr.status >= 500 ? null : data
        ));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network connection failure. Check server connectivity.', 0));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out. Please try again.', 0));
    xhr.timeout = 120000;

    if (signal) {
      if (signal.aborted) { xhr.abort(); reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => { xhr.abort(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }

    xhr.send(formData);
  });
}

/**
 * Uploads an image. The photo is downscaled client-side first and the optional
 * `onProgress(0-100)` callback drives a progress bar.
 */
export async function uploadMediaFile(file, { onProgress, signal } = {}) {
  const MAX_SIZE_MB = 15;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new ApiError(`The file "${file.name}" exceeds the maximum limit of ${MAX_SIZE_MB} MB.`, 413);
  }

  onProgress?.(0);
  const prepared = await prepareImageForUpload(file);

  const formData = new FormData();
  formData.append('image', prepared);

  const csrfToken = await ensureCsrfToken();
  const { data } = await postFormWithProgress(`${API_BASE}/upload`, formData, {
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    onProgress,
    signal
  });

  if (!data?.url) throw new ApiError('The upload could not be completed. Please try again.', 500);
  return data.url;
}


/**
 * Separate upload for avatar during registration (OWASP ASVS V11/V12)
 * Requires the temporary token issued after OTP validation.
 */
export async function uploadRegistrationAvatar(file, registrationToken, { onProgress, signal } = {}) {
  const MAX_SIZE_MB = 15; // the original is shrunk below before it is sent
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new ApiError(`The image exceeds the allowed limit of ${MAX_SIZE_MB} MB for the avatar.`, 413);
  }

  onProgress?.(0);
  const prepared = await prepareImageForUpload(file, 800);

  // The server's avatar multer limit is 2 MB; a re-encoded 800px WebP is well below.
  if (prepared.size > 2 * 1024 * 1024) {
    throw new ApiError('The image is still larger than 2 MB after resizing. Please choose a smaller photo.', 413);
  }

  const formData = new FormData();
  formData.append('image', prepared);

  const { data } = await postFormWithProgress(`${API_BASE}/auth/upload-avatar`, formData, {
    headers: { 'Authorization': `Bearer ${registrationToken}` },
    onProgress,
    signal
  });

  if (!data?.url) throw new ApiError('The upload could not be completed. Please try again.', 500);
  return data.url;
}

// =============================================================================
// Community Modules API
// =============================================================================
export const communityApi = {
  // Contact Sharing (restored — was completely missing)
  sendContactNotice: (payload) => request('/community/send-contact-notice', { method: 'POST', body: payload }),

  // Study Rooms — returns { items, total, limit, offset }
  getStudyRooms: (params = {}, signal) => request(`/community/study-rooms${buildQuery(params)}`, { method: 'GET', signal }),
  createStudyRoom: (data) => request('/community/study-rooms', { method: 'POST', body: data }),
  updateStudyRoomLinks: (roomId, links) => request(`/community/study-rooms/${roomId}/links`, { method: 'PUT', body: links }),
  joinStudyRoom: (roomId, payload) => request(`/community/study-rooms/${roomId}/join`, { method: 'POST', body: payload }),
  // Passion Clubs — restored (was fully missing server-side)
  getPassionClubs: (params = {}, signal) => request(`/community/passion-clubs${buildQuery(params)}`, { method: 'GET', signal }),
  createPassionClub: (data) => request('/community/passion-clubs', { method: 'POST', body: data }),
  updatePassionClub: (clubId, data) => request(`/community/passion-clubs/${clubId}`, { method: 'PUT', body: data }),
  joinPassionClub: (clubId, payload) => request(`/community/passion-clubs/${clubId}/join`, { method: 'POST', body: payload }),
  addClubResource: (clubId, resource) => request(`/community/passion-clubs/${clubId}/resources`, { method: 'POST', body: resource }),

  // Recipes & Kitchen
  getRecipes: (params = {}, signal) => request(`/community/recipes${buildQuery(params)}`, { method: 'GET', signal }),
  createRecipe: (data) => request('/community/recipes', { method: 'POST', body: data }),
  rateRecipe: (recipeId, rating) => request(`/community/recipes/${recipeId}/rate`, { method: 'POST', body: { rating } }),
  updateRecipe: (recipeId, data) => request(`/community/recipes/${recipeId}`, { method: 'PUT', body: data }),
  deleteRecipe: (recipeId) => request(`/community/recipes/${recipeId}`, { method: 'DELETE' }),

  // Time Capsule (response shape: { capsule, entries, total, limit, offset })
  getTimeCapsule: (section, academicYear, params = {}, signal) =>
    request(`/community/time-capsule/${section}${buildQuery({ academicYear, ...params })}`, { method: 'GET', signal }),
  createTimeCapsuleEntry: (capsuleId, data) =>
    request(`/community/time-capsule/${capsuleId}/entries`, { method: 'POST', body: data }),
  confirmTimeCapsuleEntry: (entryId) =>
    request(`/community/time-capsule/entries/${entryId}/confirm`, { method: 'POST' }),

  // Jukebox
  getJukeboxTracks: (params = {}, signal) => request(`/community/jukebox${buildQuery(params)}`, { method: 'GET', signal }),
  addJukeboxTrack: (spotifyUrl) => request('/community/jukebox', { method: 'POST', body: { spotifyUrl } }),
  toggleJukeboxLike: (trackId) => request(`/community/jukebox/${trackId}/like`, { method: 'POST' }),
  deleteJukeboxTrack: (trackId) => request(`/community/jukebox/${trackId}`, { method: 'DELETE' }),

  // Academic Exchanges Map
  getAcademicsMap: (params = {}, signal) => request(`/community/academics-map${buildQuery(params)}`, { method: 'GET', signal }),
  createAcademicsMapEntry: (data) => request('/community/academics-map', { method: 'POST', body: data }),
  updateAcademicsMapEntry: (entryId, data) => request(`/community/academics-map/${entryId}`, { method: 'PUT', body: data }),
  deleteAcademicsMapEntry: (entryId) => request(`/community/academics-map/${entryId}`, { method: 'DELETE' }),

  // Match Finder (Speed-Friending / Sports Pickup) — restored, was fully missing
  getMatches: (params = {}, signal) => request(`/community/matches${buildQuery(params)}`, { method: 'GET', signal }),
  createMatch: (data) => request('/community/matches', { method: 'POST', body: data }),
  joinMatch: (matchId, payload) => request(`/community/matches/${matchId}/join`, { method: 'POST', body: payload }),
  deleteMatch: (matchId) => request(`/community/matches/${matchId}`, { method: 'DELETE' }),

  // City Survival Guide — restored, was fully missing
  getCityGuide: (params = {}, signal) => request(`/community/city-guide${buildQuery(params)}`, { method: 'GET', signal }),
  createCityGuideEntry: (data) => request('/community/city-guide', { method: 'POST', body: data }),
  rateCityGuideEntry: (placeId, rating) => request(`/community/city-guide/${placeId}/rate`, { method: 'POST', body: { rating } }),
  updateCityGuideEntry: (placeId, data) => request(`/community/city-guide/${placeId}`, { method: 'PUT', body: data }),
  deleteCityGuideEntry: (placeId) => request(`/community/city-guide/${placeId}`, { method: 'DELETE' }),

  // Language Tandem — restored, was fully missing
  getTandems: (params = {}, signal) => request(`/community/tandem${buildQuery(params)}`, { method: 'GET', signal }),
  createTandem: (data) => request('/community/tandem', { method: 'POST', body: data }),
  joinTandem: (tandemId, payload) => request(`/community/tandem/${tandemId}/join`, { method: 'POST', body: payload }),
  deleteTandem: (tandemId) => request(`/community/tandem/${tandemId}`, { method: 'DELETE' }),

  // Book & Notes Marketplace — restored, was fully missing
  getMarketplaceListings: (params = {}, signal) => request(`/community/marketplace${buildQuery(params)}`, { method: 'GET', signal }),
  createMarketplaceListing: (data) => request('/community/marketplace', { method: 'POST', body: data }),
  contactMarketplaceSeller: (listingId, payload) => request(`/community/marketplace/${listingId}/contact`, { method: 'POST', body: payload }),
  updateMarketplaceListing: (listingId, data) => request(`/community/marketplace/${listingId}`, { method: 'PUT', body: data }),
  deleteMarketplaceListing: (listingId) => request(`/community/marketplace/${listingId}`, { method: 'DELETE' }),

  // End-of-Year Freebox — restored, was fully missing
  getFreeboxItems: (params = {}, signal) => request(`/community/freebox${buildQuery(params)}`, { method: 'GET', signal }),
  createFreeboxItem: (data) => request('/community/freebox', { method: 'POST', body: data }),
  claimFreeboxItem: (itemId, payload) => request(`/community/freebox/${itemId}/claim`, { method: 'POST', body: payload }),
  updateFreeboxItem: (itemId, data) => request(`/community/freebox/${itemId}`, { method: 'PUT', body: data }),
  deleteFreeboxItem: (itemId) => request(`/community/freebox/${itemId}`, { method: 'DELETE' }),

  // Community Startups — restored, was fully missing
  getStartups: (params = {}, signal) => request(`/community/startups${buildQuery(params)}`, { method: 'GET', signal }),
  createStartup: (data) => request('/community/startups', { method: 'POST', body: data }),
  applyToStartup: (startupId, payload) => request(`/community/startups/${startupId}/apply`, { method: 'POST', body: payload }),
  updateStartupStatus: (startupId, status) => request(`/community/startups/${startupId}/status`, { method: 'PATCH', body: { status } }),

  // Universal Moderation Actions
  reportContent: (endpoint, itemId) => request(`${endpoint}/${itemId}/report`, { method: 'POST' }),
  moderateContent: (endpoint, itemId) => request(`${endpoint}/${itemId}/moderate`, { method: 'DELETE' })
};
