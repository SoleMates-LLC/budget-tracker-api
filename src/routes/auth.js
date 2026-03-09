// src/routes/auth.js
// ─────────────────────────────────────────────────────────────────────────────
//  Authentication Routes
//
//  POST /api/auth/apple      — Sign in / register with Apple identity token
//  POST /api/auth/refresh    — Exchange refresh token for new access token
//  POST /api/auth/logout     — Revoke current device's refresh token
//  POST /api/auth/logout-all — Revoke ALL refresh tokens (sign out everywhere)
//  GET  /api/auth/me         — Return current user profile
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, validationResult } = require('express-validator');
const router  = express.Router();

const db          = require('../config/database');
const logger      = require('../config/logger');
const { authenticate }           = require('../middleware/auth');
const { verifyAppleIdentityToken, parseAppleFullName } = require('../services/appleAuth');
const {
  generateAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} = require('../services/tokenService');

// ── POST /api/auth/dev-login ──────────────────────────────────────────────────
// Development only — creates a persistent dev user and returns real tokens.
// This endpoint is disabled in production.
router.post('/dev-login', async (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: 'NotFound' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO users (apple_user_id, email, full_name, last_login_at)
       VALUES ('dev-user', 'dev@eifb.app', 'Dev User', NOW())
       ON CONFLICT (apple_user_id) DO UPDATE SET last_login_at = NOW()
       RETURNING *`
    );
    const user = rows[0];
    await provisionDefaultBudgets(user.id);
    const accessToken  = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user.id, 'Dev Browser');
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email, full_name: user.full_name } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/apple ──────────────────────────────────────────────────────
// The iOS app sends:
//   { identityToken, authorizationCode, fullName: { givenName, familyName }, deviceName }
// We verify, upsert user, and return tokens.
router.post('/apple',
  [
    body('identityToken').notEmpty().withMessage('identityToken is required'),
    body('authorizationCode').notEmpty().withMessage('authorizationCode is required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'ValidationError', details: errors.array() });
    }

    try {
      const { identityToken, fullName, deviceName } = req.body;

      // 1. Verify Apple's identity token against their public keys
      const applePayload = await verifyAppleIdentityToken(identityToken);
      const appleUserId  = applePayload.sub;
      const email        = applePayload.email || null;
      const name         = parseAppleFullName(fullName);

      // 2. Upsert user — Apple only sends name/email on the VERY FIRST sign-in.
      //    On subsequent sign-ins, fullName and email may be null — don't overwrite.
      const { rows } = await db.query(
        `INSERT INTO users (apple_user_id, email, full_name, last_login_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (apple_user_id) DO UPDATE SET
           last_login_at = NOW(),
           -- Only update email/name if we received a non-null value from Apple
           email     = COALESCE(EXCLUDED.email,     users.email),
           full_name = COALESCE(EXCLUDED.full_name, users.full_name)
         RETURNING *`,
        [appleUserId, email, name]
      );

      const user = rows[0];
      logger.info('User signed in via Apple', { userId: user.id, isNew: !user.updated_at });

      // 3. Generate our own tokens
      const accessToken  = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id, deviceName || null);

      // 4. Provision default budgets for brand new users
      await provisionDefaultBudgets(user.id);

      res.json({
        accessToken,
        refreshToken,
        user: {
          id:        user.id,
          email:     user.email,
          full_name: user.full_name,
        },
      });
    } catch (err) {
      if (err.message.includes('identity token')) {
        return res.status(401).json({ error: 'Unauthorized', message: err.message });
      }
      next(err);
    }
  }
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh',
  [body('refreshToken').notEmpty()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'ValidationError', details: errors.array() });
    }

    try {
      const { refreshToken, deviceName } = req.body;

      // Validate the incoming refresh token
      const tokenRecord = await validateRefreshToken(refreshToken);

      // Fetch the user
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [tokenRecord.user_id]);
      if (rows.length === 0) throw new Error('User not found');
      const user = rows[0];

      // Rotate: revoke old token, issue a new one (prevents replay attacks)
      await revokeRefreshToken(refreshToken);
      const newAccessToken  = generateAccessToken(user);
      const newRefreshToken = await generateRefreshToken(user.id, deviceName || tokenRecord.device_name);

      res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    } catch (err) {
      if (err.message.includes('refresh token')) {
        return res.status(401).json({ error: 'Unauthorized', message: err.message });
      }
      next(err);
    }
  }
);

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await revokeRefreshToken(refreshToken);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await revokeAllUserTokens(req.user.id);
    res.json({ message: 'Signed out from all devices' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, full_name, created_at, last_login_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── Helper: provision default budgets for a new user ─────────────────────────
async function provisionDefaultBudgets(userId) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const defaults = [
    { name: 'Housing',       amount: 1500 },
    { name: 'Food & Dining', amount: 600  },
    { name: 'Transport',     amount: 300  },
    { name: 'Entertainment', amount: 200  },
    { name: 'Shopping',      amount: 400  },
    { name: 'Health',        amount: 150  },
    { name: 'Utilities',     amount: 200  },
    { name: 'Other',         amount: 200  },
  ];

  const { rows: cats } = await db.query(
    `SELECT id, name FROM categories WHERE is_system = TRUE`
  );

  for (const def of defaults) {
    const cat = cats.find(c => c.name === def.name);
    if (!cat) continue;

    await db.query(
      `INSERT INTO budgets (user_id, category_id, amount, year, month)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, category_id, year, month) DO NOTHING`,
      [userId, cat.id, def.amount, year, month]
    );
  }
}

module.exports = router;
