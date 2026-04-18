/**
 * Vercel-compatible SQLite shim.
 *
 * Replaces `better-sqlite3` (native C++ addon) with `sql.js` (pure WASM)
 * and patches the Node module cache so that `require('../db')` and
 * `require('../helpers')` from any backend route file return the
 * sql.js-backed objects instead.
 */
const initSqlJs = require('sql.js');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const DB_PATH = '/tmp/election.db';

let rawDb = null;
let wrapped = null;
let ready = false;

function save() {
  if (!rawDb) return;
  try {
    const data = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch {}
}

/**
 * Wraps sql.js to expose a better-sqlite3-compatible API so every existing
 * route file works without modification.
 */
function createWrapper(sqlDb) {
  let inTransaction = false;

  const w = {
    prepare(sql) {
      return {
        all(...params) {
          const stmt = sqlDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          const results = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        },
        get(...params) {
          const stmt = sqlDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        run(...params) {
          if (params.length > 0) {
            sqlDb.run(sql, params);
          } else {
            sqlDb.run(sql);
          }
          const changes = sqlDb.getRowsModified();
          const lastId = sqlDb.exec('SELECT last_insert_rowid() as id');
          const lastInsertRowid = lastId.length > 0 ? lastId[0].values[0][0] : 0;
          if (!inTransaction) save();
          return { changes, lastInsertRowid };
        },
      };
    },
    exec(sql) {
      sqlDb.exec(sql);
      if (!inTransaction) save();
    },
    pragma() {},
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        sqlDb.exec('BEGIN TRANSACTION');
        try {
          const result = fn(...args);
          sqlDb.exec('COMMIT');
          inTransaction = false;
          save();
          return result;
        } catch (e) {
          try { sqlDb.exec('ROLLBACK'); } catch (_) {}
          inTransaction = false;
          throw e;
        }
      };
    },
  };
  return w;
}

async function init() {
  if (ready) return wrapped;

  // Locate the WASM binary explicitly for Vercel's bundled filesystem
  const wasmPath = path.join(
    path.dirname(require.resolve('sql.js')),
    'sql-wasm.wasm'
  );
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  wrapped = createWrapper(rawDb);

  // Create schema
  wrapped.exec(`
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
      gender TEXT,
      area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'refused')),
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      marked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
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

  // Seed if empty — only admin users, areas, and real voter data from PDF
  const count = wrapped.prepare('SELECT COUNT(*) as count FROM users').get();
  if (!count || count.count === 0) {
    const adminPass = bcrypt.hashSync('admin123', 10);
    const workerPass = bcrypt.hashSync('worker123', 10);

    const insertArea = wrapped.prepare('INSERT INTO areas (name, district) VALUES (?, ?)');
    [
      ['Ward 1 - Sadar Bazaar', 'Dehradun'],
      ['Ward 2 - Civil Lines', 'Dehradun'],
      ['Ward 3 - Rajpur Road', 'Dehradun'],
      ['Ward 4 - Nehru Colony', 'Dehradun'],
      ['Ward 5 - Gandhi Nagar', 'Dehradun'],
      ['Ward 6 - Subhash Chowk', 'Dehradun'],
      ['Ward 7 - Lal Darwaza', 'Hardwar'],
      ['Ward 8 - Ram Nagar', 'Nainital'],
    ].forEach(([n, d]) => insertArea.run(n, d));

    const insertUser = wrapped.prepare(
      'INSERT INTO users (name, phone, password, role, area_id, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertUser.run('Rajesh Kumar', '9999999001', adminPass, 'super_admin', null, null);
    insertUser.run('Sunil Sharma', '9999999002', adminPass, 'super_admin', null, null);
    insertUser.run('Priya Verma', '9999999003', adminPass, 'super_admin', null, null);
    insertUser.run('Amit Singh', '8888888001', workerPass, 'field_worker', 1, null);
    insertUser.run('Deepak Yadav', '8888888002', workerPass, 'field_worker', 2, null);
    insertUser.run('Ravi Tiwari', '8888888003', workerPass, 'field_worker', 3, null);
    insertUser.run('Pooja Gupta', '8888888004', workerPass, 'field_worker', 4, null);
    insertUser.run('Manoj Pandey', '8888888005', workerPass, 'field_worker', 5, null);
    insertUser.run('Neha Rawat', '8888888006', workerPass, 'field_worker', 6, null);
    insertUser.run('Rahul Chauhan', '7777777001', workerPass, 'field_worker', 1, 4);
    insertUser.run('Vikram Joshi', '7777777002', workerPass, 'field_worker', 1, 4);
    insertUser.run('Sanjay Negi', '7777777003', workerPass, 'field_worker', 2, 5);

    // Load real voter data extracted from PDF
    const voterData = require('./voter-data.json');
    const insertVoter = wrapped.prepare(
      'INSERT OR IGNORE INTO voters (name, age, voter_id, father_name, phone, address, gender, area_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const v of voterData) {
      if (v.name && v.name.length >= 2) {
        insertVoter.run(
          v.name, v.age || null, v.voter_id || null,
          v.father_name || null, null, v.address || null,
          v.gender || null, 1 // assign to Ward 1 by default
        );
      }
    }

    console.log(`Database seeded: ${voterData.length} voters from PDF`);
  }

  // Patch the module cache using explicit paths (not require.resolve, which
  // would execute db.js and fail on missing better-sqlite3).
  const dbModulePath = path.resolve(__dirname, '../../backend/db.js');
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: wrapped,
  };

  // Patch helpers.js — it imports db at top level, so clear and re-require
  const helpersPath = path.resolve(__dirname, '../../backend/helpers.js');
  delete require.cache[helpersPath];
  require(helpersPath);

  ready = true;
  return wrapped;
}

// Initialize synchronously isn't possible with sql.js (async WASM init).
// We'll use a middleware approach — the api/index.js wraps requests.
module.exports = { init };
