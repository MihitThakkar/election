require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, seedDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/areas', require('./routes/areas'));
app.use('/api/voters', require('./routes/voters'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/parts', require('./routes/parts'));

// Serve React frontend in production
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, error: err.message || 'Internal server error' });
});

async function start() {
  await initDatabase();
  await seedDatabase();

  app.listen(PORT, () => {
    console.log(`\n Election Manager running at http://localhost:${PORT}`);
    console.log(`  API: http://localhost:${PORT}/api`);
    console.log(`  Database: MySQL (${process.env.MYSQL_HOST || 'localhost'})`);
    console.log('\n  Login: 9999999001 / admin123\n');
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
