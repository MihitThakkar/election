const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { phoneExists, VOTER_STATS_SUBQUERIES } = require('../helpers');

// GET /api/users
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { role, area_id, parent_id } = req.query;

    let query = `
      SELECT u.id, u.name, u.phone, u.role, u.area_id, u.parent_id, u.is_active, u.created_at,
             a.name as area_name,
             p.name as parent_name,
             ${VOTER_STATS_SUBQUERIES}
      FROM users u
      LEFT JOIN areas a ON u.area_id  = a.id
      LEFT JOIN users p ON u.parent_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (role)      { query += ' AND u.role = ?';      params.push(role); }
    if (area_id)   { query += ' AND u.area_id = ?';   params.push(area_id); }
    if (parent_id) { query += ' AND u.parent_id = ?'; params.push(parent_id); }
    query += ' ORDER BY u.role DESC, u.name ASC';

    const data = await db.query(query, params);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const user = await db.get(`
      SELECT u.id, u.name, u.phone, u.role, u.area_id, u.parent_id, u.is_active, u.created_at,
             a.name as area_name, p.name as parent_name
      FROM users u
      LEFT JOIN areas a ON u.area_id  = a.id
      LEFT JOIN users p ON u.parent_id = p.id
      WHERE u.id = ?
    `, [req.params.id]);

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const subWorkers = await db.query(`
      SELECT u.id, u.name, u.phone, u.area_id, u.is_active,
             a.name as area_name,
             (SELECT COUNT(*) FROM voters WHERE marked_by = u.id AND status = 'done') as votes_done
      FROM users u LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.parent_id = ?
    `, [req.params.id]);

    const stats = await db.get(`
      SELECT COUNT(*)                                                        AS total_assigned,
             SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END)            AS done,
             SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END)            AS refused,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)            AS pending
      FROM voters WHERE assigned_to = ?
    `, [req.params.id]);

    res.json({ success: true, data: { ...user, subWorkers, stats } });
  } catch (err) {
    next(err);
  }
});

// POST /api/users
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, phone, password, role, area_id, parent_id } = req.body;
    if (!name || !phone || !password || !role) {
      return res.status(400).json({ success: false, error: 'Name, phone, password and role are required' });
    }
    if (await phoneExists(phone)) {
      return res.status(400).json({ success: false, error: 'Phone number already registered' });
    }

    const result = await db.run(
      'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [name, phone, bcrypt.hashSync(password, 10), role, area_id || null, parent_id || null]
    );

    const user = await db.get(
      'SELECT id, name, phone, role, area_id, parent_id, is_active FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.user.role !== 'super_admin' && req.user.id !== targetId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [targetId]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const { name, phone, password, role, area_id, parent_id, is_active } = req.body;

    if (phone && phone !== user.phone && await phoneExists(phone, targetId)) {
      return res.status(400).json({ success: false, error: 'Phone number already in use' });
    }

    const updates = {
      name:      name     || user.name,
      phone:     phone    || user.phone,
      role:      req.user.role === 'super_admin' ? (role || user.role) : user.role,
      area_id:   area_id   !== undefined ? (area_id   || null) : user.area_id,
      parent_id: parent_id !== undefined ? (parent_id || null) : user.parent_id,
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : user.is_active,
    };
    if (password) updates.password = bcrypt.hashSync(password, 10);

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE users SET ${fields} WHERE id = ?`, [...Object.values(updates), targetId]);

    const updated = await db.get(
      'SELECT id, name, phone, role, area_id, parent_id, is_active FROM users WHERE id = ?',
      [targetId]
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/add-sub-worker
router.post('/:id/add-sub-worker', authenticateToken, async (req, res, next) => {
  try {
    const parentId = parseInt(req.params.id);
    if (req.user.role !== 'super_admin' && req.user.id !== parentId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const parent = await db.get('SELECT * FROM users WHERE id = ?', [parentId]);
    if (!parent) return res.status(404).json({ success: false, error: 'Parent user not found' });

    const { name, phone, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, error: 'Name, phone and password required' });
    }
    if (await phoneExists(phone)) {
      return res.status(400).json({ success: false, error: 'Phone already registered' });
    }

    const result = await db.run(
      'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [name, phone, bcrypt.hashSync(password, 10), 'field_worker', parent.area_id, parentId]
    );

    const user = await db.get(
      'SELECT id, name, phone, role, area_id, parent_id FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id/hierarchy — RECURSIVE tree
router.get('/:id/hierarchy', authenticateToken, async (req, res, next) => {
  try {
    async function getTree(userId) {
      const user = await db.get(`
        SELECT u.id, u.name, u.phone, u.role, u.area_id, u.is_active,
               a.name as area_name,
               (SELECT COUNT(*) FROM voters WHERE marked_by   = u.id AND status = 'done') AS votes_done,
               (SELECT COUNT(*) FROM voters WHERE assigned_to = u.id)                     AS assigned
        FROM users u LEFT JOIN areas a ON u.area_id = a.id WHERE u.id = ?
      `, [userId]);
      if (!user) return null;
      const children = await db.query('SELECT id FROM users WHERE parent_id = ?', [userId]);
      user.children = (await Promise.all(children.map(c => getTree(c.id)))).filter(Boolean);
      return user;
    }

    const tree = await getTree(parseInt(req.params.id));
    if (!tree) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: tree });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [targetId]);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
