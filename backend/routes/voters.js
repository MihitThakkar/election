const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { VOTER_SELECT } = require('../helpers');

const { execFile } = require('child_process');

const uploadDir = path.join(__dirname, '../uploads/temp/');

const upload = multer({
  storage: process.env.VERCEL ? multer.memoryStorage() : multer.diskStorage({ destination: uploadDir }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, `pdf_${Date.now()}.pdf`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for large voter roll PDFs
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf');
  },
});

// GET /api/voters
router.get('/', authenticateToken, async (req, res, next) => {
  try {
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
    if (req.query.part_number) {
      where.push('v.part_number = ?');
      params.push(parseInt(req.query.part_number));
    }
    if (req.query.part_name) {
      where.push('v.part_number IN (SELECT part_number FROM parts WHERE part_name = ?)');
      params.push(req.query.part_name);
    }

    const whereStr = where.join(' AND ');
    const total = await db.get(`SELECT COUNT(*) as count FROM voters v WHERE ${whereStr}`, params);
    const voters = await db.query(
      `${VOTER_SELECT} WHERE ${whereStr} ORDER BY v.name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data:  voters,
      total: total.count,
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total.count / parseInt(limit)),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/voters/search
router.get('/search', authenticateToken, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const s = `%${q}%`;
    const voters = await db.query(
      `${VOTER_SELECT}
       WHERE v.name LIKE ? OR v.voter_id LIKE ? OR v.phone LIKE ? OR v.father_name LIKE ?
       ORDER BY v.name ASC LIMIT 50`,
      [s, s, s, s]
    );

    res.json({ success: true, data: voters });
  } catch (err) {
    next(err);
  }
});

// PUT /api/voters/:id/status
router.put('/:id/status', authenticateToken, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'done', 'refused'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const voter = await db.get('SELECT * FROM voters WHERE id = ?', [req.params.id]);
    if (!voter) return res.status(404).json({ success: false, error: 'Voter not found' });

    if (req.user.role === 'field_worker' && req.user.area_id && voter.area_id !== req.user.area_id) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this voter' });
    }

    const now      = status !== 'pending' ? new Date().toISOString() : null;
    const markedBy = status !== 'pending' ? req.user.id : null;

    await db.run(
      'UPDATE voters SET status = ?, marked_by = ?, marked_at = ? WHERE id = ?',
      [status, markedBy, now, req.params.id]
    );

    if (status !== 'pending') {
      await db.run(
        'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
        [req.user.id, 'VOTER_STATUS', `Marked ${voter.name} (${voter.voter_id || 'N/A'}) as ${status.toUpperCase()}`]
      );
    }

    const updated = await db.get(
      `${VOTER_SELECT} WHERE v.id = ?`,
      [req.params.id]
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/voters/upload
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  try {
    let workbook;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isCsv = ext === '.csv';

    if (isCsv) {
      // For CSV files, read as UTF-8 string first to preserve Hindi/Unicode text
      const csvText = req.file.buffer
        ? req.file.buffer.toString('utf-8')
        : fs.readFileSync(req.file.path, 'utf-8');
      workbook = XLSX.read(csvText, { type: 'string' });
    } else {
      workbook = req.file.buffer
        ? XLSX.read(req.file.buffer, { type: 'buffer', codepage: 65001 })
        : XLSX.readFile(req.file.path, { codepage: 65001 });
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (req.file.path) fs.unlink(req.file.path, () => {});

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
    const partNumber = req.body.part_number ? parseInt(req.body.part_number) : null;
    let imported = 0, skipped = 0, eligible = 0;

    await db.transaction(async (conn) => {
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

        const [result] = await conn.execute(
          'INSERT IGNORE INTO voters (name, age, voter_id, father_name, phone, address, gender, area_id, part_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [String(name).trim(), age, voter_id, father_name, phone, address, gender, areaId, partNumber]
        );
        if (result.affectedRows > 0) {
          imported++;
          if (age && age >= 18 && age <= 35) eligible++;
        } else {
          skipped++;
        }
      }
    });

    await db.run(
      'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, 'UPLOAD_VOTERS', `Uploaded ${imported} voters (${skipped} skipped, ${eligible} eligible)`]
    );

    res.json({ success: true, data: { total: rows.length, imported, skipped, eligible } });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// POST /api/voters/assign
router.post('/assign', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { voter_ids, worker_id } = req.body;
    if (!Array.isArray(voter_ids) || !worker_id) {
      return res.status(400).json({ success: false, error: 'voter_ids array and worker_id required' });
    }
    const worker = await db.get('SELECT id FROM users WHERE id = ?', [worker_id]);
    if (!worker) {
      return res.status(404).json({ success: false, error: 'Worker not found' });
    }
    await db.transaction(async (conn) => {
      for (const id of voter_ids) {
        await conn.execute('UPDATE voters SET assigned_to = ? WHERE id = ?', [worker_id, id]);
      }
    });
    res.json({ success: true, message: `${voter_ids.length} voters assigned` });
  } catch (err) {
    next(err);
  }
});

// POST /api/voters/assign-area
router.post('/assign-area', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { area_id, worker_id } = req.body;
    if (!area_id || !worker_id) {
      return res.status(400).json({ success: false, error: 'area_id and worker_id required' });
    }
    const result = await db.run(
      'UPDATE voters SET assigned_to = ? WHERE area_id = ? AND assigned_to IS NULL',
      [worker_id, area_id]
    );
    res.json({ success: true, message: `${result.affectedRows} voters assigned`, count: result.affectedRows });
  } catch (err) {
    next(err);
  }
});

// POST /api/voters/upload-pdf — Upload voter roll PDF (Hindi), OCR extract, insert into DB
router.post('/upload-pdf', authenticateToken, requireAdmin, pdfUpload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No PDF file uploaded' });

  const pdfPath = req.file.path;
  const scriptPath = path.join(__dirname, '../scripts/parse-voter-pdf.py');
  const areaId = req.body.area_id ? parseInt(req.body.area_id) : null;
  const partNumber = req.body.part_number ? parseInt(req.body.part_number) : null;

  try {
    // Run the Python OCR script
    const voters = await new Promise((resolve, reject) => {
      execFile('python3', [scriptPath, pdfPath, '--output', 'json', '--skip-pages', '1,2'], {
        timeout: 10 * 60 * 1000, // 10 min timeout for large PDFs
        maxBuffer: 50 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        // Clean up the uploaded PDF
        fs.unlink(pdfPath, () => {});

        if (err) {
          console.error('PDF OCR error:', stderr);
          return reject(new Error(`PDF processing failed: ${err.message}`));
        }

        try {
          const data = JSON.parse(stdout);
          resolve(data);
        } catch (parseErr) {
          reject(new Error('Failed to parse OCR output'));
        }
      });
    });

    if (!voters || voters.length === 0) {
      return res.status(400).json({ success: false, error: 'No voters found in PDF' });
    }

    // Insert voters into database
    let imported = 0, skipped = 0, eligible = 0;

    await db.transaction(async (conn) => {
      for (const v of voters) {
        if (!v.name || v.name.trim().length < 2) { skipped++; continue; }

        const gender = v.gender === 'F' ? 'F' : v.gender === 'M' ? 'M' : null;
        const address = v.house_no ? `House ${v.house_no}` : null;

        const [result] = await conn.execute(
          'INSERT IGNORE INTO voters (name, age, voter_id, father_name, phone, address, gender, area_id, part_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            v.name.trim(),
            v.age || null,
            v.voter_id || null,
            v.father_name || null,
            null, // phone not in voter rolls
            address,
            gender,
            areaId,
            partNumber
          ]
        );

        if (result.affectedRows > 0) {
          imported++;
          if (v.age && v.age >= 18 && v.age <= 35) eligible++;
        } else {
          skipped++;
        }
      }
    });

    await db.run(
      'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
      [req.user.id, 'UPLOAD_PDF_VOTERS', `Uploaded ${imported} voters from PDF (${skipped} skipped, ${eligible} eligible)`]
    );

    res.json({
      success: true,
      data: {
        total_in_pdf: voters.length,
        imported,
        skipped,
        eligible,
      },
    });
  } catch (err) {
    fs.unlink(pdfPath, () => {});
    console.error('PDF upload error:', err);
    next(err);
  }
});

module.exports = router;
