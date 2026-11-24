const express = require('express');
const { z } = require('zod');
const { randomUUID } = require('crypto');
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { recordAuditLog } = require('../utils/audit');
const { getSafeUrl } = require('../utils/sanitize');

const router = express.Router();

// =============================================================================
// Shared Helpers: Pagination (OWASP ASVS V11 - Resource Exhaustion Prevention)
// =============================================================================
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/**
 * Parses and strictly bounds pagination parameters from the query string.
 * Never trusts client-supplied limit/offset without clamping, to prevent
 * unbounded result sets from exhausting memory or DB resources.
 */
function parsePagination(req) {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_LIMIT;
  if (limit > MAX_PAGE_LIMIT) limit = MAX_PAGE_LIMIT;

  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (offset > 100000) offset = 100000;

  return { limit, offset };
}

/**
 * Executes a bounded, paginated SELECT * against a fixed (non-user-controlled)
 * table name, returning both the page of results and the total count so the
 * client can render pagination controls.
 *
 * @param {string} tableName - MUST be a hardcoded literal from this file, never user input.
 * @param {import('express').Request} req
 * @param {object} opts
 * @param {string} [opts.whereClause] - Optional SQL WHERE clause (parameterized).
 * @param {Array} [opts.whereParams] - Params for whereClause placeholders ($1, $2, ...).
 * @param {string} [opts.orderClause] - ORDER BY clause (safe, hardcoded per call site).
 */
async function fetchPaginated(tableName, req, opts = {}) {
  const { whereClause = '', whereParams = [], orderClause = 'created_at DESC' } = opts;
  const { limit, offset } = parsePagination(req);

  const countSql = `SELECT COUNT(*)::int AS total FROM ${tableName} ${whereClause}`;
  const dataSql = `SELECT * FROM ${tableName} ${whereClause} ORDER BY ${orderClause} LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countSql, whereParams),
    pool.query(dataSql, [...whereParams, limit, offset])
  ]);

  return {
    items: dataRes.rows,
    total: countRes.rows[0]?.total ?? 0,
    limit,
    offset
  };
}

function isStaff(user) {
  return user.role === 'admin' || user.role === 'superadmin';
}

// =============================================================================
// Shared Helpers: Community Moderation Engine
// (Level 1: 5 community reports auto-purge | Level 2: 10 reports, or 2 Admin votes)
// =============================================================================
async function handleContentReport(req, res, tableName, itemId, level = 2) {
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const itemRes = await client.query(`SELECT * FROM ${tableName} WHERE id = $1 FOR UPDATE`, [itemId]);
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found.' });
    }

    const item = itemRes.rows[0];
    const reportedBy = item.reported_by || [];

    if (reportedBy.includes(userId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You have already flagged this item.' });
    }

    reportedBy.push(userId);
    const newCount = (item.reports_count || 0) + 1;
    const threshold = level === 1 ? 5 : 10;

    if (newCount >= threshold) {
      await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [itemId]);
      await client.query('COMMIT');
      return res.json({ status: 'removed', message: 'Item automatically purged due to community threshold.' });
    }

    await client.query(`UPDATE ${tableName} SET reports_count = $1, reported_by = $2 WHERE id = $3`, [newCount, reportedBy, itemId]);
    await client.query('COMMIT');
    res.json({ status: 'reported', reportsCount: newCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Report error on ${tableName}:`, err);
    res.status(500).json({ error: 'Failed to process report.' });
  } finally {
    client.release();
  }
}

async function handleAdminRemoval(req, res, tableName, itemId, level = 2) {
  if (!isStaff(req.user)) {
    return res.status(403).json({ error: 'Insufficient administrative privileges.' });
  }

  const isSuperAdmin = req.user.role === 'superadmin';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemRes = await client.query(`SELECT * FROM ${tableName} WHERE id = $1 FOR UPDATE`, [itemId]);
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found.' });
    }

    if (isSuperAdmin || level === 1) {
      await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [itemId]);
      await client.query('COMMIT');
      await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `MODERATE_DELETE_${tableName.toUpperCase()}`, itemRes.rows[0], null);
      return res.json({ status: 'deleted', message: 'Item removed by administrator.' });
    }

    let adminRemovals = itemRes.rows[0].admin_removals || [];
    if (!adminRemovals.includes(req.user.id)) adminRemovals.push(req.user.id);

    if (adminRemovals.length >= 2) {
      await client.query(`DELETE FROM ${tableName} WHERE id = $1`, [itemId]);
      await client.query('COMMIT');
      await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `MODERATE_DELETE_${tableName.toUpperCase()}_DUAL_ADMIN`, itemRes.rows[0], null);
      return res.json({ status: 'deleted', message: 'Item deleted after two Admin approvals.' });
    }

    await client.query(`UPDATE ${tableName} SET admin_removals = $1 WHERE id = $2`, [adminRemovals, itemId]);
    await client.query('COMMIT');
    res.json({ status: 'pending_second_admin', adminVotes: adminRemovals.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Admin remove error on ${tableName}:`, err);
    res.status(500).json({ error: 'Failed to execute removal.' });
  } finally {
    client.release();
  }
}

const ENTITY_TABLE_ALLOWLIST = [
  'study_rooms', 'time_capsule_entries', 'academic_exchanges', 'recipes',
  'match_finder_events', 'city_guide_places', 'language_tandems',
  'passion_clubs', 'book_marketplace', 'freebox_items', 'community_startups', 'jukebox_tracks'
];

// =============================================================================
// Contact Sharing (restored — was completely missing from the modular rewrite)
// =============================================================================
const sendContactNoticeSchema = z.object({
  targetUserId: z.string().min(1).max(64),
  featureTitle: z.string().min(1).max(120),
  itemTitle: z.string().min(1).max(255),
  chosenContactType: z.enum(['email', 'phone']),
  customNote: z.string().max(500).optional().nullable()
});

router.post('/send-contact-notice', authenticate, validateRequest({ body: sendContactNoticeSchema }), async (req, res) => {
  const { targetUserId, featureTitle, itemTitle, chosenContactType, customNote } = req.body;

  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'You cannot send a contact notice to yourself.' });
  }

  let sharedDetail = '';
  if (chosenContactType === 'email') {
    sharedDetail = req.user.email ? `✉️ Email: ${req.user.email}` : '';
  } else if (chosenContactType === 'phone') {
    sharedDetail = req.user.phone ? `📞 Phone: ${req.user.phone}` : '';
  }

  if (!sharedDetail) {
    return res.status(400).json({ error: `Selected contact type (${chosenContactType}) is not configured on your profile.` });
  }

  const notifId = `notif-${randomUUID()}`;
  const title = `📬 ${featureTitle}: ${itemTitle}`;
  const message = `${req.user.name} is reaching out regarding your entry [${itemTitle}].\n\nShared Contact Details:\n${sharedDetail}\n${customNote ? `Note: "${customNote}"` : ''}`;

  try {
    await pool.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name, type, title, message, status)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'contact_interest', $6, $7, 'pending')`,
      [notifId, targetUserId, [targetUserId], req.user.id, req.user.name, title, message]
    );
    res.json({ success: true, message: 'Notification and contact dispatched to the creator.' });
  } catch (err) {
    console.error('Send contact notice error:', err);
    res.status(500).json({ error: 'Failed to transmit contact notice.' });
  }
});

// =============================================================================
// 1. Virtual Study Rooms
// =============================================================================
const createStudyRoomSchema = z.object({
  subject: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  meetingLink: z.string().max(2000).optional().nullable(),
  cloudLink: z.string().max(2000).optional().nullable(),
  chatLink: z.string().max(2000).optional().nullable(),
  chosenContact: z.string().max(150).optional().nullable()
});

const updateStudyRoomLinksSchema = z.object({
  meetingLink: z.string().max(2000).optional().nullable(),
  cloudLink: z.string().max(2000).optional().nullable(),
  chatLink: z.string().max(2000).optional().nullable(),
  description: z.string().max(2000).optional().nullable()
});

// =============================================================================
// Join requests (study rooms + passion clubs): creator approval flow
// =============================================================================
const JOIN_TARGETS = {
  study_room:   { table: 'study_rooms',   titleCol: 'subject', label: 'study room' },
  passion_club: { table: 'passion_clubs', titleCol: 'name',    label: 'club' }
};
const memberUserId = (m) => m.userId || m.id;
const PENDING_WINDOW = "INTERVAL '14 days'";

function buildMember(targetType, user, contact) {
  return targetType === 'study_room'
    ? { id: user.id, name: user.name, role: 'member', contact }
    : { userId: user.id, name: user.name, contact };
}

async function createJoinRequest(req, res, targetType, rawContact) {
  const cfg = JOIN_TARGETS[targetType];
  const contact = String(rawContact || req.user.email).trim().slice(0, 150);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query(
      `SELECT id, creator_id, ${cfg.titleCol} AS title, members FROM ${cfg.table} WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (t.rows.length === 0 || !t.rows[0].creator_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `This ${cfg.label} no longer exists.` });
    }
    const target = t.rows[0];
    if ((target.members || []).some(m => memberUserId(m) === req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already a member.' });
    }

    // Una richiesta ignorata per oltre 14 giorni scade e si può rifare
    await client.query(
      `UPDATE join_requests SET status = 'declined', decided_at = NOW()
        WHERE target_type = $1 AND target_id = $2 AND requester_id = $3
          AND status = 'pending' AND created_at <= NOW() - ${PENDING_WINDOW}`,
      [targetType, target.id, req.user.id]
    );
    const dup = await client.query(
      `SELECT 1 FROM join_requests
        WHERE target_type = $1 AND target_id = $2 AND requester_id = $3 AND status = 'pending'`,
      [targetType, target.id, req.user.id]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already have a pending request.' });
    }

    const requestId = `jr-${randomUUID()}`;
    await client.query(
      `INSERT INTO join_requests (id, target_type, target_id, requester_id, requester_name, chosen_contact)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, targetType, target.id, req.user.id, req.user.name, contact]
    );
    await client.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name,
                                  type, title, message, status, resource_type, resource_id)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'join_request', $6, $7, 'pending', 'join_request', $8)`,
      [
        `notif-${randomUUID()}`, target.creator_id, [target.creator_id], req.user.id, req.user.name,
        `🔑 Join request: ${String(target.title).slice(0, 180)}`,
        `${req.user.name} would like to join your ${cfg.label} "${target.title}".\nContact they would share with members: ${contact}`,
        requestId
      ]
    );
    await client.query('COMMIT');
    res.status(202).json({ status: 'pending', requestId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create join request error:', err);
    res.status(500).json({ error: 'Failed to send the request.' });
  } finally {
    client.release();
  }
}

const respondJoinRequestSchema = z.object({ decision: z.enum(['accept', 'decline']) });

router.post('/join-requests/:id/respond', authenticate, validateRequest({ body: respondJoinRequestSchema }), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const peek = await client.query('SELECT target_type, target_id FROM join_requests WHERE id = $1', [req.params.id]);
    if (peek.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found.' });
    }
    const cfg = JOIN_TARGETS[peek.rows[0].target_type];
    const t = await client.query(
      `SELECT id, creator_id, ${cfg.titleCol} AS title, members FROM ${cfg.table} WHERE id = $1 FOR UPDATE`,
      [peek.rows[0].target_id]
    );
    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `This ${cfg.label} no longer exists.` });
    }
    const target = t.rows[0];
    if (target.creator_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the creator can answer this request.' });
    }

    const jr = await client.query('SELECT * FROM join_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const reqRow = jr.rows[0];
    if (!reqRow || reqRow.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request was already handled.' });
    }

    const accept = req.body.decision === 'accept';
    const newStatus = accept ? 'accepted' : 'declined';

    if (accept) {
      const members = target.members || [];
      if (!members.some(m => memberUserId(m) === reqRow.requester_id)) {
        members.push(buildMember(reqRow.target_type, { id: reqRow.requester_id, name: reqRow.requester_name }, reqRow.chosen_contact));
        await client.query(`UPDATE ${cfg.table} SET members = $1 WHERE id = $2`, [JSON.stringify(members), target.id]);
      }
    }

    await client.query('UPDATE join_requests SET status = $1, decided_at = NOW() WHERE id = $2', [newStatus, reqRow.id]);
    await client.query(
      `UPDATE notifications SET status = $1 WHERE resource_type = 'join_request' AND resource_id = $2`,
      [newStatus, reqRow.id]
    );
    await client.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name,
                                  type, title, message, status)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'join_response', $6, $7, 'pending')`,
      [
        `notif-${randomUUID()}`, reqRow.requester_id, [reqRow.requester_id], req.user.id, req.user.name,
        `${accept ? '✅ Request accepted' : '❌ Request declined'}: ${String(target.title).slice(0, 180)}`,
        accept
          ? `You are now a member of the ${cfg.label} "${target.title}". Open it to see the members and the links.`
          : `The creator of the ${cfg.label} "${target.title}" declined your request.`
      ]
    );
    await client.query('COMMIT');
    res.json({ status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Respond join request error:', err);
    res.status(500).json({ error: 'Failed to process the request.' });
  } finally {
    client.release();
  }
});


async function maskForViewer(items, user, targetType) {
  const pending = await pool.query(
    `SELECT target_id FROM join_requests
      WHERE target_type = $1 AND requester_id = $2 AND status = 'pending'
        AND created_at > NOW() - ${PENDING_WINDOW}`,
    [targetType, user.id]
  );
  const pendingIds = new Set(pending.rows.map(r => r.target_id));
  const staff = isStaff(user);

  return items.map(row => {
    const members = row.members || [];
    const isMember = members.some(m => memberUserId(m) === user.id);
    const base = {
      ...row,
      member_count: members.length,
      my_request_status: pendingIds.has(row.id) ? 'pending' : null
    };
    if (isMember || staff) return base;
    return {
      ...base,
      members: [],
      meeting_link: null,
      chat_link: null,
      ...(targetType === 'study_room' ? { cloud_link: null } : { resources: [], events: [] }),
      reported_by: [],
      admin_removals: []
    };
  });
}

const joinStudyRoomSchema = z.object({
  chosenContact: z.string().min(1).max(150)
});

router.get('/study-rooms', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('study_rooms', req);
    page.items = await maskForViewer(page.items, req.user, 'study_room');
    res.json(page);
  } catch (err) {
    console.error('List study rooms error:', err);
    res.status(500).json({ error: 'Failed to load study rooms.' });
  }
});

router.post('/study-rooms', authenticate, validateRequest({ body: createStudyRoomSchema }), async (req, res) => {
  const { subject, description, meetingLink, cloudLink, chatLink, chosenContact } = req.body;
  const id = `room-${randomUUID()}`;
  const initialMembers = [{ id: req.user.id, name: req.user.name, role: 'creator', contact: chosenContact || req.user.email }];

  try {
    const { rows } = await pool.query(
      `INSERT INTO study_rooms (id, creator_id, subject, description, meeting_link, cloud_link, chat_link, members)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, req.user.id, subject.trim(), description || '', getSafeUrl(meetingLink, ''), getSafeUrl(cloudLink, ''), getSafeUrl(chatLink, ''), JSON.stringify(initialMembers)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create study room error:', err);
    res.status(500).json({ error: 'Failed to create room.' });
  }
});

router.put('/study-rooms/:id/links', authenticate, validateRequest({ body: updateStudyRoomLinksSchema }), async (req, res) => {
  const { meetingLink, cloudLink, chatLink, description } = req.body;
  try {
    const check = await pool.query('SELECT members FROM study_rooms WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Room not found.' });

    const members = check.rows[0].members || [];
    const isMember = members.some(m => m.id === req.user.id);
    if (!isMember && !isStaff(req.user)) {
      return res.status(403).json({ error: 'Only active room members can edit room links.' });
    }

    const { rows } = await pool.query(
      `UPDATE study_rooms
       SET meeting_link = COALESCE($1, meeting_link), cloud_link = COALESCE($2, cloud_link),
           chat_link = COALESCE($3, chat_link), description = COALESCE($4, description)
       WHERE id = $5 RETURNING *`,
      [meetingLink ? getSafeUrl(meetingLink, '') : null, cloudLink ? getSafeUrl(cloudLink, '') : null, chatLink ? getSafeUrl(chatLink, '') : null, description, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update study room links error:', err);
    res.status(500).json({ error: 'Failed to update links.' });
  }
});

router.post('/study-rooms/:id/join', authenticate, validateRequest({ body: joinStudyRoomSchema }),
  (req, res) => createJoinRequest(req, res, 'study_room', req.body.chosenContact));

router.post('/study-rooms/:id/leave', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT creator_id, members FROM study_rooms WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Room not found.' });
    }

    const members = rows[0].members || [];
    if (!members.some(m => m.id === req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are not a member of this room.' });
    }

    const remaining = members.filter(m => m.id !== req.user.id);

    if (remaining.length === 0) {
      await client.query('DELETE FROM study_rooms WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      return res.json({ status: 'deleted' });
    }

    let creatorId = rows[0].creator_id;
    if (creatorId === req.user.id) {
      creatorId = remaining[0].id;
      remaining[0] = { ...remaining[0], role: 'creator' };
    }

    const update = await client.query(
      'UPDATE study_rooms SET members = $1, creator_id = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(remaining), creatorId, req.params.id]
    );


    if (creatorId !== rows[0].creator_id) {
      await client.query(
        `UPDATE notifications SET recipient_id = $1, recipient_ids = ARRAY[$1]::text[]
          WHERE type = 'join_request' AND status IN ('pending', 'read')
            AND resource_id IN (SELECT id FROM join_requests
                                 WHERE target_type = 'study_room' AND target_id = $2 AND status = 'pending')`,
        [creatorId, req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json(update.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Leave study room error:', err);
    res.status(500).json({ error: 'Failed to leave room.' });
  } finally {
    client.release();
  }
});

router.delete('/study-rooms/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM study_rooms
        WHERE id = $1 AND (creator_id = $2 OR $3 IN ('admin', 'superadmin'))
        RETURNING id`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found or not allowed.' });
    res.json({ status: 'deleted' });
  } catch (err) {
    console.error('Delete study room error:', err);
    res.status(500).json({ error: 'Failed to delete room.' });
  }
});

router.post('/study-rooms/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'study_rooms', req.params.id, 2));
router.delete('/study-rooms/:id/moderate', authenticate, (req, res) => handleAdminRemoval(req, res, 'study_rooms', req.params.id, 2));

// =============================================================================
// 2. Annual Time Capsule (Level 1 moderation)
// =============================================================================
const TIME_CAPSULE_SECTIONS = ['Residence_name_1','Residence_name_2','Residence_name_3'];

function getCurrentAcademicYear(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);

  const START_MONTH = 9; 
  const START_DAY = 1; 

  const afterStart = month > START_MONTH || (month === START_MONTH && day >= START_DAY);
  const startYear = afterStart ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

// -----------------------------------------------------------------------------
// TIME CAPSULE TIMING - the place to change when capsules close / open.
// Defaults: collect until July 31 of the academic year, unlock 3 years later.
// For testing (non-production only) set in .env:
//   TIME_CAPSULE_SEAL_DATE=2026-10-10     (all capsules close on this day)
//   TIME_CAPSULE_UNLOCK_DATE=2026-10-12   (all capsules open on this day)
//   TIME_CAPSULE_FAKE_TODAY=2026-10-11    (pretend today is this date)
// Existing capsule rows are re-synced automatically on the next request.
// -----------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function testOverride(name) {
  if (process.env.NODE_ENV === 'production') return null;
  const v = String(process.env[name] || '').trim();
  return ISO_DATE.test(v) ? v : null;
}

function getCapsuleSchedule(academicYear) {
  const match = /^(\d{4})\/(\d{4})$/.exec(academicYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  const startYear = Number(match[1]);
  // Contributions are accepted from September 1 through July 30 inclusive.
  const sealDate = new Date(Date.UTC(startYear+1 , 6, 31)); 
  const unlockDate = new Date(Date.UTC(startYear+4 , 6, 31));
  return {
    sealDate: testOverride('TIME_CAPSULE_SEAL_DATE') || sealDate.toISOString().slice(0, 10),
    unlockDate: testOverride('TIME_CAPSULE_UNLOCK_DATE') || unlockDate.toISOString().slice(0, 10)
  };
}

function getLocalDateString(date = new Date()) {
  const fake = testOverride('TIME_CAPSULE_FAKE_TODAY');
  if (fake) return fake;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function syncTimeCapsuleState(capsule) {
  const schedule = getCapsuleSchedule(capsule.academic_year);
  if (!schedule) return capsule;

  const today = getLocalDateString();
  const isSealed = today >= schedule.sealDate;

  const currentSeal = capsule.seal_date instanceof Date
    ? capsule.seal_date.toISOString().slice(0, 10)
    : String(capsule.seal_date).slice(0, 10);

  const currentUnlock = capsule.unlock_date instanceof Date
    ? capsule.unlock_date.toISOString().slice(0, 10)
    : String(capsule.unlock_date).slice(0, 10);

  if (
    currentSeal !== schedule.sealDate ||
    currentUnlock !== schedule.unlockDate ||
    Boolean(capsule.is_sealed) !== isSealed
  ) {
    const { rows } = await pool.query(
      `UPDATE time_capsules
       SET seal_date = $1, unlock_date = $2, is_sealed = $3
       WHERE id = $4
       RETURNING *`,
      [schedule.sealDate, schedule.unlockDate, isSealed, capsule.id]
    );
    return rows[0] || capsule;
  }

  return capsule;
}


const createTimeCapsuleEntrySchema = z.object({
  entryType: z.enum(['quote', 'text', 'photo']),
  content: z.string().min(1).max(3000),
  photoUrl: z.string().max(2000).optional().nullable()
});

// =============================================================================
// Helper di sblocco corretto (compatibile con oggetti Date di node-postgres)
// =============================================================================
function isCapsuleUnlocked(capsule, now = new Date()) {
  const unlockVal = capsule.unlock_date;
  const unlockStr = unlockVal instanceof Date
    ? unlockVal.toISOString().slice(0, 10)
    : String(unlockVal).slice(0, 10);
  return getLocalDateString(now) >= unlockStr;
}

// =============================================================================
// 1. Archivio Storico: Lista capsule sbloccate
// =============================================================================
router.get('/time-capsule/archive', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, section, academic_year, is_sealed, seal_date, unlock_date, created_at FROM time_capsules ORDER BY academic_year DESC, section ASC'
    );
    const synced = await Promise.all(rows.map(syncTimeCapsuleState));
    res.json(synced.filter(c => isCapsuleUnlocked(c)));
  } catch (err) {
    console.error('Time capsule archive error:', err);
    res.status(500).json({ error: 'Failed to load historic archive.' });
  }
});

// =============================================================================
// 2. Archivio Storico: Dettaglio memorie di una capsula sbloccata
// =============================================================================
router.get('/time-capsule/archive/:capsuleId/entries', authenticate, async (req, res) => {
  try {
    const capRes = await pool.query('SELECT * FROM time_capsules WHERE id = $1', [req.params.capsuleId]);
    if (capRes.rows.length === 0) return res.status(404).json({ error: 'Capsule not found.' });

    const capsule = await syncTimeCapsuleState(capRes.rows[0]);
    if (!isCapsuleUnlocked(capsule)) {
      return res.status(403).json({ error: 'This time capsule is still sealed and not yet open to the public.' });
    }

    const page = await fetchPaginated('time_capsule_entries', req, {
      whereClause: 'WHERE capsule_id = $1 AND is_confirmed = TRUE',
      whereParams: [capsule.id],
      orderClause: 'created_at ASC'
    });

    res.json({
      capsule,
      entries: page.items,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      isUnlocked: true
    });
  } catch (err) {
    console.error('Fetch historic entries error:', err);
    res.status(500).json({ error: 'Failed to fetch archived capsule memories.' });
  }
});

// =============================================================================
// 3. Capsula Attiva: Esclusivamente anno corrente e sezione in corso
// =============================================================================
router.get('/time-capsule/:section', authenticate, async (req, res) => {
  const parsedSection = z.enum(TIME_CAPSULE_SECTIONS).safeParse(req.params.section);
  if (!parsedSection.success) return res.status(400).json({ error: 'Invalid section.' });
  const section = parsedSection.data;

  // La capsula attiva riguarda SEMPRE e SOLO l'anno accademico corrente
  const academicYear = getCurrentAcademicYear();
  const schedule = getCapsuleSchedule(academicYear);
  if (!schedule) return res.status(400).json({ error: 'Invalid academic year.' });

  try {
    let cap = await pool.query(
      'SELECT * FROM time_capsules WHERE section = $1 AND academic_year = $2',
      [section, academicYear]
    );

    if (cap.rows.length === 0) {
      cap = await pool.query(
        `INSERT INTO time_capsules (id, academic_year, section, seal_date, unlock_date, is_sealed)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         RETURNING *`,
        [`capsule-${randomUUID()}`, academicYear, section, schedule.sealDate, schedule.unlockDate]
      );
    }

    const capsule = await syncTimeCapsuleState(cap.rows[0]);
    const unlocked = isCapsuleUnlocked(capsule);
    const isCollecting = !capsule.is_sealed && !unlocked;

    let entries = [];
    let total = 0;
    let limit = 20;
    let offset = 0;

    // Le memorie si vedono SOLO durante la raccolta e SOLO ai residenti della sezione.
    // Sigillata o sbloccata: entries resta [] (le sbloccate si leggono dall'archivio).
    if (isCollecting && capsule.section === req.user.residence) {
      const page = await fetchPaginated('time_capsule_entries', req, {
        whereClause: 'WHERE capsule_id = $1',
        whereParams: [capsule.id],
        orderClause: 'created_at DESC'
      });
      ({ items: entries, total, limit, offset } = page);
    }

    res.json({
      capsule,
      entries,
      total,
      limit,
      offset,
      acceptingEntries: isCollecting,
      isUnlocked: unlocked
    });
  } catch (err) {
    console.error('Fetch time capsule error:', err);
    res.status(500).json({ error: 'Failed to fetch capsule.' });
  }
});

router.post('/time-capsule/:capsuleId/entries', authenticate, validateRequest({ body: createTimeCapsuleEntrySchema }), async (req, res) => {
  const { entryType, content, photoUrl } = req.body;
  try {
    const capsuleCheck = await pool.query(
      'SELECT * FROM time_capsules WHERE id = $1',
      [req.params.capsuleId]
    );
    if (capsuleCheck.rows.length === 0) return res.status(404).json({ error: 'Time capsule not found.' });

    const capsule = await syncTimeCapsuleState(capsuleCheck.rows[0]);
    if (capsule.section !== req.user.residence) {
      return res.status(403).json({ error: 'You can only contribute to your own section capsule.' });
    }
    if (capsule.is_sealed || isCapsuleUnlocked(capsule)) {
      return res.status(409).json({ error: 'This time capsule is closed and no longer accepts entries.' });
    }

    const safePhotoUrl = photoUrl ? getSafeUrl(photoUrl, '') : '';
    if (photoUrl && !safePhotoUrl) {
      return res.status(400).json({ error: 'Invalid photo URL.' });
    }

    const id = `tce-${randomUUID()}`;
    const { rows } = await pool.query(
      `INSERT INTO time_capsule_entries (id, capsule_id, author_id, author_name, section, entry_type, content, photo_url, confirmed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, req.params.capsuleId, req.user.id, req.user.name, req.user.residence, entryType, content.trim(), safePhotoUrl || null, [req.user.id]]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create time capsule entry error:', err);
    res.status(500).json({ error: 'Failed to record entry.' });
  }
});

router.post('/time-capsule/entries/:id/confirm', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM time_capsule_entries WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });

    const entry = rows[0];
    const capsuleResult = await pool.query('SELECT * FROM time_capsules WHERE id = $1', [entry.capsule_id]);
    if (!capsuleResult.rows.length) return res.status(404).json({ error: 'Time capsule not found.' });
    const capsule = await syncTimeCapsuleState(capsuleResult.rows[0]);

    if (capsule.section !== req.user.residence) {
      return res.status(403).json({ error: 'Only residents of this section can confirm its memories.' });
    }
    if (capsule.is_sealed || isCapsuleUnlocked(capsule)) {
      return res.status(409).json({ error: 'This time capsule is already closed.' });
    }

    let confirmedBy = Array.isArray(entry.confirmed_by) ? entry.confirmed_by : [];
    if (confirmedBy.includes(req.user.id)) return res.status(400).json({ error: 'Already confirmed.' });

    confirmedBy = [...confirmedBy, req.user.id];
    const update = await pool.query(
      'UPDATE time_capsule_entries SET confirmed_by = $1, is_confirmed = $2 WHERE id = $3 RETURNING *',
      [confirmedBy, confirmedBy.length >= 3, req.params.id]
    );
    res.json(update.rows[0]);
  } catch (err) {
    console.error('Confirm time capsule entry error:', err);
    res.status(500).json({ error: 'Failed to confirm memory.' });
  }
});

router.post('/time-capsule/entries/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'time_capsule_entries', req.params.id, 1));
router.delete('/time-capsule/entries/:id', authenticate, async (req,res) => {
  try {
    const { rows } = await pool.query('DELETE FROM time_capsule_entries WHERE id=$1 AND author_id=$2 AND is_confirmed=FALSE RETURNING *',[req.params.id,req.user.id]);
    if (!rows.length) return res.status(404).json({error:'Entry not found, already sealed, or not owned by you.'});
    res.json({success:true});
  } catch(err){ console.error('Delete time capsule entry error:',err); res.status(500).json({error:'Failed to delete memory.'}); }
});

router.delete('/time-capsule/entries/:id/moderate', authenticate, (req, res) => handleAdminRemoval(req, res, 'time_capsule_entries', req.params.id, 1));

// =============================================================================
// 3. The World of Academics (Academic Exchanges Map)
// =============================================================================
const academicsMapSchema = z.object({
  universityName: z.string().min(1).max(255),
  city: z.string().min(1).max(128),
  country: z.string().min(1).max(128),
  programType: z.string().max(64).optional().nullable(),
  academicsRating: z.coerce.number().int().min(1).max(5).optional(),
  costOfLivingRating: z.coerce.number().int().min(1).max(5).optional(),
  housingRating: z.coerce.number().int().min(1).max(5).optional(),
  neighborhoodAdvice: z.string().max(2000).optional().nullable(),
  coords: z.array(z.number().finite()).length(2)
    .refine(([lat, lng]) => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180, 'Invalid coordinates')
    .optional().nullable()
});

router.get('/academics-map', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('academic_exchanges', req);
    res.json(page);
  } catch (err) {
    console.error('List academics map error:', err);
    res.status(500).json({ error: 'Failed to load academics map.' });
  }
});

router.post('/academics-map', authenticate, validateRequest({ body: academicsMapSchema }), async (req, res) => {
  const { universityName, city, country, programType, academicsRating, costOfLivingRating, housingRating, neighborhoodAdvice, coords } = req.body;
  const id = `acad-${randomUUID()}`;
  const cleanCoords = Array.isArray(coords) && coords.length === 2 ? coords : [45.0683, 7.6831];
  try {
    const { rows } = await pool.query(
      `INSERT INTO academic_exchanges (id, user_id, user_name, university_name, city, country, program_type, academics_rating, cost_of_living_rating, housing_rating, neighborhood_advice, coords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [id, req.user.id, req.user.name, universityName, city, country, programType || 'Erasmus+', academicsRating || 5, costOfLivingRating || 3, housingRating || 4, neighborhoodAdvice || '', cleanCoords]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create academics map entry error:', err);
    res.status(500).json({ error: 'Failed to record exchange.' });
  }
});

// Restored: legacy had a PUT (edit) route here that the modular rewrite dropped.
router.put('/academics-map/:id', authenticate, validateRequest({ body: academicsMapSchema }), async (req, res) => {
  const { universityName, city, country, programType, academicsRating, costOfLivingRating, housingRating, neighborhoodAdvice, coords } = req.body;
  try {
    const check = await pool.query('SELECT user_id FROM academic_exchanges WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Review not found.' });
    if (check.rows[0].user_id !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You can only edit your own reviews.' });
    }

    const cleanCoords = Array.isArray(coords) && coords.length === 2 ? coords : [45.0683, 7.6831];
    const { rows } = await pool.query(
      `UPDATE academic_exchanges
       SET university_name = $1, city = $2, country = $3, program_type = $4, academics_rating = $5,
           cost_of_living_rating = $6, housing_rating = $7, neighborhood_advice = $8, coords = $9
       WHERE id = $10 RETURNING *`,
      [universityName, city, country, programType || 'Erasmus+', academicsRating || 5, costOfLivingRating || 3, housingRating || 4, neighborhoodAdvice || '', cleanCoords, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update academics map entry error:', err);
    res.status(500).json({ error: 'Failed to update review.' });
  }
});

router.delete('/academics-map/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM academic_exchanges WHERE id = $1 AND (user_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Record not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete academics map entry error:', err);
    res.status(500).json({ error: 'Failed to delete exchange record.' });
  }
});

router.post('/academics-map/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'academic_exchanges', req.params.id, 2));

// =============================================================================
// 4. Social Kitchen (Recipes & Ratings)
// =============================================================================
const recipeSchema = z.object({
  title: z.string().min(1).max(255),
  regionalOrigin: z.string().max(128).optional().nullable(),
  ingredients: z.string().min(1).max(4000),
  steps: z.string().min(1).max(8000),
  imageUrl: z.string().max(2000).optional().nullable()
});

const rateRecipeSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5)
});

router.get('/recipes', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('recipes', req, { orderClause: 'average_rating DESC, total_votes DESC, created_at DESC' });
    res.json(page);
  } catch (err) {
    console.error('List recipes error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes.' });
  }
});

router.post('/recipes', authenticate, validateRequest({ body: recipeSchema }), async (req, res) => {
  const { title, regionalOrigin, ingredients, steps, imageUrl } = req.body;
  const id = `rec-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO recipes (id, author_id, author_name, residence, title, regional_origin, ingredients, steps, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.residence, title.trim(), regionalOrigin || 'Regional', ingredients, steps, getSafeUrl(imageUrl, '/tiles/photo.jpg')]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create recipe error:', err);
    res.status(500).json({ error: 'Failed to save recipe.' });
  }
});

router.post('/recipes/:id/rate', authenticate, validateRequest({ body: rateRecipeSchema }), async (req, res) => {
  const { rating } = req.body;
  try {
    const { rows } = await pool.query('SELECT ratings FROM recipes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Recipe not found.' });

    let ratings = rows[0].ratings || {};
    ratings[req.user.id] = rating;
    const values = Object.values(ratings);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    const update = await pool.query(
      'UPDATE recipes SET ratings = $1, average_rating = $2, total_votes = $3 WHERE id = $4 RETURNING *',
      [JSON.stringify(ratings), avg.toFixed(2), values.length, req.params.id]
    );
    res.json(update.rows[0]);
  } catch (err) {
    console.error('Rate recipe error:', err);
    res.status(500).json({ error: 'Failed to record rating.' });
  }
});

// Restored: legacy had a PUT (edit) route here that the modular rewrite dropped.
router.put('/recipes/:id', authenticate, validateRequest({ body: recipeSchema }), async (req, res) => {
  const { title, regionalOrigin, ingredients, steps, imageUrl } = req.body;
  try {
    const check = await pool.query('SELECT author_id FROM recipes WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Recipe not found.' });
    if (check.rows[0].author_id !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You can only edit your own recipes.' });
    }

    const { rows } = await pool.query(
      `UPDATE recipes
       SET title = $1, regional_origin = $2, ingredients = $3, steps = $4, image_url = $5
       WHERE id = $6 RETURNING *`,
      [title, regionalOrigin || 'Regional', ingredients, steps, getSafeUrl(imageUrl, '/tiles/photo.jpg'), req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update recipe error:', err);
    res.status(500).json({ error: 'Failed to update recipe.' });
  }
});

router.delete('/recipes/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM recipes WHERE id = $1 AND (author_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Recipe not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete recipe error:', err);
    res.status(500).json({ error: 'Failed to delete recipe.' });
  }
});

router.post('/recipes/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'recipes', req.params.id, 2));

// =============================================================================
// 5. Residence Jukebox (Spotify links only)
// =============================================================================
const jukeboxSchema = z.object({
  spotifyUrl: z.string().min(1).max(500),
  existingTrackId: z.string().max(64).optional().nullable()
});

router.get('/jukebox', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('jukebox_tracks', req);
    res.json(page);
  } catch (err) {
    console.error('List jukebox error:', err);
    res.status(500).json({ error: 'Failed to load jukebox.' });
  }
});

router.post('/jukebox', authenticate, validateRequest({ body: jukeboxSchema }), async (req, res) => {
  const { spotifyUrl, existingTrackId } = req.body;

  // Strict allowlist: only genuine Spotify track URLs, https only, to prevent
  // arbitrary iframe-src injection through the CSP-allowed open.spotify.com origin.
  let parsedUrl;
  try {
    parsedUrl = new URL(spotifyUrl);
  } catch {
    return res.status(400).json({ error: 'Valid Spotify track link required.' });
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== 'open.spotify.com' ||
    !parsedUrl.pathname.startsWith('/track/')
  ) {
    return res.status(400).json({ error: 'Valid Spotify track link required.' });
  }

  const match = parsedUrl.pathname.match(/^\/track\/([a-zA-Z0-9]+)/);
  if (!match) {
    return res.status(400).json({ error: 'Valid Spotify track link required.' });
  }

  const trackId = match[1];
  const canonicalUrl = `https://open.spotify.com/track/${trackId}`;
  let trackTitle = 'Spotify Track';
  let trackArtist = 'Artist';

  const decodeHtml = value => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const extractMeta = (html, key, attr = 'property') => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    );
    const reversePattern = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escapedKey}["'][^>]*>`,
      'i'
    );
    return decodeHtml(html.match(pattern)?.[1] || html.match(reversePattern)?.[1] || '');
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const metadataRes = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Sitov13-Jukebox/1.0'
        }
      }
    );

    if (metadataRes.ok) {
      const metadata = await metadataRes.json();
      if (metadata.title?.trim()) trackTitle = metadata.title.trim().slice(0, 255);
      if (metadata.author_name?.trim()) trackArtist = metadata.author_name.trim().slice(0, 255);
    }
    clearTimeout(timer);
  } catch (err) {
    console.warn('[JUKEBOX METADATA] oEmbed lookup failed:', err.message);
  }

  // oEmbed normally supplies author_name, but Spotify may omit it depending
  // on the response/cache. Fall back to the track page's OpenGraph metadata.
  if (trackArtist === 'Artist' || trackTitle === 'Spotify Track') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const pageRes = await fetch(canonicalUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; Sitov13-Jukebox/1.0)'
        }
      });

      if (pageRes.ok) {
        const contentLength = Number(pageRes.headers.get('content-length'));
        if (!Number.isFinite(contentLength) || contentLength <= 1024 * 1024) {
          const html = (await pageRes.text()).slice(0, 1024 * 1024);
          const ogTitle = extractMeta(html, 'og:title');
          const ogDescription = extractMeta(html, 'og:description');
          const description = extractMeta(html, 'description', 'name');

          if (trackTitle === 'Spotify Track' && ogTitle) {
            trackTitle = ogTitle.trim().slice(0, 255);
          }

          if (trackArtist === 'Artist') {
            const candidate = ogDescription || description;
            // Spotify descriptions commonly contain "Song · Artist · ...".
            const parts = candidate
              .split(/\s+[·•|]\s+/)
              .map(part => part.trim())
              .filter(Boolean);
            if (parts.length >= 2) {
              const possibleArtist = parts[0];
              if (possibleArtist && possibleArtist.length <= 255) {
                trackArtist = possibleArtist.slice(0, 255);
              }
            }
          }
        }
      }
      clearTimeout(timer);
    } catch (err) {
      console.warn('[JUKEBOX METADATA] Track-page lookup failed:', err.message);
    }
  }

  try {
    // A resident may not put the same Spotify track in two of their three
    // personal slots. Other residents may share the same track; the UI
    // deduplicates those copies in the community feed.
    const duplicate = await pool.query(
      `SELECT * FROM jukebox_tracks
       WHERE user_id = $1
         AND spotify_track_id = $2
         AND ($3::text IS NULL OR id <> $3)
       LIMIT 1`,
      [req.user.id, trackId, existingTrackId || null]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        error: `You already have this song in another slot: ${trackTitle} — ${trackArtist}.`,
        existingTrack: duplicate.rows[0]
      });
    }

    if (existingTrackId) {
      const { rows } = await pool.query(
        `UPDATE jukebox_tracks
         SET spotify_url = $1,
             spotify_track_id = $2,
             track_title = $3,
             track_artist = $4
         WHERE id = $5 AND user_id = $6
         RETURNING *`,
        [canonicalUrl, trackId, trackTitle, trackArtist, existingTrackId, req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Track slot not found or unauthorized.' });
      }

      return res.json(rows[0]);
    }

    const id = `juke-${randomUUID()}`;
    const { rows } = await pool.query(
      `INSERT INTO jukebox_tracks (
        id, user_id, user_name, residence, spotify_url, spotify_track_id,
        track_title, track_artist
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        req.user.id,
        req.user.name,
        req.user.residence,
        canonicalUrl,
        trackId,
        trackTitle,
        trackArtist
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Add jukebox track error:', err);
    if (err.code === '23505') {
      return res.status(409).json({
        error: `You already have this song in another slot: ${trackTitle} — ${trackArtist}.`
      });
    }
    res.status(500).json({ error: 'Failed to add track.' });
  }
});

router.post('/jukebox/:id/like', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT likes FROM jukebox_tracks WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Track not found.' });

    let likes = rows[0].likes || [];
    likes = likes.includes(req.user.id) ? likes.filter(u => u !== req.user.id) : [...likes, req.user.id];

    const update = await pool.query('UPDATE jukebox_tracks SET likes = $1 WHERE id = $2 RETURNING *', [likes, req.params.id]);
    res.json(update.rows[0]);
  } catch (err) {
    console.error('Toggle jukebox like error:', err);
    res.status(500).json({ error: 'Failed to toggle like.' });
  }
});

router.delete('/jukebox/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM jukebox_tracks WHERE id = $1 AND (user_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Track not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete jukebox track error:', err);
    res.status(500).json({ error: 'Failed to remove track.' });
  }
});

// =============================================================================
// 6. Match Finder (Speed-Friending / Sports Pickup) — RESTORED (was fully missing)
// =============================================================================
const createMatchSchema = z.object({
  category: z.string().min(1).max(64),
  eventDate: z.coerce.date(),
  location: z.string().min(1).max(255),
  missingPlayers: z.coerce.number().int().min(1).max(100),
  contactInfo: z.string().max(150).optional().nullable()
});

const joinMatchSchema = z.object({
  contactInfo: z.string().max(150).optional().nullable()
});

router.get('/matches', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('match_finder_events', req, {
      whereClause: 'WHERE is_archived = FALSE AND event_date >= NOW()',
      orderClause: 'event_date ASC'
    });
    res.json(page);
  } catch (err) {
    console.error('List matches error:', err);
    res.status(500).json({ error: 'Failed to load matches.' });
  }
});

router.post('/matches', authenticate, validateRequest({ body: createMatchSchema }), async (req, res) => {
  const { category, eventDate, location, missingPlayers, contactInfo } = req.body;

  const eventTime = new Date(eventDate);
  const maxDaysAhead = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  if (eventTime < new Date() || eventTime > maxDaysAhead) {
    return res.status(400).json({ error: 'Event date must be in the future and within the next 15 days.' });
  }

  const id = `match-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO match_finder_events (id, creator_id, creator_name, creator_contact, category, event_date, location, missing_players)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, req.user.id, req.user.name, contactInfo || req.user.email, category, eventTime, location, missingPlayers]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create match error:', err);
    res.status(500).json({ error: 'Failed to create match post.' });
  }
});

router.post('/matches/:id/join', authenticate, validateRequest({ body: joinMatchSchema }), async (req, res) => {
  const { contactInfo } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM match_finder_events WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Match not found.' });
    }

    const match = rows[0];
    let participants = match.participants || [];

    if (participants.some(p => p.userId === req.user.id) || match.creator_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already registered for this game.' });
    }
    if (match.missing_players <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This match is already full.' });
    }

    participants.push({ userId: req.user.id, name: req.user.name, contact: contactInfo || req.user.email });
    const newMissing = Math.max(0, match.missing_players - 1);

    const updateRes = await client.query(
      'UPDATE match_finder_events SET participants = $1, missing_players = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(participants), newMissing, req.params.id]
    );
    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Join match error:', err);
    res.status(500).json({ error: 'Failed to join match.' });
  } finally {
    client.release();
  }
});

router.post('/matches/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'match_finder_events', req.params.id, 2));

router.delete('/matches/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM match_finder_events WHERE id = $1 AND (creator_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Match not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete match error:', err);
    res.status(500).json({ error: 'Failed to delete match.' });
  }
});

// =============================================================================
// 7. City Survival Guide — RESTORED (was fully missing)
// =============================================================================
const cityGuideSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(64),
  address: z.string().min(1).max(500),
  practicalAdvice: z.string().min(1).max(2000),
  nearestSections: z.array(z.string().max(64)).max(10).optional()
});

const cityGuideSuggestionSchema = z.object({
  q: z.string().trim().min(2).max(255)
});

const cityGuideReviewSchema = z.object({
  review: z.string().trim().min(1).max(3000)
});

const rateCityGuideSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5)
});

router.get('/city-guide/suggestions', authenticate, validateRequest({ query: cityGuideSuggestionSchema }), async (req, res) => {
  const q = req.query.q.trim();
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.category, p.address, p.average_rating, p.created_at,
              COUNT(r.id)::int AS review_count
       FROM city_guide_places p
       LEFT JOIN city_guide_reviews r ON r.place_id = p.id
       WHERE p.name ILIKE $1 OR p.address ILIKE $1
       GROUP BY p.id
       ORDER BY
         CASE WHEN LOWER(p.name) = LOWER($2) THEN 0
              WHEN LOWER(p.name) LIKE LOWER($3) THEN 1
              ELSE 2 END,
         p.name ASC
       LIMIT 8`,
      [`%${q}%`, q, `${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('City guide suggestions error:', err);
    res.status(500).json({ error: 'Failed to find existing places.' });
  }
});

router.get('/city-guide', authenticate, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT p.*,
                COUNT(r.id)::int AS review_count,
                COALESCE(
                  (
                    SELECT json_agg(preview ORDER BY preview.created_at DESC)
                    FROM (
                      SELECT r2.id, r2.author_id, r2.author_name, r2.review, r2.created_at
                      FROM city_guide_reviews r2
                      WHERE r2.place_id = p.id
                      ORDER BY r2.created_at DESC
                      LIMIT 2
                    ) preview
                  ),
                  '[]'::json
                ) AS review_previews
         FROM city_guide_places p
         LEFT JOIN city_guide_reviews r ON r.place_id = p.id
         GROUP BY p.id
         ORDER BY p.average_rating DESC, p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*)::int AS total FROM city_guide_places')
    ]);
    res.json({ items: rows, total: countRows[0]?.total || 0, limit, offset });
  } catch (err) {
    console.error('List City guide error:', err);
    res.status(500).json({ error: 'Failed to load guide places.' });
  }
});

router.get('/city-guide/:id/reviews', authenticate, async (req, res) => {
  try {
    const { rows: placeRows } = await pool.query('SELECT id, name FROM city_guide_places WHERE id = $1', [req.params.id]);
    if (!placeRows.length) return res.status(404).json({ error: 'Place not found.' });

    const { rows } = await pool.query(
      `SELECT id, author_id, author_name, review, created_at, updated_at
       FROM city_guide_reviews
       WHERE place_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ place: placeRows[0], reviews: rows });
  } catch (err) {
    console.error('List City guide reviews error:', err);
    res.status(500).json({ error: 'Failed to load reviews.' });
  }
});

router.post('/city-guide/:id/reviews', authenticate, validateRequest({ body: cityGuideReviewSchema }), async (req, res) => {
  const review = req.body.review;
  try {
    const { rows: placeRows } = await pool.query('SELECT id, name FROM city_guide_places WHERE id = $1', [req.params.id]);
    if (!placeRows.length) return res.status(404).json({ error: 'Place not found.' });

    const id = `guide-review-${randomUUID()}`;
    const { rows } = await pool.query(
      `INSERT INTO city_guide_reviews (id, place_id, author_id, author_name, review)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, place_id, author_id, author_name, review, created_at, updated_at`,
      [id, req.params.id, req.user.id, req.user.name, review]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You already have a review for this place.' });
    }
    console.error('Create City guide review error:', err);
    res.status(500).json({ error: 'Failed to save review.' });
  }
});

router.post('/city-guide', authenticate, validateRequest({ body: cityGuideSchema }), async (req, res) => {
  const { name, category, address, practicalAdvice, nearestSections } = req.body;
  try {
    const { rows: existing } = await pool.query(
      `SELECT id, name, category, address, average_rating,
              (SELECT COUNT(*)::int FROM city_guide_reviews r WHERE r.place_id = p.id) AS review_count
       FROM city_guide_places p
       WHERE LOWER(REGEXP_REPLACE(TRIM(p.name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($1), '\\s+', ' ', 'g'))
          OR LOWER(REGEXP_REPLACE(TRIM(p.address), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM($2), '\\s+', ' ', 'g'))
       LIMIT 5`,
      [name, address]
    );
    if (existing.length) {
      return res.status(409).json({
        error: 'This place already exists. Add your review to the existing place instead.',
        existingPlaces: existing
      });
    }

    const id = `guide-${randomUUID()}`;
    const { rows } = await pool.query(
      `INSERT INTO city_guide_places (id, author_id, author_name, name, category, address, practical_advice, nearest_sections)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, req.user.id, req.user.name, name, category, address, practicalAdvice, nearestSections || []]
    );

    await pool.query(
      `INSERT INTO city_guide_reviews (id, place_id, author_id, author_name, review)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (place_id, author_id) DO NOTHING`,
      [`guide-review-${randomUUID()}`, id, req.user.id, req.user.name, practicalAdvice]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create City guide entry error:', err);
    res.status(500).json({ error: 'Failed to add place.' });
  }
});

router.post('/city-guide/:id/rate', authenticate, validateRequest({ body: rateCityGuideSchema }), async (req, res) => {
  const { rating } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM city_guide_places WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Place not found.' });

    const ratings = rows[0].ratings || {};
    ratings[req.user.id] = rating;
    const values = Object.values(ratings);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    const updateRes = await pool.query(
      'UPDATE city_guide_places SET ratings = $1, average_rating = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(ratings), avg.toFixed(2), req.params.id]
    );
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Rate City guide entry error:', err);
    res.status(500).json({ error: 'Failed to rate guide place.' });
  }
});

router.post('/city-guide/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'city_guide_places', req.params.id, 2));

router.put('/city-guide/:id', authenticate, validateRequest({ body: cityGuideSchema }), async (req, res) => {
  const { name, category, address, practicalAdvice } = req.body;
  try {
    const check = await pool.query('SELECT author_id FROM city_guide_places WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Place not found.' });
    if (check.rows[0].author_id !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You can only edit your own guide entries.' });
    }

    const { rows } = await pool.query(
      `UPDATE city_guide_places
       SET name = $1, category = $2, address = $3, practical_advice = $4
       WHERE id = $5 RETURNING *`,
      [name, category, address, practicalAdvice, req.params.id]
    );

    await pool.query(
      `UPDATE city_guide_reviews
       SET review = $1, updated_at = CURRENT_TIMESTAMP
       WHERE place_id = $2 AND author_id = $3`,
      [practicalAdvice, req.params.id, req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Update City guide entry error:', err);
    res.status(500).json({ error: 'Failed to update place.' });
  }
});

router.delete('/city-guide/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM city_guide_places WHERE id = $1 AND (author_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Place not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete City guide entry error:', err);
    res.status(500).json({ error: 'Failed to delete place.' });
  }
});

// =============================================================================
// 8. Language Tandem — RESTORED (was fully missing)
// =============================================================================
const createTandemSchema = z.object({
  nativeLanguage: z.string().min(1).max(64),
  targetLanguage: z.string().min(1).max(64),
  declaredLevel: z.enum(['Native', 'Intermediate', 'Beginner']),
  meetingPreference: z.string().max(500).optional().nullable(),
  contactInfo: z.string().max(150).optional().nullable()
});

const joinTandemSchema = z.object({
  contactInfo: z.string().max(150).optional().nullable(),
  level: z.enum(['Native', 'Intermediate', 'Beginner']).optional()
});

router.get('/tandem', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('language_tandems', req);
    res.json(page);
  } catch (err) {
    console.error('List tandems error:', err);
    res.status(500).json({ error: 'Failed to load tandems.' });
  }
});

router.post('/tandem', authenticate, validateRequest({ body: createTandemSchema }), async (req, res) => {
  const { nativeLanguage, targetLanguage, declaredLevel, meetingPreference, contactInfo } = req.body;
  const id = `tan-${randomUUID()}`;
  const initialMembers = [{ userId: req.user.id, name: req.user.name, contact: contactInfo || req.user.email, level: declaredLevel }];

  try {
    const { rows } = await pool.query(
      `INSERT INTO language_tandems (id, creator_id, creator_name, native_language, target_language, declared_level, meeting_preference, members)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, req.user.id, req.user.name, nativeLanguage, targetLanguage, declaredLevel, meetingPreference || '', JSON.stringify(initialMembers)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create tandem error:', err);
    res.status(500).json({ error: 'Failed to create tandem.' });
  }
});

router.post('/tandem/:id/join', authenticate, validateRequest({ body: joinTandemSchema }), async (req, res) => {
  const { contactInfo, level } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM language_tandems WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tandem not found.' });
    }

    let members = rows[0].members || [];
    if (members.some(m => m.userId === req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already enrolled.' });
    }

    members.push({ userId: req.user.id, name: req.user.name, contact: contactInfo || req.user.email, level: level || 'Intermediate' });
    const updateRes = await client.query('UPDATE language_tandems SET members = $1 WHERE id = $2 RETURNING *', [JSON.stringify(members), req.params.id]);
    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Join tandem error:', err);
    res.status(500).json({ error: 'Failed to join tandem.' });
  } finally {
    client.release();
  }
});

router.post('/tandem/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'language_tandems', req.params.id, 2));

router.delete('/tandem/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM language_tandems WHERE id = $1 AND (creator_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tandem not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete tandem error:', err);
    res.status(500).json({ error: 'Failed to delete tandem.' });
  }
});

// =============================================================================
// 9. Passion Clubs (Permanent Circles) — RESTORED (was fully missing)
// =============================================================================
const createPassionClubSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(3000)
});

const joinPassionClubSchema = z.object({
  contactInfo: z.string().max(150).optional().nullable()
});

// NOTE: the legacy handler for this route referenced `url`/`title` without
// destructuring them from req.body (a ReferenceError at runtime).
// Fixed here with an explicit, validated schema.
const addClubResourceSchema = z.object({
  title: z.string().min(1).max(255),
  url: z.string().min(1).max(2000)
});

const updatePassionClubSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(3000).optional(),
  meetingLink: z.string().max(2000).optional().nullable(),
  chatLink: z.string().max(2000).optional().nullable()
});

router.get('/passion-clubs', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('passion_clubs', req);
    page.items = await maskForViewer(page.items, req.user, 'passion_club');
    res.json(page);
  } catch (err) {
    console.error('List passion clubs error:', err);
    res.status(500).json({ error: 'Failed to load passion clubs.' });
  }
});

router.post('/passion-clubs', authenticate, validateRequest({ body: createPassionClubSchema }), async (req, res) => {
  const { name, description } = req.body;
  const id = `club-${randomUUID()}`;
  const initialMembers = [{ userId: req.user.id, name: req.user.name, contact: req.user.phone || req.user.email }];

  try {
    const { rows } = await pool.query(
      `INSERT INTO passion_clubs (id, creator_id, name, category, description, members)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, req.user.id, name.trim(), 'Club', description.trim(), JSON.stringify(initialMembers)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create passion club error:', err);
    res.status(500).json({ error: 'Failed to create passion club.' });
  }
});

router.post('/passion-clubs/:id/join', authenticate, validateRequest({ body: joinPassionClubSchema }),
  (req, res) => createJoinRequest(req, res, 'passion_club', req.body.contactInfo));


router.post('/passion-clubs/:id/leave', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT creator_id, members FROM passion_clubs WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Club not found.' });
    }

    const members = rows[0].members || [];
    const isMe = (m) => (m.userId || m.id) === req.user.id;
    if (!members.some(isMe)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are not a member of this club.' });
    }

    const remaining = members.filter(m => !isMe(m));
    if (remaining.length === 0) {
      await client.query('DELETE FROM passion_clubs WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      return res.json({ status: 'deleted' });
    }

    let creatorId = rows[0].creator_id;
    if (creatorId === req.user.id) creatorId = remaining[0].userId || remaining[0].id;

    const update = await client.query(
      'UPDATE passion_clubs SET members = $1, creator_id = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(remaining), creatorId, req.params.id]
    );


    if (creatorId !== rows[0].creator_id) {
      await client.query(
        `UPDATE notifications SET recipient_id = $1, recipient_ids = ARRAY[$1]::text[]
          WHERE type = 'join_request' AND status IN ('pending', 'read')
            AND resource_id IN (SELECT id FROM join_requests
                                 WHERE target_type = 'passion-clubs' AND target_id = $2 AND status = 'pending')`,
        [creatorId, req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json(update.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Leave passion club error:', err);
    res.status(500).json({ error: 'Failed to leave club.' });
  } finally {
    client.release();
  }
});

router.post('/passion-clubs/:id/resources', authenticate, validateRequest({ body: addClubResourceSchema }), async (req, res) => {
  const { title, url } = req.body;
  const safeResourceUrl = getSafeUrl(url, '');
  if (!safeResourceUrl) return res.status(400).json({ error: 'A valid resource link is required.' });

  try {
    const club = await pool.query('SELECT creator_id, members, resources FROM passion_clubs WHERE id = $1', [req.params.id]);
    if (club.rows.length === 0) return res.status(404).json({ error: 'Club not found.' });

    const members = club.rows[0].members || [];
    const isMember = members.some(m => m.userId === req.user.id);
    if (!isMember && !isStaff(req.user)) {
      return res.status(403).json({ error: 'Only club members can contribute resources.' });
    }

    let resources = club.rows[0].resources || [];
    resources.push({ title, url: safeResourceUrl, addedBy: req.user.id });
    const updateRes = await pool.query('UPDATE passion_clubs SET resources = $1 WHERE id = $2 RETURNING *', [JSON.stringify(resources), req.params.id]);
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Add club resource error:', err);
    res.status(500).json({ error: 'Failed to add resource.' });
  }
});

router.post('/passion-clubs/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'passion_clubs', req.params.id, 2));

router.put('/passion-clubs/:id', authenticate, validateRequest({ body: updatePassionClubSchema }), async (req, res) => {
  const { name, description, meetingLink, chatLink } = req.body;
  try {
    const check = await pool.query('SELECT creator_id FROM passion_clubs WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Club not found.' });

    const isCreator = check.rows[0].creator_id === req.user.id;
    if (!isCreator && !isStaff(req.user)) {
      return res.status(403).json({ error: 'Only the club founder can edit club information.' });
    }

    const { rows } = await pool.query(
      `UPDATE passion_clubs
       SET name = COALESCE($1, name), description = COALESCE($2, description),
           meeting_link = COALESCE($3, meeting_link), chat_link = COALESCE($4, chat_link)
       WHERE id = $5 RETURNING *`,
      [name || null, description || null, meetingLink ? getSafeUrl(meetingLink, '') : null, chatLink ? getSafeUrl(chatLink, '') : null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update passion club error:', err);
    res.status(500).json({ error: 'Failed to update club.' });
  }
});

router.delete('/passion-clubs/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM passion_clubs WHERE id = $1 AND (creator_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Club not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete passion club error:', err);
    res.status(500).json({ error: 'Failed to delete club.' });
  }
});

// =============================================================================
// 10. Book & Notes Marketplace — RESTORED (was fully missing)
// =============================================================================
const marketplaceSchema = z.object({
  subject: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  priceTag: z.string().min(1).max(64),
  wearCondition: z.string().min(1).max(64),
  coverImageUrl: z.string().max(2000).optional().nullable()
});

const marketplaceContactSchema = z.object({
  contactInfo: z.string().max(150).optional().nullable()
});

router.get('/marketplace', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('book_marketplace', req, { whereClause: 'WHERE is_sold = FALSE' });
    res.json(page);
  } catch (err) {
    console.error('List marketplace error:', err);
    res.status(500).json({ error: 'Failed to load books.' });
  }
});

router.post('/marketplace', authenticate, validateRequest({ body: marketplaceSchema }), async (req, res) => {
  const { subject, title, priceTag, wearCondition, coverImageUrl } = req.body;
  const id = `book-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO book_marketplace (id, seller_id, seller_name, seller_section, subject, title, price_tag, wear_condition, cover_image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.residence, subject, title, priceTag, wearCondition, getSafeUrl(coverImageUrl, '') || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create marketplace listing error:', err);
    res.status(500).json({ error: 'Failed to publish listing.' });
  }
});

router.post('/marketplace/:id/contact', authenticate, validateRequest({ body: marketplaceContactSchema }), async (req, res) => {
  const { contactInfo } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM book_marketplace WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found.' });

    const book = rows[0];
    const notifId = `notif-${randomUUID()}`;

    // Fully parameterized (legacy interpolated book.title directly into the
    // SQL string — fixed here to eliminate the injection/syntax-breakage risk).
    await pool.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name, type, title, message, status)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'marketplace_interest', $6, $7, 'pending')`,
      [
        notifId,
        book.seller_id,
        [book.seller_id],
        req.user.id,
        req.user.name,
        `📚 Interest in your book: ${book.title}`,
        `Resident ${req.user.name} wants to purchase or collect your text [${book.title}]. Direct Contact: ${contactInfo || req.user.email}`
      ]
    );
    res.json({ success: true, message: 'Seller notified securely.' });
  } catch (err) {
    console.error('Marketplace contact error:', err);
    res.status(500).json({ error: 'Failed to notify seller.' });
  }
});

router.post('/marketplace/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'book_marketplace', req.params.id, 2));

router.put('/marketplace/:id', authenticate, validateRequest({ body: marketplaceSchema }), async (req, res) => {
  const { subject, title, priceTag, wearCondition, coverImageUrl } = req.body;
  try {
    const check = await pool.query('SELECT seller_id FROM book_marketplace WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Listing not found.' });
    if (check.rows[0].seller_id !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You can only edit your own listings.' });
    }

    const { rows } = await pool.query(
      `UPDATE book_marketplace
       SET subject = $1, title = $2, price_tag = $3, wear_condition = $4, cover_image_url = $5
       WHERE id = $6 RETURNING *`,
      [subject, title, priceTag, wearCondition, getSafeUrl(coverImageUrl, '') || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update marketplace listing error:', err);
    res.status(500).json({ error: 'Failed to update listing.' });
  }
});

router.delete('/marketplace/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM book_marketplace WHERE id = $1 AND (seller_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Listing not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete marketplace listing error:', err);
    res.status(500).json({ error: 'Failed to delete listing.' });
  }
});

// =============================================================================
// 11. End-of-Year Freebox — RESTORED (was fully missing)
// =============================================================================
const freeboxSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
  photoUrl: z.string().max(2000).optional().nullable(),
  floorRoom: z.string().max(128).optional().nullable()
});

const freeboxClaimSchema = z.object({
  contactInfo: z.string().max(150).optional().nullable()
});

router.get('/freebox', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('freebox_items', req, { whereClause: 'WHERE is_claimed = FALSE' });
    res.json(page);
  } catch (err) {
    console.error('List freebox error:', err);
    res.status(500).json({ error: 'Failed to load Freebox items.' });
  }
});

router.post('/freebox', authenticate, validateRequest({ body: freeboxSchema }), async (req, res) => {
  const { title, description, photoUrl, floorRoom } = req.body;
  const safePhotoUrl = photoUrl ? getSafeUrl(photoUrl, '') : '';
  if (photoUrl && !safePhotoUrl) return res.status(400).json({ error: 'Invalid photo URL.' });
  const id = `fbox-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO freebox_items (id, donor_id, donor_name, donor_section, donor_floor_room, title, description, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.residence, floorRoom || `${req.user.floor || ''} ${req.user.room || ''}`.trim(), title, description, safePhotoUrl || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create freebox item error:', err);
    res.status(500).json({ error: 'Failed to post Freebox item.' });
  }
});

router.post('/freebox/:id/claim', authenticate, validateRequest({ body: freeboxClaimSchema }), async (req, res) => {
  const { contactInfo } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM freebox_items WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found.' });

    const item = rows[0];
    const notifId = `notif-${randomUUID()}`;

    // Fully parameterized (legacy interpolated item.title directly into the SQL string).
    await pool.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name, type, title, message, status)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'freebox_claim', $6, $7, 'pending')`,
      [
        notifId,
        item.donor_id,
        [item.donor_id],
        req.user.id,
        req.user.name,
        `📦 Freebox Claim: ${item.title}`,
        `Resident ${req.user.name} would like to pick up your donated [${item.title}]. Direct Contact: ${contactInfo || req.user.email}`
      ]
    );
    res.json({ success: true, message: 'Pickup claim sent to the donor.' });
  } catch (err) {
    console.error('Freebox claim error:', err);
    res.status(500).json({ error: 'Failed to claim item.' });
  }
});

router.post('/freebox/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'freebox_items', req.params.id, 2));

router.put('/freebox/:id', authenticate, validateRequest({ body: freeboxSchema }), async (req, res) => {
  const { title, description, photoUrl, floorRoom } = req.body;
  try {
    const check = await pool.query('SELECT donor_id FROM freebox_items WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Item not found.' });
    if (check.rows[0].donor_id !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You can only edit your own donations.' });
    }

    const { rows } = await pool.query(
      `UPDATE freebox_items
       SET title = $1, description = $2, photo_url = $3, donor_floor_room = COALESCE($4, donor_floor_room)
       WHERE id = $5 RETURNING *`,
      [title, description, getSafeUrl(photoUrl, '') || null, floorRoom || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update freebox item error:', err);
    res.status(500).json({ error: 'Failed to update item.' });
  }
});

router.delete('/freebox/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM freebox_items WHERE id = $1 AND (donor_id = $2 OR $3 IN ('admin', 'superadmin')) RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found or unauthorized.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete freebox item error:', err);
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

// =============================================================================
// 12. Community Startups — RESTORED (was fully missing)
// =============================================================================
const createStartupSchema = z.object({
  title: z.string().min(1).max(255),
  industry: z.string().min(1).max(64),
  stage: z.string().min(1).max(64),
  elevatorPitch: z.string().min(1).max(400),
  neededRoles: z.array(z.string().max(64)).min(1).max(10),
  commitmentType: z.string().min(1).max(64)
});

const applyStartupSchema = z.object({
  roleCompetence: z.string().min(1).max(255),
  portfolioLink: z.string().max(2000).optional().nullable(),
  contactInfo: z.string().max(150).optional().nullable()
});

const updateStartupStatusSchema = z.object({
  status: z.enum(['Open for Collaborators', 'Team Complete', 'On Hold', 'Launched', 'Archived'])
});

router.get('/startups', authenticate, async (req, res) => {
  try {
    const page = await fetchPaginated('community_startups', req);
    res.json(page);
  } catch (err) {
    console.error('List startups error:', err);
    res.status(500).json({ error: 'Failed to load startup ideas.' });
  }
});

router.post('/startups', authenticate, validateRequest({ body: createStartupSchema }), async (req, res) => {
  const { title, industry, stage, elevatorPitch, neededRoles, commitmentType } = req.body;
  const id = `start-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO community_startups (id, founder_id, founder_name, founder_section, title, industry, stage, elevator_pitch, needed_roles, commitment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.residence, title, industry, stage, elevatorPitch, neededRoles, commitmentType]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create startup error:', err);
    res.status(500).json({ error: 'Failed to create startup idea.' });
  }
});

router.post('/startups/:id/apply', authenticate, validateRequest({ body: applyStartupSchema }), async (req, res) => {
  const { roleCompetence, portfolioLink, contactInfo } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM community_startups WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Startup idea not found.' });

    const startup = rows[0];
    if (startup.founder_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot apply to your own startup.' });
    }

    const existingApplication = await pool.query(
      'SELECT id FROM startup_applications WHERE startup_id = $1 AND applicant_id = $2 LIMIT 1',
      [startup.id, req.user.id]
    );
    if (existingApplication.rows.length > 0) {
      return res.status(409).json({ error: 'You have already applied to this startup.' });
    }

    const safePortfolio = portfolioLink ? getSafeUrl(portfolioLink, '') : '';
    if (portfolioLink && !safePortfolio) {
      return res.status(400).json({ error: 'Invalid portfolio URL.' });
    }

    const appId = `app-${randomUUID()}`;

    await pool.query(
      `INSERT INTO startup_applications (id, startup_id, applicant_id, applicant_name, applicant_email, applicant_contact, role_competence, portfolio_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [appId, startup.id, req.user.id, req.user.name, req.user.email, contactInfo || req.user.email, roleCompetence, safePortfolio]
    );

    const notifId = `notif-${randomUUID()}`;
    await pool.query(
      `INSERT INTO notifications (id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name, type, title, message, status)
       VALUES ($1, $2, $3::text[], 'individual', $4, $5, 'startup_application', $6, $7, 'pending')`,
      [
        notifId,
        startup.founder_id,
        [startup.founder_id],
        req.user.id,
        req.user.name,
        `🚀 Co-Founder Candidate: ${startup.title}`,
        `Resident ${req.user.name} applied for role "${roleCompetence}".\nContact: ${contactInfo || req.user.email}\nPortfolio: ${safePortfolio || 'None provided'}\n\nSchedule a coffee in the common rooms to discuss further.`
      ]
    );

    res.status(201).json({ success: true, message: 'Application submitted privately to the founder.' });
  } catch (err) {
    console.error('Startup application error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already applied to this startup.' });
    }
    res.status(500).json({ error: 'Failed to submit startup application.' });
  }
});

const updateStartupSchema = z.object({
  title: z.string().min(1).max(255), industry: z.string().min(1).max(64), stage: z.string().min(1).max(64),
  elevatorPitch: z.string().min(1).max(400), neededRoles: z.array(z.string().max(64)).min(1).max(10),
  commitmentType: z.string().min(1).max(64), status: z.enum(['Open for Collaborators','Team Complete','On Hold','Launched','Archived']).optional()
});

router.put('/startups/:id', authenticate, validateRequest({ body: updateStartupSchema }), async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM community_startups WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Startup idea not found.' });
    if (existing.rows[0].founder_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: 'You can only edit your own startup.' });
    const d=req.body;
    const { rows } = await pool.query(`UPDATE community_startups SET title=$1, industry=$2, stage=$3, elevator_pitch=$4, needed_roles=$5, commitment_type=$6, status=COALESCE($7,status) WHERE id=$8 RETURNING *`, [d.title,d.industry,d.stage,d.elevatorPitch,d.neededRoles,d.commitmentType,d.status||null,req.params.id]);
    res.json(rows[0]);
  } catch (err) { console.error('Update startup error:',err); res.status(500).json({ error:'Failed to update startup idea.' }); }
});

router.delete('/startups/:id', authenticate, async (req,res) => {
  try { const { rows } = await pool.query(`DELETE FROM community_startups WHERE id=$1 AND (founder_id=$2 OR $3 IN ('admin','superadmin')) RETURNING *`, [req.params.id,req.user.id,req.user.role]); if (!rows.length) return res.status(404).json({error:'Startup idea not found or unauthorized.'}); res.json({success:true}); }
  catch(err){ console.error('Delete startup error:',err); res.status(500).json({error:'Failed to delete startup idea.'}); }
});

router.patch('/startups/:id/status', authenticate, validateRequest({ body: updateStartupStatusSchema }), async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE community_startups SET status = $1 WHERE id = $2 AND (founder_id = $3 OR $4 IN (\'admin\', \'superadmin\')) RETURNING *',
      [status, req.params.id, req.user.id, req.user.role]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Only the founder can update the status.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update startup status error:', err);
    res.status(500).json({ error: 'Failed to update startup status.' });
  }
});

router.post('/startups/:id/report', authenticate, (req, res) => handleContentReport(req, res, 'community_startups', req.params.id, 2));
router.delete('/startups/:id/moderate', authenticate, (req, res) => handleAdminRemoval(req, res, 'community_startups', req.params.id, 2));

// =============================================================================
// Generic Moderation Gate (used by any module not covered by a dedicated
// /report or /moderate route above)
// =============================================================================
const ENTITY_ALIASES = Object.freeze({
  matches: 'match_finder_events', 'match-finder': 'match_finder_events',
  'city-guide': 'city_guide_places', tandem: 'language_tandems',
  marketplace: 'book_marketplace', freebox: 'freebox_items', startups: 'community_startups',
  jukebox: 'jukebox_tracks', 'academics-map': 'academic_exchanges', 'study-rooms': 'study_rooms',
  'passion-clubs': 'passion_clubs', recipes: 'recipes', 'time-capsule': 'time_capsule_entries'
});
function resolveModerationTable(entity) {
  const normalized = entity.replace(/-/g, '_');
  return ENTITY_ALIASES[entity] || normalized;
}
router.post('/:entity/:id/report', authenticate, (req, res) => {
  const table = resolveModerationTable(req.params.entity);
  if (!ENTITY_TABLE_ALLOWLIST.includes(table)) return res.status(400).json({ error: 'Unknown entity.' });
  handleContentReport(req, res, table, req.params.id, 2);
});
router.delete('/:entity/:id/moderate', authenticate, (req, res) => {
  const table = resolveModerationTable(req.params.entity);
  if (!ENTITY_TABLE_ALLOWLIST.includes(table)) return res.status(400).json({ error: 'Unknown entity.' });
  handleAdminRemoval(req, res, table, req.params.id, 2);
});

module.exports = router;
