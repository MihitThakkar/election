const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'election.db');
const isNew = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      district TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'field_worker')),
      parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      voter_id TEXT UNIQUE,
      father_name TEXT,
      phone TEXT,
      address TEXT,
      gender TEXT CHECK(gender IN ('M', 'F') OR gender IS NULL),
      area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'refused')),
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      marked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_voters_area ON voters(area_id);
    CREATE INDEX IF NOT EXISTS idx_voters_assigned ON voters(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_voters_status ON voters(status);
    CREATE INDEX IF NOT EXISTS idx_voters_age ON voters(age);

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
  `);
}

function seedData() {
  const adminPass = bcrypt.hashSync('admin123', 10);
  const workerPass = bcrypt.hashSync('worker123', 10);

  // Areas
  const insertArea = db.prepare('INSERT INTO areas (name, district) VALUES (?, ?)');
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
  areas.forEach(([name, district]) => insertArea.run(name, district));

  // Super Admins
  const insertUser = db.prepare(
    'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertUser.run('Rajesh Kumar', '9999999001', adminPass, 'super_admin', null, null);
  insertUser.run('Sunil Sharma', '9999999002', adminPass, 'super_admin', null, null);
  insertUser.run('Priya Verma', '9999999003', adminPass, 'super_admin', null, null);

  // Field Workers (ids 4-9)
  insertUser.run('Amit Singh', '8888888001', workerPass, 'field_worker', 1, null);
  insertUser.run('Deepak Yadav', '8888888002', workerPass, 'field_worker', 2, null);
  insertUser.run('Ravi Tiwari', '8888888003', workerPass, 'field_worker', 3, null);
  insertUser.run('Pooja Gupta', '8888888004', workerPass, 'field_worker', 4, null);
  insertUser.run('Manoj Pandey', '8888888005', workerPass, 'field_worker', 5, null);
  insertUser.run('Neha Rawat', '8888888006', workerPass, 'field_worker', 6, null);

  // Sub-Workers (ids 10-12)
  insertUser.run('Rahul Chauhan', '7777777001', workerPass, 'field_worker', 1, 4);
  insertUser.run('Vikram Joshi', '7777777002', workerPass, 'field_worker', 1, 4);
  insertUser.run('Sanjay Negi', '7777777003', workerPass, 'field_worker', 2, 5);

  // Voters - 5 per ward for wards 1-6
  const insertVoter = db.prepare(
    'INSERT INTO voters (name, age, voter_id, father_name, phone, address, gender, area_id, assigned_to, status, marked_by, marked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  // Ward 1 voters (area_id=1, assigned to Amit=4 and Rahul=10)
  insertVoter.run('Arun Kumar', 24, 'UP1234567', 'Mohan Kumar', '9812345001', 'H-12, Sadar Bazaar', 'M', 1, 4, 'done', 4, now);
  insertVoter.run('Sunita Devi', 29, 'UP1234568', 'Ram Prasad', '9812345002', 'H-15, Sadar Bazaar', 'F', 1, 4, 'done', 4, now);
  insertVoter.run('Deependra Singh', 32, 'UP1234569', 'Balveer Singh', '9812345003', 'H-23, Sadar Bazaar', 'M', 1, 10, 'refused', 10, yesterday);
  insertVoter.run('Kavita Rawat', 19, 'UP1234570', 'Gopal Rawat', '9812345004', 'H-8, Sadar Bazaar', 'F', 1, 10, 'pending', null, null);
  insertVoter.run('Pankaj Negi', 22, 'UP1234571', 'Suresh Negi', '9812345005', 'H-45, Sadar Bazaar', 'M', 1, 4, 'pending', null, null);

  // Ward 2 voters (area_id=2, assigned to Deepak=5 and Sanjay=12)
  insertVoter.run('Meena Sharma', 27, 'UP2234567', 'Vijay Sharma', '9812346001', 'B-3, Civil Lines', 'F', 2, 5, 'done', 5, now);
  insertVoter.run('Rohit Gupta', 33, 'UP2234568', 'Anil Gupta', '9812346002', 'B-7, Civil Lines', 'M', 2, 5, 'done', 5, yesterday);
  insertVoter.run('Anita Bisht', 21, 'UP2234569', 'Harish Bisht', '9812346003', 'B-12, Civil Lines', 'F', 2, 12, 'done', 12, now);
  insertVoter.run('Suresh Negi', 45, 'UP2234570', 'Dhan Singh', '9812346004', 'B-19, Civil Lines', 'M', 2, 12, 'refused', 12, yesterday);
  insertVoter.run('Rekha Joshi', 28, 'UP2234571', 'Mohan Joshi', '9812346005', 'B-22, Civil Lines', 'F', 2, 5, 'pending', null, null);

  // Ward 3 voters (area_id=3, assigned to Ravi=6)
  insertVoter.run('Vikas Tiwari', 26, 'UP3234567', 'Om Prakash', '9812347001', 'R-4, Rajpur Road', 'M', 3, 6, 'done', 6, now);
  insertVoter.run('Geeta Rani', 31, 'UP3234568', 'Lakhan Lal', '9812347002', 'R-9, Rajpur Road', 'F', 3, 6, 'done', 6, yesterday);
  insertVoter.run('Ashok Pandey', 55, 'UP3234569', 'Shiv Prasad', '9812347003', 'R-15, Rajpur Road', 'M', 3, 6, 'refused', 6, now);
  insertVoter.run('Ritu Singh', 23, 'UP3234570', 'Amar Singh', '9812347004', 'R-28, Rajpur Road', 'F', 3, 6, 'pending', null, null);
  insertVoter.run('Narendra Yadav', 35, 'UP3234571', 'Bhola Yadav', '9812347005', 'R-33, Rajpur Road', 'M', 3, 6, 'pending', null, null);

  // Ward 4 voters (area_id=4, assigned to Pooja=7)
  insertVoter.run('Sonia Rawat', 20, 'UP4234567', 'Dinesh Rawat', '9812348001', 'N-6, Nehru Colony', 'F', 4, 7, 'done', 7, now);
  insertVoter.run('Manoj Kumar', 18, 'UP4234568', 'Ramesh Kumar', '9812348002', 'N-11, Nehru Colony', 'M', 4, 7, 'done', 7, now);
  insertVoter.run('Pushpa Devi', 62, 'UP4234569', 'Bhagwan Das', '9812348003', 'N-14, Nehru Colony', 'F', 4, 7, 'pending', null, null);
  insertVoter.run('Rajesh Negi', 30, 'UP4234570', 'Kedar Negi', '9812348004', 'N-20, Nehru Colony', 'M', 4, 7, 'pending', null, null);
  insertVoter.run('Priya Bisht', 25, 'UP4234571', 'Chandra Bisht', '9812348005', 'N-27, Nehru Colony', 'F', 4, 7, 'pending', null, null);

  // Ward 5 voters (area_id=5, assigned to Manoj=8)
  insertVoter.run('Sunil Chauhan', 34, 'UP5234567', 'Govind Chauhan', '9812349001', 'G-2, Gandhi Nagar', 'M', 5, 8, 'done', 8, yesterday);
  insertVoter.run('Anita Verma', 22, 'UP5234568', 'Ratan Verma', '9812349002', 'G-8, Gandhi Nagar', 'F', 5, 8, 'done', 8, now);
  insertVoter.run('Ramesh Singh', 40, 'UP5234569', 'Hira Singh', '9812349003', 'G-14, Gandhi Nagar', 'M', 5, 8, 'pending', null, null);
  insertVoter.run('Kamla Sharma', 28, 'UP5234570', 'Vinod Sharma', '9812349004', 'G-19, Gandhi Nagar', 'F', 5, 8, 'pending', null, null);
  insertVoter.run('Lokesh Rana', 19, 'UP5234571', 'Sohan Rana', '9812349005', 'G-25, Gandhi Nagar', 'M', 5, 8, 'pending', null, null);

  // Ward 6 voters (area_id=6, assigned to Neha=9)
  insertVoter.run('Deepika Joshi', 27, 'UP6234567', 'Girish Joshi', '9812350001', 'S-5, Subhash Chowk', 'F', 6, 9, 'done', 9, now);
  insertVoter.run('Tarun Rawat', 21, 'UP6234568', 'Satpal Rawat', '9812350002', 'S-10, Subhash Chowk', 'M', 6, 9, 'pending', null, null);
  insertVoter.run('Babita Devi', 36, 'UP6234569', 'Kishan Lal', '9812350003', 'S-18, Subhash Chowk', 'F', 6, 9, 'pending', null, null);
  insertVoter.run('Vinod Kumar', 29, 'UP6234570', 'Hari Kumar', '9812350004', 'S-24, Subhash Chowk', 'M', 6, 9, 'pending', null, null);
  insertVoter.run('Nisha Bisht', 33, 'UP6234571', 'Trilochan Bisht', '9812350005', 'S-30, Subhash Chowk', 'F', 6, 9, 'pending', null, null);

  // Sample notifications
  const adminId = 1;
  const insertNotif = db.prepare(
    'INSERT INTO notifications (title, message, sent_by, target_area_id) VALUES (?, ?, ?, ?)'
  );
  const n1 = insertNotif.run('Campaign Started! 🚀', 'All team members, please start visiting your assigned voters today. Our target is to cover 100% of eligible voters by election day!', adminId, null);
  const n2 = insertNotif.run('Ward 1 & 2 Priority', 'Please focus on Ward 1 and Ward 2 today. These areas have the highest concentration of eligible voters.', adminId, 1);
  const n3 = insertNotif.run('Evening Meeting at 6 PM', 'All field workers are requested to join the video call at 6 PM for a progress review. Link will be shared shortly.', adminId, null);

  // Add notifications to all field workers
  const workerIds = [4, 5, 6, 7, 8, 9, 10, 11, 12];
  const insertUserNotif = db.prepare('INSERT INTO user_notifications (user_id, notification_id, is_read) VALUES (?, ?, ?)');

  workerIds.forEach(wid => {
    insertUserNotif.run(wid, n1.lastInsertRowid, 0);
    insertUserNotif.run(wid, n3.lastInsertRowid, 0);
  });
  // Ward 1 notification for Ward 1 workers
  [4, 10, 11].forEach(wid => {
    insertUserNotif.run(wid, n2.lastInsertRowid, 1); // already read
  });

  // Mark some notifications as read
  db.prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id IN (4, 5) AND notification_id = ?').run(n1.lastInsertRowid);
  db.prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id = 4 AND notification_id = ?').run(n3.lastInsertRowid);

  // Activity logs
  const insertLog = db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)');
  insertLog.run(4, 'VOTER_STATUS', 'Marked Arun Kumar (UP1234567) as DONE');
  insertLog.run(4, 'VOTER_STATUS', 'Marked Sunita Devi (UP1234568) as DONE');
  insertLog.run(10, 'VOTER_STATUS', 'Marked Deependra Singh (UP1234569) as REFUSED');
  insertLog.run(5, 'VOTER_STATUS', 'Marked Meena Sharma (UP2234567) as DONE');
  insertLog.run(5, 'VOTER_STATUS', 'Marked Rohit Gupta (UP2234568) as DONE');
  insertLog.run(12, 'VOTER_STATUS', 'Marked Anita Bisht (UP2234569) as DONE');
  insertLog.run(12, 'VOTER_STATUS', 'Marked Suresh Negi (UP2234570) as REFUSED');
  insertLog.run(6, 'VOTER_STATUS', 'Marked Vikas Tiwari (UP3234567) as DONE');
  insertLog.run(6, 'VOTER_STATUS', 'Marked Geeta Rani (UP3234568) as DONE');
  insertLog.run(6, 'VOTER_STATUS', 'Marked Ashok Pandey (UP3234569) as REFUSED');
  insertLog.run(7, 'VOTER_STATUS', 'Marked Sonia Rawat (UP4234567) as DONE');
  insertLog.run(7, 'VOTER_STATUS', 'Marked Manoj Kumar (UP4234568) as DONE');
  insertLog.run(8, 'VOTER_STATUS', 'Marked Sunil Chauhan (UP5234567) as DONE');
  insertLog.run(8, 'VOTER_STATUS', 'Marked Anita Verma (UP5234568) as DONE');
  insertLog.run(9, 'VOTER_STATUS', 'Marked Deepika Joshi (UP6234567) as DONE');

  console.log('✅ Database seeded with sample data');
}

if (isNew) {
  createSchema();
  seedData();
} else {
  createSchema(); // Ensure schema exists (idempotent due to IF NOT EXISTS)
}

module.exports = db;
