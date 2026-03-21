// src/index.js
// ─────────────────────────────────────────────────────────────────────────────
//  Budget Tracker API — Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const logger         = require('./config/logger');
const authRoutes      = require('./routes/auth');
const expenseRoutes   = require('./routes/expenses');
const budgetRoutes    = require('./routes/budgets');
const categoryRoutes  = require('./routes/categories');
const incomeRoutes    = require('./routes/income');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());   // Sets secure HTTP headers

// CORS — only allow configured origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,                    // 200 requests per window per IP
  standardHeaders: true,
  message: { error: 'TooManyRequests', message: 'Too many requests, slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,   // Strict limit on auth endpoints to prevent brute force
  message: { error: 'TooManyRequests', message: 'Too many auth attempts.' },
});

app.use(globalLimiter);

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));  // Reject huge payloads

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream: { write: (msg) => logger.http(msg.trim()) } }
));

// ── Health check — no auth required ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'budget-tracker-api',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/expenses',   expenseRoutes);
app.use('/api/budgets',    budgetRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/income',     incomeRoutes);

// ── 404 + Global error handler ────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Budget Tracker API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app; // For testing
