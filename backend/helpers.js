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

// ── Team hierarchy helpers ────────────────────────────────────────────────────

/**
 * Returns the set of user IDs whose assigned voters are visible to `user`.
 *   - super_admin → null  (means: no assigned_to filter, sees all)
 *   - team_lead   → [self.id, ...all descendant user ids via parent_id]
 *   - field_worker → [self.id]
 * Relies on MySQL 8 recursive CTE.
 */
async function getTeamUserIds(user) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'field_worker') return [user.id];
  if (user.role === 'team_lead') {
    const rows = await db.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM users WHERE id = ?
         UNION ALL
         SELECT u.id FROM users u
           INNER JOIN descendants d ON u.parent_id = d.id
       )
       SELECT id FROM descendants`,
      [user.id]
    );
    return rows.map(r => r.id);
  }
  return [];
}

/**
 * Builds the SQL WHERE fragment to restrict voters by assigned_to based on role.
 * Call with the result of getTeamUserIds(user).
 *   - null → { where: '1=1', params: [] }  (admin, no restriction)
 *   - []   → { where: '1=0', params: [] }  (no access)
 *   - ids  → { where: 'v.assigned_to IN (?,...)', params: ids }
 */
function voterAssignmentScope(ids) {
  if (ids === null) return { where: '1=1', params: [] };
  if (!ids || ids.length === 0) return { where: '1=0', params: [] };
  return {
    where: `v.assigned_to IN (${ids.map(() => '?').join(',')})`,
    params: [...ids],
  };
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

module.exports = {
  getUnreadCount,
  phoneExists,
  VOTER_SELECT,
  VOTER_STATS_SUBQUERIES,
  getTeamUserIds,
  voterAssignmentScope,
};
