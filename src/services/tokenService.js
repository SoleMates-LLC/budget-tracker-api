// src/services/tokenService.js
// ─────────────────────────────────────────────────────────────────────────────
//  JWT + Refresh Token management
//
//  Access token:  short-lived JWT (30 days default), sent in Authorization header
//  Refresh token: long-lived opaque token stored hashed in DB, used to get new access tokens
// ─────────────────────────────────────────────────────────────────────────────
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../config/database');
const logger = require('../config/logger');

const ACCESS_TOKEN_EXPIRES  = process.env.JWT_EXPIRES_IN || '30d';
const REFRESH_TOKEN_EXPIRES = 90; // days

/**
 * Issues a signed access JWT for a user.
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      sub:   user.id,           // our internal UUID
      email: user.email,
      name:  user.full_name,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES,
      issuer:    'budget-tracker-api',
    }
  );
}

/**
 * Creates a refresh token, stores its hash in the DB, and returns the raw token.
 * The raw token is sent to the client; only the hash is stored server-side.
 */
async function generateRefreshToken(userId, deviceName = null) {
  const rawToken  = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_name, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, deviceName, expiresAt]
  );

  return rawToken;
}

/**
 * Validates a refresh token.
 * Returns the associated user_id if valid, throws otherwise.
 */
async function validateRefreshToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { rows } = await db.query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at  > NOW()`,
    [tokenHash]
  );

  if (rows.length === 0) {
    throw new Error('Invalid or expired refresh token');
  }

  return rows[0];
}

/**
 * Revokes a single refresh token (e.g. on logout from one device).
 */
async function revokeRefreshToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );
}

/**
 * Revokes ALL refresh tokens for a user (e.g. "sign out everywhere").
 */
async function revokeAllUserTokens(userId) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  logger.info('Revoked all tokens for user', { userId });
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
