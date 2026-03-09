// src/middleware/auth.js
// ─────────────────────────────────────────────────────────────────────────────
//  JWT Authentication Middleware
//  Attaches req.user = { id, email, name } on success.
//  Returns 401 on missing/invalid/expired tokens.
// ─────────────────────────────────────────────────────────────────────────────
const jwt    = require('jsonwebtoken');
const logger = require('../config/logger');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'budget-tracker-api',
    });

    req.user = {
      id:    payload.sub,
      email: payload.email,
      name:  payload.name,
    };

    next();
  } catch (err) {
    logger.debug('JWT verification failed', { error: err.message });

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'TokenExpired',
        message: 'Your session has expired. Please refresh your token.',
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token.',
    });
  }
}

module.exports = { authenticate };
