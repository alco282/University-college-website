const express = require('express');
const { z } = require('zod');
const { pool, invalidateUserCache } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { recordAuditLog } = require('../utils/audit');
const { mapUserRow, DEFAULT_AVATAR, getSafeUrl } = require('../utils/sanitize');
const { sendAccountApprovedEmail } = require('../emailService');
const { ALLOWED_FLOORS, validateBirthInput, validateResidenceHistory } = require('../utils/validation');

const router = express.Router();

function normalizeStoredImageRef(inputValue, { allowEmpty = true } = {}) {
  const value = (inputValue || '').toString().trim();
  if (!value) {
    return allowEmpty ? { ok: true, url: '' } : { ok: false, reason: 'An image is required.' };
  }
  if (value === DEFAULT_AVATAR || value.startsWith('data:image/svg+xml')) {
    return { ok: true, url: value };
  }
  if (/^\/uploads\/(?:img|avatar)-[0-9a-f-]{36}\.webp$/i.test(value)) {
    return { ok: true, url: value };
  }
  return { ok: false, reason: 'Images must be uploaded via /api/upload first; direct or inline image data is not accepted here.' };
}

function normalizeStoredPhotosArray(photos) {
  if (!Array.isArray(photos)) return { ok: true, photos: null };

  const cleaned = [];
  for (const p of photos.slice(0, 10)) {
    const rawUrl = typeof p === 'object' && p !== null ? p.url : p;
    const check = normalizeStoredImageRef(rawUrl, { allowEmpty: false });
    if (!check.ok) {
      return { ok: false, reason: `Photo rejected: ${check.reason}` };
    }
    const privacy = (typeof p === 'object' && p !== null && ['public', 'registered_only', 'private'].includes(p.privacy))
      ? p.privacy
      : 'public';
    cleaned.push({ url: check.url, privacy });
  }
  return { ok: true, photos: cleaned };
}

function ensurePrimaryResidenceHistory(history, primaryPeriod, floor, room) {
  const source = Array.isArray(history) ? history : [];
  const normalized = source.map((entry) => ({
    startDate: entry.startDate,
    endDate: entry.endDate ?? null,
    section: entry.section,
    floor: entry.floor,
    room: String(entry.room)
  }));

  const exists = normalized.some((entry) =>
    entry.startDate === primaryPeriod.startDate &&
    (entry.endDate || null) === (primaryPeriod.endDate || null) &&
    entry.section === primaryPeriod.section &&
    entry.floor === floor &&
    entry.room === String(room)
  );

  if (!exists) {
    normalized.push({
      startDate: primaryPeriod.startDate,
      endDate: primaryPeriod.endDate || null,
      section: primaryPeriod.section,
      floor,
      room: String(room)
    });
  }

  return normalized;
}

const updateProfileSchema = z.object({
  phone: z.string().max(30).optional().nullable(),
  instagram: z.string().max(60).optional().nullable(),
  linkedin: z.string().optional().nullable(),
  course: z.string().max(255).optional().nullable(),
  academicYear: z.string().max(50).optional().nullable(),
  studyLevel: z.enum(['BSc', 'MSc (Magistrale)', 'PhD']).optional().nullable(),
  residence: z.enum(['Residence_name_1','Residence_name_2','Residence_name_3']).optional().nullable(),
  floor: z.enum(ALLOWED_FLOORS).optional().nullable(),
  room: z.string().regex(/^\d+$/).max(30).optional().nullable(),
  firstYearInCollege: z.coerce.number().int().min(1935).max(new Date().getFullYear()).optional().nullable(),
  firstMonthInCollege: z.coerce.number().int().min(1).max(12).optional().nullable(),
  isCurrentlyInCollege: z.boolean().optional().nullable(),
  departureYear: z.coerce.number().int().min(1935).optional().nullable(),
  departureMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
  originContinent: z.string().max(50).optional().nullable(),
  originCountry: z.string().max(60).optional().nullable(),
  originRegion: z.string().max(60).optional().nullable(),
  originCity: z.string().max(60).optional().nullable(),
  coords: z.array(z.number().finite()).length(2).optional().nullable(),
  birthDate: z.string().max(35).optional().nullable(),
  residencyHistory: z.array(z.object({ 
    startDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), 
    endDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(), 
    section: z.enum(['Residence_name_1','Residence_name_2','Residence_name_3']), 
    floor: z.enum(ALLOWED_FLOORS), 
    room: z.string().regex(/^\d+$/).max(30) 
  }).passthrough()).max(20).optional().nullable(),
  birthYear: z.coerce.number().int().optional().nullable(),
  story: z.string().max(3000).optional().nullable(),
  photos: z.array(z.object({ url: z.string().max(2000), privacy: z.enum(['public', 'registered_only', 'private']).optional() })).max(10).optional().nullable(),
  avatar: z.string().optional().nullable(),
  privacy: z.record(z.string()).optional().nullable(),
  bacheca: z.array(z.object({
    id: z.string().max(100).optional(),
    title: z.string().max(100).optional(),
    type: z.string().max(32).optional(),
    content: z.string().max(3000).optional(),
    coverImage: z.string().max(2000).optional()
  }).passthrough()).max(20).optional().nullable()
});

router.put('/:id', authenticate, validateRequest({ params: z.object({ id: z.string().min(1).max(64) }), body: updateProfileSchema }), async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.role === 'superadmin';
  const isOwner = req.user.id === id;

  if (!isOwner && !isSuperAdmin) {
    return res.status(403).json({ error: 'Access forbidden: You can only update your own account.' });
  }

  const u = req.body;

  if (u.firstYearInCollege != null || u.firstMonthInCollege != null) {
    if (u.firstYearInCollege == null || u.firstMonthInCollege == null) {
      return res.status(400).json({ error: 'First month and year in Residence must be provided together.' });
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (
      u.firstYearInCollege > currentYear ||
      (u.firstYearInCollege === currentYear && u.firstMonthInCollege > currentMonth)
    ) {
      return res.status(400).json({ error: 'The first month and year in Residence cannot be in the future.' });
    }
  }

  const effectiveFirstYear = u.firstYearInCollege ?? Number(req.user.firstYearInCollege);
  const effectiveFirstMonth = u.firstMonthInCollege ?? Number(req.user.firstMonthInCollege || 1);
  const effectiveCurrent = u.isCurrentlyInCollege ?? Boolean(req.user.isCurrentlyInCollege);
  const effectiveDepartureYear = u.departureYear ?? (req.user.departureYear ? Number(req.user.departureYear) : null);
  const effectiveDepartureMonth = u.departureMonth ?? (req.user.departureMonth ? Number(req.user.departureMonth) : null);
  if (!effectiveCurrent && (effectiveDepartureYear == null || effectiveDepartureMonth == null)) {
    return res.status(400).json({ error: 'Departure month and year are required for former residents.' });
  }
  if (effectiveDepartureYear != null && effectiveDepartureMonth != null) {
    const startOrdinal = Number(effectiveFirstYear) * 12 + Number(effectiveFirstMonth);
    const endOrdinal = Number(effectiveDepartureYear) * 12 + Number(effectiveDepartureMonth);
    const now = new Date(); const nowOrdinal = now.getFullYear() * 12 + now.getMonth() + 1;
    if (endOrdinal < startOrdinal) return res.status(400).json({ error: 'Departure month and year cannot precede the first month and year in Residence.' });
    if (endOrdinal > nowOrdinal) return res.status(400).json({ error: 'Departure month and year cannot be in the future.' });
  }
  if (effectiveCurrent && (u.departureYear != null || u.departureMonth != null)) {
    return res.status(400).json({ error: 'Current students cannot have a departure month or year.' });
  }

  const currentProfileForHistory = {
    startDate: `${effectiveFirstYear}-${String(effectiveFirstMonth).padStart(2, '0')}`,
    endDate: effectiveCurrent ? null : `${effectiveDepartureYear}-${String(effectiveDepartureMonth).padStart(2, '0')}`,
    section: u.residence || req.user.residence
  };
  const effectiveFloor = u.floor || req.user.floor;
  const effectiveRoom = u.room || req.user.room;
  const requestedHistory = u.residencyHistory === undefined
    ? (req.user.residencyHistory || [])
    : (u.residencyHistory || []);
  const historyWithPrimary = ensurePrimaryResidenceHistory(
    requestedHistory,
    currentProfileForHistory,
    effectiveFloor,
    effectiveRoom
  );
  const historyCheck = validateResidenceHistory(historyWithPrimary, currentProfileForHistory);
  if (!historyCheck.valid) return res.status(400).json({ error: historyCheck.error });

  if (u.birthDate != null) {
    const rawBirth = String(u.birthDate).split('T')[0];
    const formattedBirth = rawBirth.includes('-') 
      ? rawBirth.split('-').reverse().join('/') 
      : rawBirth;
    const birthCheck = validateBirthInput(formattedBirth, { required: false });
    if (!birthCheck.valid) return res.status(400).json({ error: birthCheck.error });
  }

  if (
    u.birthYear != null &&
    u.firstYearInCollege != null &&
    Number(u.birthYear) >= Number(u.firstYearInCollege)
  ) {
    return res.status(400).json({ error: 'Birth year must be earlier than the first year in college.' });
  }

  try {
    let avatarUrl;
    if (u.avatar !== undefined) {
      const avatarCheck = normalizeStoredImageRef(u.avatar);
      if (!avatarCheck.ok) {
        console.warn('[AVATAR REJECTED]:', avatarCheck.reason);
        return res.status(400).json({ error: 'The selected image is not valid. Please upload it again.' });
      }
      avatarUrl = avatarCheck.url || null;
    }

    let cleanPhotos = null;
    if (u.photos !== undefined) {
      const photosCheck = normalizeStoredPhotosArray(u.photos);
      if (!photosCheck.ok) return res.status(400).json({ error: photosCheck.reason });
      cleanPhotos = photosCheck.photos ? JSON.stringify(photosCheck.photos) : null;
    }

    const { rows: oldRows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (oldRows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const previous = oldRows[0];

    const safeLinkedin = u.linkedin ? getSafeUrl(u.linkedin, '') : null;
    const cleanBacheca = Array.isArray(u.bacheca)
      ? JSON.stringify(u.bacheca.slice(0, 20).map((item) => ({
          ...item,
          coverImage: item.coverImage ? getSafeUrl(item.coverImage, '') : undefined,
          content: (item.type && item.type !== 'quote' && item.content) ? getSafeUrl(item.content, '') : item.content
        })))
      : null;
    const cleanPrivacy = u.privacy ? JSON.stringify(u.privacy) : null;
    const cleanHistory = JSON.stringify(historyCheck.value || []);

    const { rows } = await pool.query(
      `UPDATE users SET
        phone = COALESCE($1, phone),
        instagram = COALESCE($2, instagram),
        linkedin = COALESCE($3, linkedin),
        course = COALESCE($4, course),
        academic_year = COALESCE($5, academic_year),
        study_level = COALESCE($6, study_level),
        residence = COALESCE($7, residence),
        floor = COALESCE($8, floor),
        room = COALESCE($9, room),
        first_year_in_college = COALESCE($10, first_year_in_college),
        first_month_in_college = COALESCE($11, first_month_in_college),
        is_currently_in_college = COALESCE($12, is_currently_in_college),
        departure_year = CASE WHEN $12 = TRUE THEN NULL ELSE COALESCE($13, departure_year) END,
        departure_month = CASE WHEN $12 = TRUE THEN NULL ELSE COALESCE($14, departure_month) END,
        origin_continent = COALESCE($15, origin_continent),
        origin_country = COALESCE($16, origin_country),
        origin_region = COALESCE($17, origin_region),
        origin_city = COALESCE($18, origin_city),
        coords = COALESCE($19, coords),
        birth_date = COALESCE($20, birth_date),
        birth_year = COALESCE($21, birth_year),
        story = COALESCE($22, story),
        photos = COALESCE($23::jsonb, photos),
        avatar = COALESCE($24, avatar),
        privacy = COALESCE($25::jsonb, privacy),
        bacheca = COALESCE($26::jsonb, bacheca),
        residency_history = COALESCE($27::jsonb, residency_history),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $28 RETURNING *`,
      [
        u.phone || null,
        u.instagram || null,
        safeLinkedin,
        u.course || null,
        u.academicYear || null,
        u.studyLevel || null,
        u.residence || null,
        u.floor || null,
        u.room || null,
        u.firstYearInCollege || null,
        u.firstMonthInCollege || null,
        u.isCurrentlyInCollege !== undefined ? u.isCurrentlyInCollege : null,
        u.departureYear || null,
        u.departureMonth || null,
        u.originContinent || null,
        u.originCountry || null,
        u.originRegion || null,
        u.originCity || null,
        u.coords || null,
        u.birthDate ? String(u.birthDate).split('T')[0] : null,
        u.birthYear || null,
        u.story || null,
        cleanPhotos,
        avatarUrl,
        cleanPrivacy,
        cleanBacheca,
        cleanHistory,
        id
      ]
    );

    await invalidateUserCache(id);

    try {
      await recordAuditLog(
        req,
        req.user.id,
        req.user.name,
        req.user.role,
        'PROFILE_UPDATE',
        previous,
        rows[0]
      );
    } catch (auditError) {
      console.error('[AUDIT LOG ERROR]:', auditError);
    }

    return res.json(mapUserRow(rows[0]));
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update user profile.' });
  }
});

router.get('/:id/endorsers', authenticate, requireRole('superadmin'), validateRequest({ params: z.object({ id: z.string().min(1).max(64) }) }), async (req, res) => {
  try {
    const { rows: target } = await pool.query('SELECT endorsements, name FROM users WHERE id = $1', [req.params.id]);
    if (target.length === 0) return res.status(404).json({ error: 'User not found.' });
    const ids = Array.isArray(target[0].endorsements) ? target[0].endorsements : [];
    if (ids.length === 0) return res.json({ endorsers: [] });
    const { rows } = await pool.query(
      'SELECT id, name, email, residence, role FROM users WHERE id = ANY($1::text[])',
      [ids]
    );
    res.json({ endorsers: rows.map(e => ({ id: e.id, name: e.name, email: e.email, residence: e.residence, role: e.role })) });
  } catch (err) {
    console.error('Endorsers fetch error:', err);
    res.status(500).json({ error: 'Failed to query endorsers.' });
  }
});

router.delete('/:id', authenticate, requireRole('superadmin'), validateRequest({ params: z.object({ id: z.string().min(1).max(64) }) }), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows: target } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (target.length === 0) return res.status(404).json({ error: 'User not found.' });

    if (target[0].role === 'superadmin' || target[0].is_founder) {
      return res.status(403).json({ error: 'SuperAdmin or Founder accounts cannot be deleted.' });
    }

    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `USER_DELETE_${target[0].name}`, target[0], null);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    await invalidateUserCache(id);

    res.json({ success: true, message: 'Account permanently purged.' });
  } catch (err) {
    console.error('User delete error:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

router.patch('/:id/role', authenticate, requireRole('superadmin'), validateRequest({ params: z.object({ id: z.string().min(1).max(64) }), body: z.object({ role: z.enum(['student','admin','superadmin']), status: z.string().max(64).optional(), tags: z.array(z.string().max(64)).max(20).optional() }) }), async (req, res) => {
  const { id } = req.params;
  const { role, status, tags } = req.body;

  if (!['student', 'admin', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role assignment.' });
  }

  if (req.user.id === id && role !== 'superadmin') {
    return res.status(400).json({ error: 'You cannot revoke your own SuperAdmin privileges.' });
  }

  try {
    const { rows: target } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (target.length === 0) return res.status(404).json({ error: 'User not found.' });

    if (target[0].is_founder && role !== 'superadmin') {
      return res.status(403).json({ error: 'Founder account cannot be demoted.' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET
        role = $1,
        status = COALESCE($2, status),
        tags = COALESCE($3::text[], tags),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 RETURNING *`,
      [role, status || null, tags || null, id]
    );

    await invalidateUserCache(id);
    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `ROLE_CHANGE_${target[0].name}_TO_${role}`, target[0], rows[0]);

    res.json(mapUserRow(rows[0]));
  } catch (err) {
    console.error('Role update error:', err);
    res.status(500).json({ error: 'Failed to update user role.' });
  }
});

router.post('/:id/endorse', authenticate, validateRequest({ params: z.object({ id: z.string().min(1).max(64) }) }), async (req, res) => {
  const { id } = req.params;

  if (String(req.user.id) === String(id)) {
    return res.status(400).json({ error: 'You cannot endorse your own account.' });
  }

  const isStaff = req.user.role === 'admin' || req.user.role === 'superadmin';

  if (!req.user.verified) {
    return res.status(403).json({ error: 'Only verified members can confirm resident identities.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const targetRes = await client.query(
      'SELECT id, name, residence, first_year_in_college, endorsements, verified, status, is_currently_in_college FROM users WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Resident not found.' });
    }

    const target = targetRes.rows[0];
    if (target.verified) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Account is already verified.' });
    }

    if (!isStaff) {
      if (req.user.residence !== target.residence) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `You can only verify members from your own residence section (${target.residence}).` });
      }
    }

    let endorsements = target.endorsements || [];
    if (endorsements.includes(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You have already confirmed this resident.' });
    }

    endorsements.push(req.user.id);
    const isNowVerified = isStaff || endorsements.length >= 3;
    const newStatus = isNowVerified
      ? (target.is_currently_in_college ? 'In Residence' : 'Alumni')
      : target.status;

    const { rows } = await client.query(
      `UPDATE users SET
        endorsements = $1,
        verified = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 RETURNING *`,
      [endorsements, isNowVerified, newStatus, id]
    );

    await client.query('COMMIT');
    await invalidateUserCache(id);

    const updated = mapUserRow(rows[0]);
    if (isNowVerified) {
      sendAccountApprovedEmail(updated).catch(console.error);
    }

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Endorse error:', err);
    res.status(500).json({ error: 'Failed to record endorsement.' });
  } finally {
    client.release();
  }
});

router.post('/dismiss-welcome', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE users SET has_seen_welcome = TRUE WHERE id = $1', [req.user.id]);
    await invalidateUserCache(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Dismiss welcome error:', err);
    res.status(500).json({ error: 'Failed to update welcome state.' });
  }
});

module.exports = router;