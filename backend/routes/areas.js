const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/areas
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const areas = await db.query(`
      SELECT
        a.id, a.name, a.district, a.created_at,
        COUNT(DISTINCT v.id)                                                            AS total_voters,
        COUNT(DISTINCT CASE WHEN v.status = 'done'    THEN v.id END)                   AS done,
        COUNT(DISTINCT CASE WHEN v.status = 'refused' THEN v.id END)                   AS refused,
        COUNT(DISTINCT CASE WHEN v.status = 'pending' THEN v.id END)                   AS pending,
        (SELECT COUNT(*) FROM users u WHERE u.area_id = a.id AND u.role = 'field_worker' AND u.is_active = 1) AS worker_count
      FROM areas a
      LEFT JOIN voters v ON v.area_id = a.id
      GROUP BY a.id
      ORDER BY a.name ASC
    `);

    res.json({ success: true, data: areas });
  } catch (err) {
    next(err);
  }
});

// GET /api/areas/:id
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const area = await db.get(`
      SELECT
        a.id, a.name, a.district, a.created_at,
        COUNT(DISTINCT v.id)                                                            AS total_voters,
        COUNT(DISTINCT CASE WHEN v.status = 'done'    THEN v.id END)                   AS done,
        COUNT(DISTINCT CASE WHEN v.status = 'refused' THEN v.id END)                   AS refused,
        COUNT(DISTINCT CASE WHEN v.status = 'pending' THEN v.id END)                   AS pending
      FROM areas a
      LEFT JOIN voters v ON v.area_id = a.id
      WHERE a.id = ?
      GROUP BY a.id
    `, [req.params.id]);

    if (!area) return res.status(404).json({ success: false, error: 'Area not found' });

    const workers = await db.query(`
      SELECT u.id, u.name, u.phone, u.parent_id, u.is_active,
             (SELECT COUNT(*) FROM voters WHERE assigned_to = u.id)              AS assigned,
             (SELECT COUNT(*) FROM voters WHERE marked_by = u.id AND status = 'done')    AS done,
             (SELECT COUNT(*) FROM voters WHERE marked_by = u.id AND status = 'refused') AS refused
      FROM users u
      WHERE u.area_id = ? AND u.role = 'field_worker'
      ORDER BY done DESC, u.name ASC
    `, [req.params.id]);

    res.json({ success: true, data: { ...area, workers } });
  } catch (err) {
    next(err);
  }
});

// POST /api/areas
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, district } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Area name is required' });

    const result = await db.run('INSERT INTO areas (name, district) VALUES (?, ?)', [name.trim(), district?.trim() || null]);
    const area = await db.get('SELECT * FROM areas WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: area });
  } catch (err) {
    next(err);
  }
});

// PUT /api/areas/:id
router.put('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, district } = req.body;
    const area = await db.get('SELECT * FROM areas WHERE id = ?', [req.params.id]);
    if (!area) return res.status(404).json({ success: false, error: 'Area not found' });

    await db.run('UPDATE areas SET name = ?, district = ? WHERE id = ?', [name || area.name, district !== undefined ? district : area.district, req.params.id]);

    const updated = await db.get('SELECT * FROM areas WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/areas/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    await db.run('DELETE FROM areas WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Area deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
