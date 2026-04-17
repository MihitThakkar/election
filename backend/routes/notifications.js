const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authenticateToken, (req, res) => {
  if (req.user.role === 'super_admin') {
    // Aggregate read_count/total_recipients in a single pass via GROUP BY
    const notifications = db.prepare(`
      SELECT n.*, u.name as sent_by_name, a.name as area_name,
             COALESCE(SUM(un.is_read), 0)  AS read_count,
             COUNT(un.user_id)             AS total_recipients
      FROM notifications n
      LEFT JOIN users u  ON n.sent_by        = u.id
      LEFT JOIN areas a  ON n.target_area_id  = a.id
      LEFT JOIN user_notifications un ON un.notification_id = n.id
      GROUP BY n.id
      ORDER BY n.created_at DESC
    `).all();
    return res.json({ success: true, data: notifications });
  }

  // Field worker — their own notifications
  const notifications = db.prepare(`
    SELECT n.*, u.name as sent_by_name, a.name as area_name,
           un.is_read
    FROM notifications n
    JOIN user_notifications un ON n.id = un.notification_id AND un.user_id = ?
    LEFT JOIN users u ON n.sent_by = u.id
    LEFT JOIN areas a ON n.target_area_id = a.id
    ORDER BY n.created_at DESC
  `).all(req.user.id);

  res.json({ success: true, data: notifications });
});

// POST /api/notifications — Send notification
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { title, message, target_area_id } = req.body;

  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Title and message are required' });
  }

  const result = db.prepare(
    'INSERT INTO notifications (title, message, sent_by, target_area_id) VALUES (?, ?, ?, ?)'
  ).run(title, message, req.user.id, target_area_id || null);

  const notifId = result.lastInsertRowid;

  // Find target workers
  let workers;
  if (target_area_id) {
    workers = db.prepare(
      "SELECT id FROM users WHERE role = 'field_worker' AND is_active = 1 AND area_id = ?"
    ).all(target_area_id);
  } else {
    workers = db.prepare(
      "SELECT id FROM users WHERE role = 'field_worker' AND is_active = 1"
    ).all();
  }

  const insertUserNotif = db.prepare(
    'INSERT OR IGNORE INTO user_notifications (user_id, notification_id, is_read) VALUES (?, ?, 0)'
  );

  const insertAll = db.transaction((workers) => {
    for (const w of workers) insertUserNotif.run(w.id, notifId);
  });
  insertAll(workers);

  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notifId);
  res.status(201).json({ success: true, data: { ...notification, recipients: workers.length } });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticateToken, (req, res) => {
  db.prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND notification_id = ?').run(
    req.user.id, req.params.id
  );
  res.json({ success: true });
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticateToken, (req, res) => {
  db.prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
