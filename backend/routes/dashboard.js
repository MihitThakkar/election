const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { VOTER_STATS_SUBQUERIES } = require('../helpers');

// GET /api/dashboard/stats — overall campaign numbers
router.get('/stats', authenticateToken, requireAdmin, (req, res) => {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM voters)                             AS total_voters,
      (SELECT COUNT(*) FROM voters WHERE age BETWEEN 18 AND 35) AS eligible_voters,
      (SELECT COUNT(*) FROM voters WHERE status = 'done')       AS done,
      (SELECT COUNT(*) FROM voters WHERE status = 'refused')    AS refused,
      (SELECT COUNT(*) FROM voters WHERE status = 'pending')    AS pending,
      (SELECT COUNT(*) FROM voters WHERE assigned_to IS NULL)   AS unassigned,
      (SELECT COUNT(*) FROM areas)                              AS areas,
      (SELECT COUNT(*) FROM users WHERE role = 'field_worker' AND is_active = 1) AS workers
  `).get();

  const covered = (stats.done || 0) + (stats.refused || 0);
  stats.completion_pct = stats.total_voters
    ? Math.round((covered / stats.total_voters) * 100)
    : 0;

  res.json({ success: true, data: stats });
});

// GET /api/dashboard/area-stats
router.get('/area-stats', authenticateToken, requireAdmin, (req, res) => {
  const areas = db.prepare(`
    SELECT
      a.id, a.name,
      COUNT(DISTINCT v.id)                                                            AS total_voters,
      COUNT(DISTINCT CASE WHEN v.status = 'done'    THEN v.id END)                   AS done,
      COUNT(DISTINCT CASE WHEN v.status = 'refused' THEN v.id END)                   AS refused,
      COUNT(DISTINCT CASE WHEN v.status = 'pending' THEN v.id END)                   AS pending,
      (SELECT COUNT(*) FROM users u WHERE u.area_id = a.id AND u.role = 'field_worker' AND u.is_active = 1) AS worker_count
    FROM areas a
    LEFT JOIN voters v ON v.area_id = a.id
    GROUP BY a.id
    ORDER BY total_voters DESC
  `).all();

  res.json({ success: true, data: areas });
});

// GET /api/dashboard/worker-stats — top field workers by votes done
router.get('/worker-stats', authenticateToken, requireAdmin, (req, res) => {
  const workers = db.prepare(`
    SELECT u.id, u.name, u.phone, u.area_id, u.parent_id,
           a.name AS area_name,
           ${VOTER_STATS_SUBQUERIES}
    FROM users u
    LEFT JOIN areas a ON u.area_id = a.id
    WHERE u.role = 'field_worker' AND u.is_active = 1
    ORDER BY votes_done DESC, votes_refused DESC
    LIMIT 20
  `).all();

  res.json({ success: true, data: workers });
});

// GET /api/dashboard/today — today's activity summary
router.get('/today', authenticateToken, requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const todayDone    = db.prepare(`SELECT COUNT(*) as count FROM voters WHERE status='done'    AND DATE(marked_at) = ?`).get(today);
  const todayRefused = db.prepare(`SELECT COUNT(*) as count FROM voters WHERE status='refused' AND DATE(marked_at) = ?`).get(today);

  const activityFeed = db.prepare(`
    SELECT al.id, al.action, al.details, al.created_at, u.name as user_name
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 20
  `).all();

  res.json({
    success: true,
    data: {
      today_done:    todayDone.count,
      today_refused: todayRefused.count,
      activityFeed,
    },
  });
});

module.exports = router;
