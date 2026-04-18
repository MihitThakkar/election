const express = require('express');
const cors = require('cors');
const { initDatabase, seedDatabase } = require('../backend/db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize MySQL database (create tables + seed if empty)
let dbReady = false;
app.use(async (req, res, next) => {
  if (!dbReady) {
    try {
      await initDatabase();
      await seedDatabase();
      dbReady = true;
    } catch (err) {
      console.error('DB init error:', err);
      return res.status(500).json({ success: false, error: 'Database initialization failed' });
    }
  }
  next();
});

// API Routes
app.use('/api/auth', require('../backend/routes/auth'));
app.use('/api/users', require('../backend/routes/users'));
app.use('/api/areas', require('../backend/routes/areas'));
app.use('/api/voters', require('../backend/routes/voters'));
app.use('/api/dashboard', require('../backend/routes/dashboard'));
app.use('/api/notifications', require('../backend/routes/notifications'));
app.use('/api/videos', require('../backend/routes/videos'));
app.use('/api/parts', require('../backend/routes/parts'));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

module.exports = app;
