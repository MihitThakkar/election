const { db } = require('./db');

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function getUnreadCount(userId) {
  const row = await db.get(
    'SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return row?.count || 0;
}

// ── User helpers ──────────────────────────────────────────────────────────────
async function phoneExists(phone, excludeId = null) {
  const query = excludeId
    ? 'SELECT id FROM users WHERE phone = ? AND id != ?'
    : 'SELECT id FROM users WHERE phone = ?';
  const params = excludeId ? [phone, excludeId] : [phone];
  return !!(await db.get(query, params));
}

// ── Voter query helpers ───────────────────────────────────────────────────────

/**
 * Common voter JOIN projection reused across GET /voters and GET /voters/search.
 */
const VOTER_SELECT = `
  SELECT v.*,
         a.name as area_name,
         u.name as assigned_worker_name,
         m.name as marked_by_name
  FROM voters v
  LEFT JOIN areas   a ON v.area_id    = a.id
  LEFT JOIN users   u ON v.assigned_to = u.id
  LEFT JOIN users   m ON v.marked_by   = m.id
`;

/**
 * Inline subquery fragments for per-user voter statistics.
 * Used in users.js and dashboard.js.
 */
const VOTER_STATS_SUBQUERIES = `
  (SELECT COUNT(*) FROM voters WHERE assigned_to = u.id)                              AS assigned,
  (SELECT COUNT(*) FROM voters WHERE marked_by  = u.id AND status = 'done')           AS votes_done,
  (SELECT COUNT(*) FROM voters WHERE marked_by  = u.id AND status = 'refused')        AS votes_refused,
  (SELECT COUNT(*) FROM voters WHERE assigned_to = u.id AND status = 'pending')       AS pending
`;

module.exports = { getUnreadCount, phoneExists, VOTER_SELECT, VOTER_STATS_SUBQUERIES };
