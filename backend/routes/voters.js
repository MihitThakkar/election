const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { VOTER_SELECT } = require('../helpers');

const upload = multer({
  dest: path.join(__dirname, '../uploads/temp/'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// GET /api/voters
router.get('/', authenticateToken, (req, res) => {
  const { area_id, status, assigned_to, eligible, page = 1, limit = 30, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = ['1=1'];
  const params = [];

  if (req.user.role === 'field_worker') {
    if (req.user.area_id) { where.push('v.area_id = ?'); params.push(req.user.area_id); }
    else                   { where.push('v.assigned_to = ?'); params.push(req.user.id); }
  } else {
    if (area_id)    { where.push('v.area_id = ?');     params.push(area_id); }
    if (assigned_to){ where.push('v.assigned_to = ?'); params.push(assigned_to); }
  }

  if (status)         { where.push('v.status = ?'); params.push(status); }
  if (eligible === 'true') { where.push('v.age BETWEEN 18 AND 35'); }
  if (search) {
    where.push('(v.name LIKE ? OR v.voter_id LIKE ? OR v.phone LIKE ? OR v.father_name LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const whereStr = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) as count FROM voters v WHERE ${whereStr}`).get(...params);
  const voters = db.prepare(`${VOTER_SELECT} WHERE ${whereStr} ORDER BY v.name ASC LIMIT ? OFFSET ?`)
    .all(...params, parseInt(limit), offset);

  res.json({
    success: true,
    data:  voters,
    total: total.count,
    page:  parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(total.count / parseInt(limit)),
  });
});

// GET /api/voters/search
router.get('/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ success: true, data: [] });

  const s = `%${q}%`;
  const voters = db.prepare(
    `${VOTER_SELECT}
     WHERE v.name LIKE ? OR v.voter_id LIKE ? OR v.phone LIKE ? OR v.father_name LIKE ?
     ORDER BY v.name ASC LIMIT 50`
  ).all(s, s, s, s);

  res.json({ success: true, data: voters });
});

// PUT /api/voters/:id/status
router.put('/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'done', 'refused'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  const voter = db.prepare('SELECT * FROM voters WHERE id = ?').get(req.params.id);
  if (!voter) return res.status(404).json({ success: false, error: 'Voter not found' });

  if (req.user.role === 'field_worker' && req.user.area_id && voter.area_id !== req.user.area_id) {
    return res.status(403).json({ success: false, error: 'Not authorized to update this voter' });
  }

  const now      = status !== 'pending' ? new Date().toISOString() : null;
  const markedBy = status !== 'pending' ? req.user.id : null;

  db.prepare('UPDATE voters SET status = ?, marked_by = ?, marked_at = ? WHERE id = ?')
    .run(status, markedBy, now, req.params.id);

  if (status !== 'pending') {
    db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)').run(
      req.user.id,
      'VOTER_STATUS',
      `Marked ${voter.name} (${voter.voter_id || 'N/A'}) as ${status.toUpperCase()}`
    );
  }

  const updated = db.prepare(
    `${VOTER_SELECT} WHERE v.id = ?`
  ).get(req.params.id);

  res.json({ success: true, data: updated });
});

// POST /api/voters/upload
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  try {
    const workbook = XLSX.readFile(req.file.path);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    fs.unlink(req.file.path, () => {});

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'File is empty or has no data rows' });
    }

    const colMap = {
      name:        ['name', 'voter_name', 'full_name', 'नाम', 'Name', 'VOTER NAME'],
      age:         ['age', 'उम्र', 'आयु', 'Age', 'AGE'],
      voter_id:    ['voter_id', 'epic', 'voter_card_no', 'epic_no', 'Voter ID', 'VOTER ID', 'EPIC No'],
      father_name: ['father_name', 'father', 'guardian', 'husband_name', 'Father Name', 'FATHER NAME'],
      phone:       ['phone', 'mobile', 'contact', 'Phone', 'PHONE', 'Mobile'],
      address:     ['address', 'house', 'पता', 'Address', 'ADDRESS'],
      gender:      ['gender', 'sex', 'लिंग', 'Gender', 'GENDER'],
    };

    function findCol(row, keys) {
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const found = rowKeys.find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
        if (found) return row[found];
      }
      return null;
    }

    const areaId = req.body.area_id ? parseInt(req.body.area_id) : null;
    let imported = 0, skipped = 0, eligible = 0;

    const insertVoter = db.prepare(
      'INSERT OR IGNORE INTO voters (name, age, voter_id, father_name, phone, address, gender, area_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    db.transaction((rows) => {
      for (const row of rows) {
        const name = findCol(row, colMap.name);
        if (!name || String(name).trim() === '') { skipped++; continue; }

        const age        = parseInt(findCol(row, colMap.age)) || null;
        const voter_id   = String(findCol(row, colMap.voter_id)    || '').trim() || null;
        const father_name= String(findCol(row, colMap.father_name) || '').trim() || null;
        const phone      = String(findCol(row, colMap.phone)       || '').trim() || null;
        const address    = String(findCol(row, colMap.address)     || '').trim() || null;
        const genderRaw  = String(findCol(row, colMap.gender)      || '').trim().toUpperCase();
        const gender     = ['M','MALE','पु'].includes(genderRaw) ? 'M'
                         : ['F','FEMALE','म'].includes(genderRaw) ? 'F' : null;

        const result = insertVoter.run(String(name).trim(), age, voter_id, father_name, phone, address, gender, areaId);
        if (result.changes > 0) {
          imported++;
          if (age && age >= 18 && age <= 35) eligible++;
        } else {
          skipped++;
        }
      }
    })(rows);

    db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)').run(
      req.user.id, 'UPLOAD_VOTERS',
      `Uploaded ${imported} voters (${skipped} skipped, ${eligible} eligible)`
    );

    res.json({ success: true, data: { total: rows.length, imported, skipped, eligible } });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ success: false, error: `Failed to process file: ${err.message}` });
  }
});

// POST /api/voters/assign
router.post('/assign', authenticateToken, requireAdmin, (req, res) => {
  const { voter_ids, worker_id } = req.body;
  if (!Array.isArray(voter_ids) || !worker_id) {
    return res.status(400).json({ success: false, error: 'voter_ids array and worker_id required' });
  }
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(worker_id)) {
    return res.status(404).json({ success: false, error: 'Worker not found' });
  }
  db.transaction((ids) => {
    for (const id of ids) db.prepare('UPDATE voters SET assigned_to = ? WHERE id = ?').run(worker_id, id);
  })(voter_ids);
  res.json({ success: true, message: `${voter_ids.length} voters assigned` });
});

// POST /api/voters/assign-area
router.post('/assign-area', authenticateToken, requireAdmin, (req, res) => {
  const { area_id, worker_id } = req.body;
  if (!area_id || !worker_id) {
    return res.status(400).json({ success: false, error: 'area_id and worker_id required' });
  }
  const result = db.prepare(
    'UPDATE voters SET assigned_to = ? WHERE area_id = ? AND assigned_to IS NULL'
  ).run(worker_id, area_id);
  res.json({ success: true, message: `${result.changes} voters assigned`, count: result.changes });
});

module.exports = router;
