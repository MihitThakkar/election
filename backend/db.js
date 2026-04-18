const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'election.db');
const _db = new Database(DB_PATH);
_db.pragma('journal_mode = WAL');
_db.pragma('foreign_keys = ON');

// Async-compatible wrapper around better-sqlite3 (sync) so all route files
// can use await without changes.
const db = {
  async query(sql, params = []) {
    const s = _db.prepare(sql);
    const upper = sql.trimStart().toUpperCase();
    if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
      return s.all(params);
    }
    const r = s.run(params);
    return { insertId: r.lastInsertRowid, affectedRows: r.changes };
  },

  async get(sql, params = []) {
    return _db.prepare(sql).get(params);
  },

  async run(sql, params = []) {
    const r = _db.prepare(sql).run(params);
    return { insertId: r.lastInsertRowid, affectedRows: r.changes };
  },

  // Simulates a MySQL connection object for use inside transactions.
  async transaction(fn) {
    const conn = {
      async execute(sql, params = []) {
        const s = _db.prepare(sql);
        const upper = sql.trimStart().toUpperCase();
        if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
          return [s.all(params), {}];
        }
        const r = s.run(params);
        return [{ insertId: r.lastInsertRowid, affectedRows: r.changes }, {}];
      },
      async query(sql, params = []) {
        return db.query(sql, params);
      },
    };

    _db.prepare('BEGIN').run();
    try {
      const result = await fn(conn);
      _db.prepare('COMMIT').run();
      return result;
    } catch (err) {
      _db.prepare('ROLLBACK').run();
      throw err;
    }
  },
};

async function initDatabase() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      district TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('super_admin', 'team_lead', 'field_worker', 'sub_worker') NOT NULL,
      parent_id INT,
      area_id INT,
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_hindi TEXT,
      age INTEGER,
      voter_id TEXT UNIQUE,
      father_name TEXT,
      phone TEXT,
      address TEXT,
      gender TEXT CHECK(gender IN ('M','F') OR gender IS NULL),
      area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','done','refused')),
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      marked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      part_number INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_voters_area      ON voters(area_id);
    CREATE INDEX IF NOT EXISTS idx_voters_assigned  ON voters(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_voters_status    ON voters(status);
    CREATE INDEX IF NOT EXISTS idx_voters_age       ON voters(age);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
      is_read INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, notification_id)
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      original_name TEXT,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER,
      state_cd TEXT,
      district_cd TEXT,
      ac_number INTEGER,
      part_number INTEGER NOT NULL,
      part_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ac_number, part_number)
    );
  `);

  // Safe ALTER for adding part_number to voters (may already exist in production)
  const safeAlter = async (sql) => { try { await p.query(sql); } catch {} };
  await safeAlter('ALTER TABLE voters ADD COLUMN part_number INT');
  await safeAlter('CREATE INDEX idx_voters_part ON voters(part_number)');
  await safeAlter('ALTER TABLE users ADD COLUMN part_name VARCHAR(255)');
  await safeAlter('ALTER TABLE users ADD COLUMN part_number INT');
  await safeAlter("ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'team_lead', 'field_worker', 'sub_worker') NOT NULL");
  await safeAlter('ALTER TABLE users ADD COLUMN part_numbers VARCHAR(500)');

  console.log('Database tables initialized');
}

async function seedDatabase() {
  const row = _db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
  if (row.cnt > 0) {
    console.log('Database already seeded, skipping');
    return;
  }

  const adminPass  = bcrypt.hashSync('admin123', 10);
  const workerPass = bcrypt.hashSync('worker123', 10);

  const areas = [
    ['Ward 1 - Sadar Bazaar', 'Dehradun'],
    ['Ward 2 - Civil Lines',  'Dehradun'],
    ['Ward 3 - Rajpur Road',  'Dehradun'],
    ['Ward 4 - Nehru Colony', 'Dehradun'],
    ['Ward 5 - Gandhi Nagar', 'Dehradun'],
    ['Ward 6 - Subhash Chowk','Dehradun'],
    ['Ward 7 - Lal Darwaza',  'Hardwar'],
    ['Ward 8 - Ram Nagar',    'Nainital'],
  ];
  const insArea = _db.prepare('INSERT OR IGNORE INTO areas (name, district) VALUES (?, ?)');
  for (const [name, district] of areas) insArea.run(name, district);

  const insUser = _db.prepare(
    'INSERT OR IGNORE INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insUser.run('Rajesh Kumar', '9999999001', adminPass,  'super_admin', null, null);
  insUser.run('Sunil Sharma', '9999999002', adminPass,  'super_admin', null, null);
  insUser.run('Priya Verma',  '9999999003', adminPass,  'super_admin', null, null);
  insUser.run('Amit Singh',   '8888888001', workerPass, 'field_worker', 1, null);
  insUser.run('Deepak Yadav', '8888888002', workerPass, 'field_worker', 2, null);
  insUser.run('Ravi Tiwari',  '8888888003', workerPass, 'field_worker', 3, null);
  insUser.run('Pooja Gupta',  '8888888004', workerPass, 'field_worker', 4, null);
  insUser.run('Manoj Pandey', '8888888005', workerPass, 'field_worker', 5, null);
  insUser.run('Neha Rawat',   '8888888006', workerPass, 'field_worker', 6, null);

  // Sub-Workers (parent_id references field workers inserted above)
  // Need to fetch actual IDs for parent references
  const [amitRows] = await p.execute("SELECT id FROM users WHERE phone = '8888888001'");
  const [deepakRows] = await p.execute("SELECT id FROM users WHERE phone = '8888888002'");
  const amitId = amitRows[0].id;
  const deepakId = deepakRows[0].id;

  await p.execute(insertUser, ['Rahul Chauhan', '7777777001', workerPass, 'field_worker', 1, amitId]);
  await p.execute(insertUser, ['Vikram Joshi', '7777777002', workerPass, 'field_worker', 1, amitId]);
  await p.execute(insertUser, ['Sanjay Negi', '7777777003', workerPass, 'field_worker', 2, deepakId]);

  // Team Leads (assigned to a village)
  const tlResult = await db.run(
    'INSERT IGNORE INTO users (name, phone, password, role, part_name, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
    ['Vikram Team Lead', '6666666001', adminPass, 'team_lead', 'VALLABH NAGAR', null]
  );
  // Sub Workers
  await db.run(
    'INSERT IGNORE INTO users (name, phone, password, role, part_number, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
    ['Ravi Sub Worker', '5555555001', workerPass, 'sub_worker', 18, 4]
  );

  console.log('Database seeded with admin users and areas');
}

module.exports = { db, initDatabase, seedDatabase };
