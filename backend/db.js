const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

let pool;

function getPoolConfig() {
  if (process.env.MYSQL_URL) {
    const url = new URL(process.env.MYSQL_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace('/', ''),
      connectionLimit: 10,
      waitForConnections: true,
    };
  }

  return {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'election',
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    connectionLimit: 10,
    waitForConnections: true,
  };
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool(getPoolConfig());
  }
  return pool;
}

const db = {
  async query(sql, params = []) {
    const [rows] = await getPool().query(sql, params);
    return rows;
  },

  async get(sql, params = []) {
    const [rows] = await getPool().query(sql, params);
    return rows[0] || undefined;
  },

  async run(sql, params = []) {
    const [result] = await getPool().query(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  },

  async transaction(fn) {
    const conn = await getPool().getConnection();
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

async function initDatabase() {
  const p = getPool();

  await p.execute(`
    CREATE TABLE IF NOT EXISTS areas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      district VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await p.execute(`
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
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      age INT,
      voter_id VARCHAR(50) UNIQUE,
      father_name VARCHAR(255),
      phone VARCHAR(20),
      address TEXT,
      gender ENUM('M', 'F'),
      area_id INT,
      assigned_to INT,
      status ENUM('pending', 'done', 'refused') DEFAULT 'pending',
      marked_by INT,
      marked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Indexes for voters (ignore errors if already exist)
  const safeIndex = async (sql) => { try { await p.execute(sql); } catch {} };
  await safeIndex('CREATE INDEX idx_voters_area ON voters(area_id)');
  await safeIndex('CREATE INDEX idx_voters_assigned ON voters(assigned_to)');
  await safeIndex('CREATE INDEX idx_voters_status ON voters(status)');
  await safeIndex('CREATE INDEX idx_voters_age ON voters(age)');

  await p.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      sent_by INT,
      target_area_id INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (target_area_id) REFERENCES areas(id) ON DELETE SET NULL
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      user_id INT NOT NULL,
      notification_id INT NOT NULL,
      is_read TINYINT DEFAULT 0,
      PRIMARY KEY (user_id, notification_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      file_path VARCHAR(500) NOT NULL,
      original_name VARCHAR(255),
      uploaded_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      action VARCHAR(255) NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS parts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      part_id INT,
      state_cd VARCHAR(10),
      district_cd VARCHAR(10),
      ac_number INT,
      part_number INT NOT NULL,
      part_name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_part (ac_number, part_number)
    )
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
  const [rows] = await getPool().execute('SELECT COUNT(*) AS cnt FROM users');
  if (rows[0].cnt > 0) {
    console.log('Database already seeded, skipping');
    return;
  }

  const adminPass = bcrypt.hashSync('admin123', 10);
  const workerPass = bcrypt.hashSync('worker123', 10);

  const p = getPool();

  // Areas
  const areas = [
    ['Ward 1 - Sadar Bazaar', 'Dehradun'],
    ['Ward 2 - Civil Lines', 'Dehradun'],
    ['Ward 3 - Rajpur Road', 'Dehradun'],
    ['Ward 4 - Nehru Colony', 'Dehradun'],
    ['Ward 5 - Gandhi Nagar', 'Dehradun'],
    ['Ward 6 - Subhash Chowk', 'Dehradun'],
    ['Ward 7 - Lal Darwaza', 'Hardwar'],
    ['Ward 8 - Ram Nagar', 'Nainital'],
  ];
  for (const [name, district] of areas) {
    await p.execute(
      'INSERT IGNORE INTO areas (name, district) VALUES (?, ?)',
      [name, district]
    );
  }

  // Super Admins
  const insertUser =
    'INSERT IGNORE INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)';
  await p.execute(insertUser, ['Rajesh Kumar', '9999999001', adminPass, 'super_admin', null, null]);
  await p.execute(insertUser, ['Sunil Sharma', '9999999002', adminPass, 'super_admin', null, null]);
  await p.execute(insertUser, ['Priya Verma', '9999999003', adminPass, 'super_admin', null, null]);

  // Field Workers
  await p.execute(insertUser, ['Amit Singh', '8888888001', workerPass, 'field_worker', 1, null]);
  await p.execute(insertUser, ['Deepak Yadav', '8888888002', workerPass, 'field_worker', 2, null]);
  await p.execute(insertUser, ['Ravi Tiwari', '8888888003', workerPass, 'field_worker', 3, null]);
  await p.execute(insertUser, ['Pooja Gupta', '8888888004', workerPass, 'field_worker', 4, null]);
  await p.execute(insertUser, ['Manoj Pandey', '8888888005', workerPass, 'field_worker', 5, null]);
  await p.execute(insertUser, ['Neha Rawat', '8888888006', workerPass, 'field_worker', 6, null]);

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
