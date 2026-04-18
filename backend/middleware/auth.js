const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'election-manager-secret-key-2026';

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.get(
      'SELECT id, name, phone, role, area_id, parent_id, is_active FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    if (!user.is_active) {
      return res.status(401).json({ success: false, error: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Super Admin access required' });
  }
  next();
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authenticateToken, requireAdmin, generateToken };
