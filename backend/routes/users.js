const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { phoneExists, VOTER_STATS_SUBQUERIES } = require('../helpers');

// GET /api/users
router.get('/', authenticateToken, (req, res) => {
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

  res.json({ success: true, data: db.prepare(query).all(...params) });
});

// GET /api/users/:id
router.get('/:id', authenticateToken, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.name, u.phone, u.role, u.area_id, u.parent_id, u.is_active, u.created_at,
           a.name as area_name, p.name as parent_name
    FROM users u
    LEFT JOIN areas a ON u.area_id  = a.id
    LEFT JOIN users p ON u.parent_id = p.id
    WHERE u.id = ?
  `).get(req.params.id);

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const subWorkers = db.prepare(`
    SELECT u.id, u.name, u.phone, u.area_id, u.is_active,
           a.name as area_name,
           (SELECT COUNT(*) FROM voters WHERE marked_by = u.id AND status = 'done') as votes_done
    FROM users u LEFT JOIN areas a ON u.area_id = a.id
    WHERE u.parent_id = ?
  `).all(req.params.id);

  const stats = db.prepare(`
    SELECT COUNT(*)                                                        AS total_assigned,
           SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END)            AS done,
           SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END)            AS refused,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)            AS pending
    FROM voters WHERE assigned_to = ?
  `).get(req.params.id);

  res.json({ success: true, data: { ...user, subWorkers, stats } });
});

// POST /api/users
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { name, phone, password, role, area_id, parent_id } = req.body;
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ success: false, error: 'Name, phone, password and role are required' });
  }
  if (phoneExists(phone)) {
    return res.status(400).json({ success: false, error: 'Phone number already registered' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, phone, bcrypt.hashSync(password, 10), role, area_id || null, parent_id || null);

    const user = db.prepare('SELECT id, name, phone, role, area_id, parent_id, is_active FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.role !== 'super_admin' && req.user.id !== targetId) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { name, phone, password, role, area_id, parent_id, is_active } = req.body;

  if (phone && phone !== user.phone && phoneExists(phone, targetId)) {
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
  db.prepare(`UPDATE users SET ${fields} WHERE id = ?`).run(...Object.values(updates), targetId);

  const updated = db.prepare(
    'SELECT id, name, phone, role, area_id, parent_id, is_active FROM users WHERE id = ?'
  ).get(targetId);
  res.json({ success: true, data: updated });
});

// POST /api/users/:id/add-sub-worker
router.post('/:id/add-sub-worker', authenticateToken, (req, res) => {
  const parentId = parseInt(req.params.id);
  if (req.user.role !== 'super_admin' && req.user.id !== parentId) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const parent = db.prepare('SELECT * FROM users WHERE id = ?').get(parentId);
  if (!parent) return res.status(404).json({ success: false, error: 'Parent user not found' });

  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ success: false, error: 'Name, phone and password required' });
  }
  if (phoneExists(phone)) {
    return res.status(400).json({ success: false, error: 'Phone already registered' });
  }

  const result = db.prepare(
    'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, phone, bcrypt.hashSync(password, 10), 'field_worker', parent.area_id, parentId);

  const user = db.prepare(
    'SELECT id, name, phone, role, area_id, parent_id FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.status(201).json({ success: true, data: user });
});

// GET /api/users/:id/hierarchy
router.get('/:id/hierarchy', authenticateToken, (req, res) => {
  function getTree(userId) {
    const user = db.prepare(`
      SELECT u.id, u.name, u.phone, u.role, u.area_id, u.is_active,
             a.name as area_name,
             (SELECT COUNT(*) FROM voters WHERE marked_by   = u.id AND status = 'done') AS votes_done,
             (SELECT COUNT(*) FROM voters WHERE assigned_to = u.id)                     AS assigned
      FROM users u LEFT JOIN areas a ON u.area_id = a.id WHERE u.id = ?
    `).get(userId);
    if (!user) return null;
    const children = db.prepare('SELECT id FROM users WHERE parent_id = ?').all(userId);
    user.children = children.map(c => getTree(c.id)).filter(Boolean);
    return user;
  }

  const tree = getTree(parseInt(req.params.id));
  if (!tree) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: tree });
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ success: true, message: 'User deleted' });
});

module.exports = router;
