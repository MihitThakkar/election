const express = require('express');
const cors = require('cors');
const path = require('path');

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

// Serve React frontend in production
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Global error handler — catches any error thrown/passed in routes
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, error: err.message || 'Internal server error' });
});

const isDev = process.env.NODE_ENV !== 'production';
app.listen(PORT, () => {
  console.log(`\n Election Manager running at http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api`);
  if (isDev) {
    console.log('\n  Dev credentials — see README.md for details\n');
  }
});
