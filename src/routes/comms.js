const express = require('express');
const { z } = require('zod');
const { randomUUID } = require('crypto');
const { pool } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validate');
const { recordAuditLog } = require('../utils/audit');
const env = require('../config/env');

const router = express.Router();

// =============================================================================
// Notifications
// =============================================================================
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications 
       WHERE 
         (type IN ('contact_request', 'contact_approved', 'join_request', 'join_response') AND (recipient_id = $1 OR $1 = ANY(COALESCE(recipient_ids, ARRAY[]::text[]))))
         OR
          (type NOT IN ('contact_request', 'contact_approved', 'join_request', 'join_response') AND (
           recipient_scope = 'all'
           OR recipient_id = $1 
           OR ($2 IN ('admin', 'superadmin') AND recipient_scope = 'admin')
           OR $1 = ANY(COALESCE(recipient_ids, ARRAY[]::text[]))
         ))
       ORDER BY created_at DESC`,
      [req.user.id, req.user.role]
    );

    const mapped = rows.map(n => {
      const readBy = n.read_by_user_ids || [];
      const isReadByMe = readBy.includes(req.user.id) || ['read', 'accepted', 'declined'].includes(n.status);

      return {
        id: n.id,
        recipientId: n.recipient_id,
        recipientIds: n.recipient_ids || [],
        recipientScope: n.recipient_scope,
        senderId: n.sender_id,
        senderName: n.sender_name,
        type: n.type,
        title: n.title,
        message: n.message,
        status: isReadByMe ? (n.status === 'pending' ? 'read' : n.status) : 'pending',
        requestedChannels: n.requested_channels || [],
        targetStudentId: n.target_student_id,
        attachments: n.attachments || [],
        resourceType: n.resource_type,
        resourceId: n.resource_id,
        date: n.created_at
      };
    });

    res.json(mapped);
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

const sendNotificationSchema = z.object({
  recipientId: z.string().optional().nullable(),
  recipientIds: z.array(z.string().max(64)).max(200).optional(),
  recipientScope: z.enum(['individual', 'group', 'all', 'admin', 'section', 'role']).default('individual'),
  // senderName, type and target are checked again against the authenticated
  // actor below; they are not trusted as identity/authorization fields.
  senderName: z.string().max(255).optional(),
  type: z.enum(['contact_request', 'contact_approved', 'contact_interest', 'account_flagged', 'admin_announcement', 'identity_confirm', 'suggestion_submitted', 'startup_application', 'freebox_claim']),
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(4000),
  requestedChannels: z.array(z.enum(['email', 'phone', 'instagram', 'linkedin'])).max(4).optional(),
  targetStudentId: z.string().max(64).optional().nullable(),
  targetFilters: z.object({
    sections: z.array(z.enum(['Residence_name_1','Residence_name_2','Residence_name_3'])).max(5).optional(),
    statuses: z.array(z.enum(['In Residence','Alumni','Admin','SuperAdmin'])).max(4).optional(),
    residentIds: z.array(z.string().max(64)).max(200).optional()
  }).optional(),
  attachments: z.array(z.object({
    type: z.string().max(32),
    name: z.string().max(255).optional(),
    url: z.string().max(2000).optional(),
    size: z.string().max(64).optional(),
    data: z.record(z.string().max(1000)).optional()
  }).strict()).max(10).optional()
});

// -----------------------------------------------------------------------------
// Notification dispatch helpers
// -----------------------------------------------------------------------------
// Types that ordinary residents are allowed to create. Everything else is
// reserved for administrators.
const RESIDENT_NOTIFICATION_TYPES = new Set(['contact_request', 'contact_approved', 'account_flagged']);
// Types that are always addressed to exactly one person.
const SINGLE_RECIPIENT_TYPES = new Set(['contact_request', 'contact_approved', 'contact_interest']);

const uniqueStrings = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map(v => String(v).trim()).filter(Boolean))];

/**
 * Resolves the audience of an administrative announcement to a list of user
 * ids. Filters are combined with AND; an empty filter set means "every
 * verified, visible resident" (the "All Residents" option of the broadcast
 * modal).
 *
 * All SQL fragments are static and every value is bound as a parameter.
 */
async function resolveAnnouncementAudience(rawFilters, explicitIds) {
  const filters = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  const sections = uniqueStrings(filters.sections);
  const statuses = uniqueStrings(filters.statuses);
  // The modal sends the (possibly hand-edited) resident selection both as
  // filters.residentIds and as recipientIds; either one narrows the audience.
  const residentIds = uniqueStrings(filters.residentIds);
  const idFilter = residentIds.length ? residentIds : explicitIds;

  const conditions = ['is_hidden = FALSE', 'verified = TRUE'];
  const params = [];

  if (sections.length) {
    params.push(sections);
    conditions.push(`residence = ANY($${params.length}::text[])`);
  }

  if (statuses.length) {
    params.push(statuses);
    conditions.push(`(
      CASE
        WHEN role = 'admin' THEN 'Admin'
        WHEN role = 'superadmin' THEN 'SuperAdmin'
        WHEN is_currently_in_college THEN 'In Residence'
        ELSE 'Alumni'
      END
    ) = ANY($${params.length}::text[])`);
  }

  if (idFilter.length) {
    params.push(idFilter);
    conditions.push(`id = ANY($${params.length}::text[])`);
  }

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows.map(row => row.id);
}

router.post('/notifications', authenticate, validateRequest({ body: sendNotificationSchema }), async (req, res) => {
  const n = req.body;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

  // ---- 1. Authorization (cheap checks first, before touching the database) --
  if (n.type === 'admin_announcement' && !isAdmin) {
    return res.status(403).json({ error: 'Only administrators can send announcements.' });
  }
  if (!isAdmin && !RESIDENT_NOTIFICATION_TYPES.has(n.type)) {
    return res.status(403).json({ error: 'Notification type is not permitted.' });
  }

  // The authenticated actor is always the sender; senderName from the body is
  // never trusted.
  const senderId = req.user.id;
  const senderName = req.user.name;

  const explicitIds = uniqueStrings(
    Array.isArray(n.recipientIds) && n.recipientIds.length
      ? n.recipientIds
      : (n.recipientId ? [n.recipientId] : [])
  );

  try {
    // ---- 2. Work out who receives this notification --------------------------
    let recipientIds = explicitIds;
    let recipientScope;

    if (n.type === 'account_flagged') {
      // Reports always go to the administrative channel, never to a person.
      if (n.recipientScope !== 'admin' || !n.targetStudentId) {
        return res.status(400).json({ error: 'Account reports must target the administrative channel.' });
      }
      recipientIds = [];
      recipientScope = 'admin';
    } else if (n.type === 'admin_announcement') {
      recipientIds = await resolveAnnouncementAudience(n.targetFilters, explicitIds);
      if (recipientIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one announcement recipient.' });
      }
      recipientScope = recipientIds.length === 1 ? 'individual' : 'group';
    } else if (SINGLE_RECIPIENT_TYPES.has(n.type)) {
      if (recipientIds.length !== 1) {
        return res.status(400).json({ error: 'This notification type requires one recipient.' });
      }
      recipientScope = 'individual';
    } else {
      // Remaining system types (identity_confirm, suggestion_submitted, ...):
      // administrators only — non-admins were rejected above.
      recipientScope = recipientIds.length === 1
        ? 'individual'
        : (recipientIds.length > 1 ? 'group' : (n.recipientScope || 'all'));
    }

    // ---- 3. Referenced users must exist (avoids a foreign-key 500) -----------
    // Announcement recipients came straight from the users table, so only
    // client-supplied ids need checking.
    const referencedIds = uniqueStrings([
      ...(n.type === 'admin_announcement' ? [] : recipientIds),
      ...(n.targetStudentId ? [n.targetStudentId] : [])
    ]);

    if (referencedIds.length) {
      const { rows: existing } = await pool.query(
        'SELECT id FROM users WHERE id = ANY($1::text[])',
        [referencedIds]
      );
      const existingIds = new Set(existing.map(row => row.id));

      if (n.type !== 'admin_announcement' && recipientIds.some(id => !existingIds.has(id))) {
        return res.status(404).json({ error: 'Recipient not found.' });
      }
      if (n.targetStudentId && !existingIds.has(String(n.targetStudentId))) {
        return res.status(404).json({ error: 'Referenced resident not found.' });
      }
    }

    // ---- 4. Persist ----------------------------------------------------------
    const primaryRecipientId = recipientScope === 'individual' ? (recipientIds[0] || null) : null;

    const { rows } = await pool.query(
      `INSERT INTO notifications (
        id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name,
        type, title, message, status, requested_channels, target_student_id, attachments
      ) VALUES (
        $1, $2, $3::text[], $4, $5, $6, $7, $8, $9, 'pending', $10::text[], $11, $12::jsonb
      ) RETURNING *`,
      [
        `notif-${randomUUID()}`,
        primaryRecipientId,
        recipientIds,
        recipientScope,
        senderId,
        senderName,
        n.type,
        n.title,
        n.message,
        n.requestedChannels || [],
        n.targetStudentId || null,
        JSON.stringify(n.attachments || [])
      ]
    );


        if (n.type === 'contact_approved' && recipientIds[0]) {
      const shared = (n.attachments || []).find(a => a.type === 'shared_data');
      const channels = Object.keys(shared?.data || {})
        .filter(k => ['email', 'phone', 'instagram', 'linkedin'].includes(k));
      if (channels.length) {
        await pool.query(
          `INSERT INTO contact_shares (viewer_id, owner_id, channels)
           VALUES ($1, $2, $3::text[])
           ON CONFLICT (viewer_id, owner_id) DO UPDATE
           SET channels = ARRAY(SELECT DISTINCT unnest(contact_shares.channels || EXCLUDED.channels)),
               updated_at = NOW()`,
          [recipientIds[0], senderId, channels]
        );
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({ error: 'Failed to send notification.' });
  }
});

const notificationStatusParamsSchema = z.object({
  id: z.string().min(1).max(100)
});
const notificationStatusBodySchema = z.object({
  status: z.enum(['pending', 'read', 'accepted', 'declined'])
});

router.patch(
  '/notifications/:id/status',
  authenticate,
  validateRequest({ params: notificationStatusParamsSchema, body: notificationStatusBodySchema }),
  async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    try {
      const { rows: found } = await pool.query(
        `SELECT * FROM notifications
         WHERE id = $1
           AND (recipient_id = $2 OR $2 = ANY(COALESCE(recipient_ids, ARRAY[]::text[]))
                OR sender_id = $2 OR $3 IN ('admin', 'superadmin'))`,
        [id, req.user.id, req.user.role]
      );
      if (found.length === 0) return res.status(404).json({ error: 'Notification not found or access denied.' });

      const notification = found[0];
      const isStaff = req.user.role === 'admin' || req.user.role === 'superadmin';
      const isDirectRecipient =
        notification.recipient_id === req.user.id ||
        req.user.id === notification.recipient_id ||
        (Array.isArray(notification.recipient_ids) && notification.recipient_ids.includes(req.user.id));

      if (!isStaff && status !== 'read') {
        if (!isDirectRecipient || notification.type !== 'contact_request') {
          return res.status(403).json({ error: 'This notification cannot be changed by the current user.' });
        }
      }

      if (status === 'read') {
        await pool.query(
          `UPDATE notifications
           SET read_by_user_ids = array_append(
             array_remove(COALESCE(read_by_user_ids, ARRAY[]::text[]), $1), $1
           )
           WHERE id = $2`,
          [req.user.id, id]
        );
      } else {
        await pool.query(
          `UPDATE notifications
           SET status = $1,
               read_by_user_ids = array_append(
                 array_remove(COALESCE(read_by_user_ids, ARRAY[]::text[]), $2), $2
               )
           WHERE id = $3`,
          [status, req.user.id, id]
        );
      }

      res.json({ success: true, status });
    } catch (err) {
      console.error('Update notif status error:', err);
      res.status(500).json({ error: 'Failed to update notification status.' });
    }
  }
);

router.delete('/notifications/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND (recipient_id = $2 OR sender_id = $2 OR $3 IN ('admin', 'superadmin'))`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!rowCount) return res.status(404).json({ error: 'Notification not found or access denied.' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete notif error:', err);
    res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

// =========================================================
// contacts sharing route
// =========================================================


router.get('/contact-shares', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cs.owner_id, cs.channels, u.email, u.phone, u.instagram, u.linkedin
         FROM contact_shares cs
         JOIN users u ON u.id = cs.owner_id
        WHERE cs.viewer_id = $1`,
      [req.user.id]
    );
    const allowed = ['email', 'phone', 'instagram', 'linkedin'];
    const out = {};
    for (const r of rows) {
      const data = {};
      for (const ch of r.channels) if (allowed.includes(ch) && r[ch]) data[ch] = r[ch];
      out[r.owner_id] = data;
    }
    res.json(out);
  } catch (err) {
    console.error('Contact shares error:', err);
    res.status(500).json({ error: 'Failed to load shared contacts.' });
  }
});

// =============================================================================
// Admin Chat
// =============================================================================
router.get('/admin-chat', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM admin_chat ORDER BY created_at ASC LIMIT 200');
    res.json(rows.map(m => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderRole: m.sender_role,
      text: m.text,
      timestamp: m.created_at
    })));
  } catch (err) {
    console.error('Admin chat fetch error:', err);
    res.status(500).json({ error: 'Failed to load executive chat.' });
  }
});

const adminChatSchema = z.object({ text: z.string().min(1).max(4000) });
const suggestionSchema = z.object({ text: z.string().min(1).max(5000) });
const settingSchema = z.object({ value: z.string().max(20000) });

router.post('/admin-chat', authenticate, requireRole('admin', 'superadmin'), validateRequest({ body: adminChatSchema }), async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message cannot be blank.' });

  const id = `msg-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO admin_chat (id, sender_id, sender_name, sender_role, text)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.role, text.trim()]
    );
    res.status(201).json({
      id: rows[0].id,
      senderId: rows[0].sender_id,
      senderName: rows[0].sender_name,
      senderRole: rows[0].sender_role,
      text: rows[0].text,
      timestamp: rows[0].created_at
    });
  } catch (err) {
    console.error('Admin chat send error:', err);
    res.status(500).json({ error: 'Failed to deliver message.' });
  }
});

// =============================================================================
// Suggestions
// =============================================================================
router.get('/suggestions', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suggestions ORDER BY created_at DESC');
    res.json(rows.map(s => ({
      id: s.id,
      userId: s.user_id,
      userName: s.user_name,
      userEmail: s.user_email,
      userResidence: s.user_residence,
      text: s.text,
      status: s.status,
      createdAt: s.created_at
    })));
  } catch (err) {
    console.error('Suggestions error:', err);
    res.status(500).json({ error: 'Failed to retrieve suggestions.' });
  }
});

router.post('/suggestions', authenticate, validateRequest({ body: suggestionSchema }), async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Suggestion text cannot be blank.' });

  const id = `sug-${randomUUID()}`;
  try {
    const { rows } = await pool.query(
      `INSERT INTO suggestions (id, user_id, user_name, user_email, user_residence, text)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, req.user.id, req.user.name, req.user.email, req.user.residence, text.trim()]
    );

    // Notify every SuperAdmin that a new suggestion is waiting for review.
    // Failure to notify must never fail the actual suggestion submission —
    // the resident's feedback is already safely stored above regardless.
    try {
      const superAdmins = await pool.query("SELECT id FROM users WHERE role = 'superadmin' OR is_founder = TRUE");
      const preview = text.trim().length > 200 ? `${text.trim().slice(0, 200)}…` : text.trim();
      for (const sa of superAdmins.rows) {
        await pool.query(
          `INSERT INTO notifications (
            id, recipient_id, recipient_ids, recipient_scope, sender_id, sender_name,
            type, title, message, status, target_student_id
          ) VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            `notif-${randomUUID()}`,
            sa.id,
            [sa.id],
            'individual',
            req.user.id,
            req.user.name,
            'suggestion_submitted',
            '💡 New Portal Suggestion',
            `${req.user.name} (${req.user.residence || 'N/A'} Section) submitted a new suggestion:\n"${preview}"`,
            'pending',
            req.user.id
          ]
        );
      }
    } catch (notifyErr) {
      console.error('[SUGGESTION NOTIFICATION ERROR]:', notifyErr);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Save suggestion error:', err);
    res.status(500).json({ error: 'Failed to record suggestion.' });
  }
});

// =============================================================================
// System Settings
// =============================================================================
router.get('/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM system_settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Failed to load system settings.' });
  }
});

router.put('/settings/:key', authenticate, validateRequest({ body: settingSchema, params: z.object({ key: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/) }) }), async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'Setting value must be a valid string.' });
  }

  const isFounder = req.user.isFounder || req.user.is_founder || (env.FOUNDER_EMAIL && req.user.email.toLowerCase().trim() === env.FOUNDER_EMAIL.toLowerCase().trim());

  // The Official Concern Letter may be edited by the platform founder even
  // if their account role isn't (or isn't only) 'superadmin' — that's the
  // whole point of the founder flag. Every other setting key remains
  // strictly superadmin-only.
  if (key === 'concernLetter') {
    if (!isFounder) {
      return res.status(403).json({ error: 'Only the platform founder is authorized to modify the Official Concern Letter.' });
    }
  } else if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Access forbidden: SuperAdmin privileges required.' });
  }

  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );

    await recordAuditLog(req, req.user.id, req.user.name, req.user.role, `UPDATE_SETTING_${key.toUpperCase()}`, null, { key, value });
    res.json({ success: true, key });
  } catch (err) {
    console.error('Setting save error:', err);
    res.status(500).json({ error: 'Failed to save configuration parameter.' });
  }
});

router.get('/config', (req, res) => {
  res.json({ cartoKey: env.CARTO_API_KEY || '' });
});

module.exports = router;