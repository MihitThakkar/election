const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { VOTER_STATS_SUBQUERIES } = require('../helpers');

// Helper: build voter scope WHERE clause based on user role
function voterScopeWhere(user) {
  if (user.role === 'super_admin') return { where: '1=1', params: [] };
  if (user.role === 'team_lead' && user.part_name) {
    return { where: 'v.part_number IN (SELECT part_number FROM parts WHERE part_name = ?)', params: [user.part_name] };
  }
  if (user.role === 'field_worker') {
    if (user.part_numbers) {
      const pns = user.part_numbers.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      if (pns.length > 0) return { where: `v.part_number IN (${pns.map(() => '?').join(',')})`, params: pns };
    }
    if (user.part_number) return { where: 'v.part_number = ?', params: [user.part_number] };
  }
  return { where: '1=0', params: [] };
}

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res, next) => {
  try {
    if (!['super_admin', 'team_lead'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Dashboard access denied' });
    }

    const { where, params } = voterScopeWhere(req.user);
    const p2 = [...params, ...params, ...params, ...params, ...params]; // repeated for each subquery

    const stats = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM voters v WHERE ${where})                                    AS total_voters,
        (SELECT COUNT(*) FROM voters v WHERE ${where} AND v.age BETWEEN 18 AND 35)        AS eligible_voters,
        (SELECT COUNT(*) FROM voters v WHERE ${where} AND v.status = 'done')              AS done,
        (SELECT COUNT(*) FROM voters v WHERE ${where} AND v.status = 'refused')           AS refused,
        (SELECT COUNT(*) FROM voters v WHERE ${where} AND v.status = 'pending')           AS pending,
        (SELECT COUNT(*) FROM voters v WHERE ${where} AND v.assigned_to IS NULL)          AS unassigned
    `, p2);

    // Count workers in scope
    let workerCount;
    if (req.user.role === 'super_admin') {
      workerCount = await db.get("SELECT COUNT(*) as count FROM users WHERE role IN ('field_worker','sub_worker') AND is_active = 1");
    } else {
      workerCount = await db.get("SELECT COUNT(*) as count FROM users WHERE parent_id = ? AND is_active = 1", [req.user.id]);
    }

    const covered = (stats.done || 0) + (stats.refused || 0);
    stats.workers = workerCount.count;
    stats.completion_pct = stats.total_voters ? Math.round((covered / stats.total_voters) * 100) : 0;

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/area-stats → now "part stats"
router.get('/area-stats', authenticateToken, async (req, res, next) => {
  try {
    if (!['super_admin', 'team_lead'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let partFilter = '';
    const params = [];
    if (req.user.role === 'team_lead' && req.user.part_name) {
      partFilter = 'WHERE p.part_name = ?';
      params.push(req.user.part_name);
    }

    const areas = await db.query(`
      SELECT p.part_number, p.part_name,
        COALESCE(vc.total, 0) AS total_voters,
        COALESCE(vc.done, 0) AS done,
        COALESCE(vc.refused, 0) AS refused,
        COALESCE(vc.pending, 0) AS pending
      FROM parts p
      LEFT JOIN (
        SELECT part_number, COUNT(*) as total,
          SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN status='refused' THEN 1 ELSE 0 END) as refused,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
        FROM voters GROUP BY part_number
      ) vc ON vc.part_number = p.part_number
      ${partFilter}
      ORDER BY p.part_number
    `, params);

    res.json({ success: true, data: areas });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/worker-stats
router.get('/worker-stats', authenticateToken, async (req, res, next) => {
  try {
    if (!['super_admin', 'team_lead'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let roleFilter = "u.role IN ('field_worker','sub_worker')";
    const params = [];
    if (req.user.role === 'team_lead') {
      // Show only workers under this team lead
      roleFilter = "(u.parent_id = ? OR u.parent_id IN (SELECT id FROM users WHERE parent_id = ?))";
      params.push(req.user.id, req.user.id);
    }

    const workers = await db.query(`
      SELECT u.id, u.name, u.phone, u.role, u.part_name, u.part_number,
             ${VOTER_STATS_SUBQUERIES}
      FROM users u
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE ${roleFilter} AND u.is_active = 1
      ORDER BY votes_done DESC
      LIMIT 20
    `, params);

    res.json({ success: true, data: workers });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/today
router.get('/today', authenticateToken, async (req, res, next) => {
  try {
    if (!['super_admin', 'team_lead'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { where, params } = voterScopeWhere(req.user);

    const todayDone    = await db.get(`SELECT COUNT(*) as count FROM voters v WHERE ${where} AND v.status='done' AND DATE(v.marked_at) = ?`, [...params, today]);
    const todayRefused = await db.get(`SELECT COUNT(*) as count FROM voters v WHERE ${where} AND v.status='refused' AND DATE(v.marked_at) = ?`, [...params, today]);

    const activityFeed = await db.query(`
      SELECT al.id, al.action, al.details, al.created_at, u.name as user_name
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: {
        today_done:    todayDone.count,
        today_refused: todayRefused.count,
        activityFeed,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
