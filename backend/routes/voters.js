const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { authenticateToken, requireAdmin, requireRole } = require('../middleware/auth');
const { VOTER_SELECT, getTeamUserIds, voterAssignmentScope } = require('../helpers');

// ── Devanagari ↔ Latin helpers ────────────────────────────────────────────────
function isDevanagari(str) {
  return /[\u0900-\u097F]/.test(str);
}

function devanagariToLatin(text) {
  const VIRAMA = '\u094D';
  const consonants = {
    '\u0915':'k','\u0916':'kh','\u0917':'g','\u0918':'gh','\u0919':'ng',
    '\u091A':'ch','\u091B':'chh','\u091C':'j','\u091D':'jh','\u091E':'ny',
    '\u091F':'t','\u0920':'th','\u0921':'d','\u0922':'dh','\u0923':'n',
    '\u0924':'t','\u0925':'th','\u0926':'d','\u0927':'dh','\u0928':'n',
    '\u092A':'p','\u092B':'ph','\u092C':'b','\u092D':'bh','\u092E':'m',
    '\u092F':'y','\u0930':'r','\u0932':'l','\u0935':'v',
    '\u0936':'sh','\u0937':'sh','\u0938':'s','\u0939':'h',
    '\u0933':'l','\u0929':'n','\u0931':'r',
  };
  const standalone = {
    '\u0905':'a','\u0906':'aa','\u0907':'i','\u0908':'i',
    '\u0909':'u','\u090A':'u','\u090F':'e','\u0910':'ai',
    '\u0913':'o','\u0914':'au','\u090B':'ri',
  };
  const matras = {
    '\u093E':'a','\u093F':'i','\u0940':'i','\u0941':'u','\u0942':'u',
    '\u0947':'e','\u0948':'ai','\u094B':'o','\u094C':'au','\u0943':'ri',
    '\u0902':'n','\u0903':'h','\u0901':'n',
  };
  const chars = [...text];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (consonants[ch]) {
      const next = chars[i + 1];
      if (next === VIRAMA) {
        out += consonants[ch]; i += 2;
      } else if (next && matras[next]) {
        out += consonants[ch] + matras[next]; i += 2;
      } else {
        // Inherent 'a' suppressed at word boundary (schwa deletion)
        const wordEnd = !next || next === ' ' || next === '-';
        out += consonants[ch] + (wordEnd ? '' : 'a'); i++;
      }
    } else if (standalone[ch]) {
      out += standalone[ch]; i++;
    } else {
      out += ch; i++;
    }
  }
  return out.toLowerCase();
}

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

    // Hierarchy-based scoping:
    //   super_admin  → sees all (optional assigned_to filter)
    //   team_lead    → sees voters assigned to self + all descendant team members (via users.parent_id)
    //   field_worker → sees only voters assigned to self
    const teamIds = await getTeamUserIds(req.user);
    const scope   = voterAssignmentScope(teamIds);
    where.push(scope.where);
    params.push(...scope.params);

    // super_admin can additionally filter by a specific assignee
    if (req.user.role === 'super_admin' && assigned_to) {
      where.push('v.assigned_to = ?');
      params.push(assigned_to);
    }

    if (area_id && req.user.role === 'super_admin') { where.push('v.area_id = ?'); params.push(area_id); }
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
    // Sub-section filter (stored as concatenated string per voter, e.g.
    // "1-पिनारे का मोहल्ला,कानोड वाई 15, 2-नई बावड़ी,…") — match with LIKE.
    if (req.query.sub_section) {
      where.push('v.sub_section LIKE ?');
      params.push(`%${req.query.sub_section}%`);
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

// GET /api/voters/sub-sections → distinct sub-section tokens within the caller's scope.
// Splits the stored string on ", <digit>-" so each token like "1-पिनारे का मोहल्ला,कानोड वाई 15"
// stays intact even though it contains internal commas.
router.get('/sub-sections', authenticateToken, async (req, res, next) => {
  try {
    const teamIds = await getTeamUserIds(req.user);
    const scope = voterAssignmentScope(teamIds);

    const where = [scope.where, 'v.sub_section IS NOT NULL', "v.sub_section != ''"];
    const params = [...scope.params];
    if (req.query.part_number) {
      where.push('v.part_number = ?');
      params.push(parseInt(req.query.part_number));
    }
    if (req.query.part_name) {
      where.push('v.part_number IN (SELECT part_number FROM parts WHERE part_name = ?)');
      params.push(req.query.part_name);
    }

    const rows = await db.query(
      `SELECT DISTINCT v.sub_section FROM voters v WHERE ${where.join(' AND ')}`,
      params
    );

    const tokens = new Map(); // token → count placeholder (kept for ordering stability)
    const splitRe = /,\s*(?=\d+-)/;
    for (const r of rows) {
      const parts = String(r.sub_section).split(splitRe).map(s => s.trim()).filter(Boolean);
      for (const p of parts) tokens.set(p, (tokens.get(p) || 0) + 1);
    }

    const data = Array.from(tokens.keys()).sort((a, b) => {
      const na = parseInt(a); const nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

    res.json({ success: true, data });
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
    const where = ['(v.name LIKE ? OR v.voter_id LIKE ? OR v.phone LIKE ? OR v.father_name LIKE ?)'];
    const params = [s, s, s, s];

    const teamIds = await getTeamUserIds(req.user);
    const scope   = voterAssignmentScope(teamIds);
    where.push(scope.where);
    params.push(...scope.params);

    const voters = await db.query(
      `${VOTER_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY v.name ASC LIMIT 50`,
      params
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

    // Hierarchy-based scope check (team_lead: self+descendants, field_worker: self)
    if (req.user.role !== 'super_admin') {
      const teamIds = await getTeamUserIds(req.user);
      if (!teamIds || teamIds.length === 0 || !teamIds.includes(voter.assigned_to)) {
        return res.status(403).json({ success: false, error: 'Not authorized to update this voter' });
      }
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
      name:           ['name', 'voter_name', 'full_name', 'hindi_name', 'नाम', 'Name', 'VOTER NAME'],
      age:            ['age', 'उम्र', 'आयु', 'Age', 'AGE'],
      voter_id:       ['voter_id', 'epic', 'voter_card_no', 'epic_no', 'Voter ID', 'VOTER ID', 'EPIC No'],
      father_name:    ['father_name', 'father', 'guardian', 'husband_name', 'husband', 'Father Name', 'FATHER NAME'],
      phone:          ['phone', 'mobile', 'contact', 'Phone', 'PHONE', 'Mobile'],
      address:        ['address', 'पता', 'Address', 'ADDRESS'],
      gender:         ['gender', 'sex', 'लिंग', 'Gender', 'GENDER'],
      sr_no:          ['sr_no', 'serial_no', 'sno', 'Sr No', 'SR NO'],
      house_no:       ['house_no', 'house', 'House No', 'HOUSE NO'],
      relation_type:  ['relation_type', 'relation', 'Relation'],
      epic_confidence:['epic_confidence', 'confidence'],
      state_code:     ['state_code', 'State Code'],
      constituency_no:['constituency_no', 'constituency', 'Constituency No'],
      part_no:        ['part_no', 'part_number', 'Part No', 'PART NO'],
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
    const bodyPartNumber = req.body.part_number ? parseInt(req.body.part_number) : null;
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

        const srNoRaw         = findCol(row, colMap.sr_no);
        const sr_no           = srNoRaw !== null && srNoRaw !== '' ? parseInt(srNoRaw) || null : null;
        const house_no        = String(findCol(row, colMap.house_no)        || '').trim() || null;
        const relation_type   = String(findCol(row, colMap.relation_type)   || '').trim() || null;
        const epicConfRaw     = findCol(row, colMap.epic_confidence);
        const epic_confidence = epicConfRaw !== null && epicConfRaw !== '' ? parseFloat(epicConfRaw) || null : null;
        const state_code      = String(findCol(row, colMap.state_code)      || '').trim() || null;
        const constRaw        = findCol(row, colMap.constituency_no);
        const constituency_no = constRaw !== null && constRaw !== '' ? parseInt(constRaw) || null : null;
        const rowPartRaw      = findCol(row, colMap.part_no);
        const rowPartNumber   = rowPartRaw !== null && rowPartRaw !== '' ? parseInt(rowPartRaw) || null : null;
        const partNumber      = rowPartNumber ?? bodyPartNumber;

        // Store name as-given (Hindi or Latin) — matches existing rows
        const storedName = String(name).trim();

        const [result] = await conn.execute(
          `INSERT IGNORE INTO voters
             (name, age, voter_id, father_name, phone, address, gender,
              area_id, part_number, sr_no, house_no, relation_type,
              epic_confidence, state_code, constituency_no)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [storedName, age, voter_id, father_name, phone, address, gender,
           areaId, partNumber, sr_no, house_no, relation_type,
           epic_confidence, state_code, constituency_no]
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
