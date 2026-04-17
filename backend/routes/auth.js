const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { getUnreadCount } = require('../helpers');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, error: 'Phone and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone.trim());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
  }
  if (!user.is_active) {
    return res.status(401).json({ success: false, error: 'Your account has been deactivated. Contact your admin.' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
  }

  const token = generateToken(user.id);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id:        user.id,
        name:      user.name,
        phone:     user.phone,
        role:      user.role,
        area_id:   user.area_id,
        parent_id: user.parent_id,
      },
      unreadCount: getUnreadCount(user.id),
    },
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.name, u.phone, u.role, u.area_id, u.parent_id, u.is_active,
           a.name as area_name
    FROM users u
    LEFT JOIN areas a ON u.area_id = a.id
    WHERE u.id = ?
  `).get(req.user.id);

  res.json({
    success: true,
    data: { ...user, unreadCount: getUnreadCount(req.user.id) },
  });
});

module.exports = router;
