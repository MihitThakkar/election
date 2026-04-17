const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/videos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/avi'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, WebM, MOV, AVI) are allowed'));
    }
  },
});

// GET /api/videos
router.get('/', authenticateToken, (req, res) => {
  const videos = db.prepare(`
    SELECT v.*, u.name as uploaded_by_name
    FROM videos v
    LEFT JOIN users u ON v.uploaded_by = u.id
    ORDER BY v.created_at DESC
  `).all();

  res.json({ success: true, data: videos });
});

// POST /api/videos — Upload video (admin only)
router.post('/', authenticateToken, requireAdmin, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No video file uploaded' });

  const { title, description } = req.body;
  if (!title) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, error: 'Video title is required' });
  }

  const filePath = `/uploads/videos/${req.file.filename}`;

  const result = db.prepare(
    'INSERT INTO videos (title, description, file_path, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?)'
  ).run(title, description || null, filePath, req.file.originalname, req.user.id);

  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, data: video });
});

// DELETE /api/videos/:id
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ success: false, error: 'Video not found' });

  const fullPath = path.join(__dirname, '..', video.file_path);
  if (fs.existsSync(fullPath)) fs.unlink(fullPath, () => {});

  db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Video deleted' });
});

module.exports = router;
