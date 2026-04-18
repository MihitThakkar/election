const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { getUnreadCount } = require('../helpers');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Phone and password are required' });
    }

    const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone.trim()]);

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
    const unreadCount = await getUnreadCount(user.id);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id:           user.id,
          name:         user.name,
          phone:        user.phone,
          role:         user.role,
          area_id:      user.area_id,
          parent_id:    user.parent_id,
          part_name:    user.part_name,
          part_number:  user.part_number,
          part_numbers: user.part_numbers,
        },
        unreadCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await db.get(`
      SELECT u.id, u.name, u.phone, u.role, u.area_id, u.parent_id,
             u.part_name, u.part_number, u.part_numbers, u.is_active,
             a.name as area_name
      FROM users u
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.id = ?
    `, [req.user.id]);

    const unreadCount = await getUnreadCount(req.user.id);

    res.json({
      success: true,
      data: { ...user, unreadCount },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
