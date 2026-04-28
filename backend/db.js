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
      role ENUM('super_admin', 'team_lead', 'field_worker') NOT NULL,
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
      gender CHAR(1),
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
      user_id INT,
      notification_id INT,
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

  const safeAlter = async (sql) => { try { await p.query(sql); } catch {} };
  await safeAlter('ALTER TABLE voters ADD COLUMN part_number INT');
  await safeAlter('CREATE INDEX idx_voters_part ON voters(part_number)');
  await safeAlter('ALTER TABLE users ADD COLUMN part_name VARCHAR(255)');
  await safeAlter('ALTER TABLE users ADD COLUMN part_number INT');
  await safeAlter('ALTER TABLE users ADD COLUMN part_numbers VARCHAR(500)');
  await safeAlter("ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'team_lead', 'field_worker') NOT NULL");
  await safeAlter("UPDATE users SET role = 'field_worker' WHERE role = 'sub_worker'");
  await safeAlter("ALTER TABLE parts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'");
  await safeAlter("CREATE INDEX idx_parts_status ON parts(status)");

  // ── Columns produced by vision_pdf_parser_4.py ──────────────────────────
  // Dates stored as VARCHAR because the parser emits dd-mm-yyyy strings,
  // which MySQL DATE columns won't accept without conversion.
  await safeAlter('ALTER TABLE voters ADD COLUMN sr_no INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN house_no VARCHAR(100) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN relation_type VARCHAR(10) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN epic_confidence FLOAT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN state_code VARCHAR(10) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN constituency_no INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN constituency_name VARCHAR(255) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN part_no INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN part_name VARCHAR(255) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN sub_section_no INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN sub_section VARCHAR(255) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN qualifying_date VARCHAR(20) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN publication_date VARCHAR(20) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN total_pages INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN page_no INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN roll_type VARCHAR(20) DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN roll_year INT DEFAULT NULL');
  await safeAlter('ALTER TABLE voters ADD COLUMN source_pdf VARCHAR(500) DEFAULT NULL');
  await safeAlter('CREATE INDEX idx_voters_part_no ON voters(part_no)');
  await safeAlter('CREATE INDEX idx_voters_voter_id ON voters(voter_id)');

  console.log('Database tables initialized');
}

async function seedDatabase() {
  const [rows] = await getPool().execute('SELECT COUNT(*) AS cnt FROM users');
  if (rows[0].cnt > 0) return;

  const adminPass = bcrypt.hashSync('admin123', 10);

  await db.run(
    'INSERT IGNORE INTO users (name, phone, password, role) VALUES (?, ?, ?, ?)',
    ['Pratik', '8529292172', adminPass, 'super_admin']
  );

  console.log('Database seeded with admin user');
}

module.exports = { db, initDatabase, seedDatabase };
