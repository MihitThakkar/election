const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      // Aggregate read_count/total_recipients in a single pass via GROUP BY
      const notifications = await db.query(`
        SELECT n.*, u.name as sent_by_name, a.name as area_name,
               COALESCE(SUM(un.is_read), 0)  AS read_count,
               COUNT(un.user_id)             AS total_recipients
        FROM notifications n
        LEFT JOIN users u  ON n.sent_by        = u.id
        LEFT JOIN areas a  ON n.target_area_id  = a.id
        LEFT JOIN user_notifications un ON un.notification_id = n.id
        GROUP BY n.id
        ORDER BY n.created_at DESC
      `);
      return res.json({ success: true, data: notifications });
    }

    // Field worker — their own notifications
    const notifications = await db.query(`
      SELECT n.*, u.name as sent_by_name, a.name as area_name,
             un.is_read
      FROM notifications n
      JOIN user_notifications un ON n.id = un.notification_id AND un.user_id = ?
      LEFT JOIN users u ON n.sent_by = u.id
      LEFT JOIN areas a ON n.target_area_id = a.id
      ORDER BY n.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications — Send notification
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { title, message, target_area_id } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Title and message are required' });
    }

    const result = await db.run(
      'INSERT INTO notifications (title, message, sent_by, target_area_id) VALUES (?, ?, ?, ?)',
      [title, message, req.user.id, target_area_id || null]
    );

    const notifId = result.insertId;

    // Find target workers
    let workers;
    if (target_area_id) {
      workers = await db.query(
        "SELECT id FROM users WHERE role = 'field_worker' AND is_active = 1 AND area_id = ?",
        [target_area_id]
      );
    } else {
      workers = await db.query(
        "SELECT id FROM users WHERE role = 'field_worker' AND is_active = 1"
      );
    }

    await db.transaction(async (conn) => {
      for (const w of workers) {
        await conn.execute(
          'INSERT IGNORE INTO user_notifications (user_id, notification_id, is_read) VALUES (?, ?, 0)',
          [w.id, notifId]
        );
      }
    });

    const notification = await db.get('SELECT * FROM notifications WHERE id = ?', [notifId]);
    res.status(201).json({ success: true, data: { ...notification, recipients: workers.length } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticateToken, async (req, res, next) => {
  try {
    await db.run(
      'UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND notification_id = ?',
      [req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticateToken, async (req, res, next) => {
  try {
    await db.run('UPDATE user_notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
