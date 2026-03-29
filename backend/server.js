require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ─── Routes ──────────────────────────────────────────────────
app.use('/api/reports', require('./routes/reports'));
app.use('/api/map', require('./routes/map'));
app.use('/api/route', require('./routes/routing'));
app.use('/api/panic', require('./routes/panic'));
app.use('/api/stats', require('./routes/stats'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SafePath API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// ─── CRON: Run DBSCAN clustering every 15 minutes ────────────
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ Running DBSCAN clustering job...');
  try {
    const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:5001';
    const response = await axios.post(`${mlUrl}/ml/cluster`, {}, { timeout: 30000 });
    console.log('✅ Clustering job completed:', response.data.message);
  } catch (error) {
    console.error('❌ Clustering job failed:', error.message);
  }
});

// ─── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 SafePath API running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`⏰ DBSCAN clustering scheduled every 15 minutes\n`);
});

module.exports = app;
