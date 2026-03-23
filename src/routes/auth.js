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
const bcrypt  = require('bcrypt');
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

const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

const BCRYPT_ROUNDS = 12;

// Generate a random 6-digit verification code
function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('full_name').optional().trim(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'ValidationError', details: errors.array() });
    }
    try {
      const { email, password, full_name } = req.body;

      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Conflict', message: 'An account with this email already exists.' });
      }

      const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const code = generateVerificationCode();
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const { rows } = await db.query(
        `INSERT INTO users (email, full_name, password_hash, last_login_at, verification_token, verification_expires_at)
         VALUES ($1, $2, $3, NOW(), $4, $5) RETURNING *`,
        [email, full_name || null, password_hash, code, expires]
      );
      const user = rows[0];
      await provisionDefaultBudgets(user.id);

      // Send verification email (non-blocking — don't fail registration if email fails)
      sendVerificationEmail(email, code).catch(err =>
        logger.error('Failed to send verification email', { error: err.message })
      );

      const accessToken  = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id, req.body.deviceName || null);

      logger.info('New user registered via email', { userId: user.id });
      res.status(201).json({
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, full_name: user.full_name, email_verified: false },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'ValidationError', details: errors.array() });
    }
    try {
      const { email, password } = req.body;

      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];

      // Use constant-time comparison to prevent timing attacks
      const validPassword = user?.password_hash
        ? await bcrypt.compare(password, user.password_hash)
        : false;

      if (!user || !validPassword) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
      }

      await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      const accessToken  = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id, req.body.deviceName || null);

      logger.info('User signed in via email', { userId: user.id });
      res.json({
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, full_name: user.full_name, email_verified: user.email_verified },
      });
    } catch (err) {
      next(err);
    }
  }
);

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

// ── POST /api/auth/verify-email ───────────────────────────────────────────────
router.post('/verify-email',
  authenticate,
  [body('code').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('6-digit code required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { rows } = await db.query(
        'SELECT email_verified, verification_token, verification_expires_at FROM users WHERE id = $1',
        [req.user.id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.email_verified) return res.json({ message: 'Already verified' });

      if (!user.verification_token || !user.verification_expires_at) {
        return res.status(400).json({ error: 'NoCode', message: 'No verification code found. Please request a new one.' });
      }
      if (new Date() > new Date(user.verification_expires_at)) {
        return res.status(400).json({ error: 'CodeExpired', message: 'Code has expired. Please request a new one.' });
      }
      if (req.body.code !== user.verification_token) {
        return res.status(400).json({ error: 'InvalidCode', message: 'Incorrect code. Please try again.' });
      }

      await db.query(
        'UPDATE users SET email_verified = true, verification_token = NULL, verification_expires_at = NULL WHERE id = $1',
        [req.user.id]
      );

      logger.info('Email verified', { userId: req.user.id });
      res.json({ message: 'Email verified successfully' });
    } catch (err) { next(err); }
  }
);

// ── POST /api/auth/resend-verification ────────────────────────────────────────
router.post('/resend-verification', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.email_verified) return res.json({ message: 'Already verified' });

    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'UPDATE users SET verification_token = $1, verification_expires_at = $2 WHERE id = $3',
      [code, expires, req.user.id]
    );

    await sendVerificationEmail(user.email, code);
    logger.info('Verification email resent', { userId: req.user.id });
    res.json({ message: 'Verification email sent' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Public — takes an email, sends a 6-digit reset code (15 min expiry).
// Always responds 200 to avoid leaking whether the email exists.
router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email is required')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { email } = req.body;
      const { rows } = await db.query('SELECT id FROM users WHERE email = $1 AND password_hash IS NOT NULL', [email]);

      if (rows.length > 0) {
        const code    = generateVerificationCode();
        const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        await db.query(
          'UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2 WHERE id = $3',
          [code, expires, rows[0].id]
        );
        sendPasswordResetEmail(email, code).catch(err =>
          logger.error('Failed to send password reset email', { error: err.message })
        );
        logger.info('Password reset code generated', { userId: rows[0].id });
      }

      // Always 200 — don't reveal whether email exists
      res.json({ message: 'If an account with that email exists, a reset code has been sent.' });
    } catch (err) { next(err); }
  }
);

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
// Public — takes email + code + newPassword, validates, updates password.
router.post('/reset-password',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('code').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('6-digit code required'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { email, code, newPassword } = req.body;
      const { rows } = await db.query(
        'SELECT id, password_reset_token, password_reset_expires_at FROM users WHERE email = $1',
        [email]
      );
      const user = rows[0];

      if (!user || !user.password_reset_token) {
        return res.status(400).json({ error: 'InvalidCode', message: 'No reset was requested for this email.' });
      }
      if (new Date() > new Date(user.password_reset_expires_at)) {
        return res.status(400).json({ error: 'CodeExpired', message: 'Reset code has expired. Please request a new one.' });
      }
      if (code !== user.password_reset_token) {
        return res.status(400).json({ error: 'InvalidCode', message: 'Incorrect code. Please try again.' });
      }

      const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await db.query(
        'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = $2',
        [password_hash, user.id]
      );

      logger.info('Password reset successfully', { userId: user.id });
      res.json({ message: 'Password reset successfully. You can now sign in.' });
    } catch (err) { next(err); }
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, full_name, email_verified, created_at, last_login_at FROM users WHERE id = $1',
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
