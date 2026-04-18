const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/parts - List all parts, grouped by part_name
// Returns: { success: true, data: [...] }
// Each item: { part_name, part_numbers: [1,2,3], count: 3 }
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const parts = await db.query(
      'SELECT part_name, GROUP_CONCAT(part_number ORDER BY part_number) as part_numbers, COUNT(*) as count FROM parts GROUP BY part_name ORDER BY part_name'
    );
    const data = parts.map(p => ({
      part_name: p.part_name,
      part_numbers: p.part_numbers.split(',').map(Number),
      count: p.count,
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/parts/all - List all parts flat
router.get('/all', authenticateToken, async (req, res, next) => {
  try {
    const parts = await db.query('SELECT * FROM parts ORDER BY part_number');
    res.json({ success: true, data: parts });
  } catch (err) {
    next(err);
  }
});

// POST /api/parts/seed - Seed parts data from JSON body
// Body: array of { partId, stateCd, districtCd, acNumber, partNumber, partName }
router.post('/seed', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const parts = req.body;
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of parts required' });
    }

    let imported = 0, skipped = 0;
    await db.transaction(async (conn) => {
      for (const p of parts) {
        const [result] = await conn.execute(
          'INSERT IGNORE INTO parts (part_id, state_cd, district_cd, ac_number, part_number, part_name) VALUES (?, ?, ?, ?, ?, ?)',
          [p.partId || null, p.stateCd || null, p.districtCd || null, p.acNumber || null, p.partNumber, p.partName]
        );
        if (result.affectedRows > 0) imported++;
        else skipped++;
      }
    });

    res.json({ success: true, data: { total: parts.length, imported, skipped } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
