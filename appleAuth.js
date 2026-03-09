// src/services/appleAuth.js
// ─────────────────────────────────────────────────────────────────────────────
//  Apple Sign In — Token Verification
//
//  Flow:
//  1. iOS app calls ASAuthorizationAppleIDProvider and receives an identityToken (JWT)
//  2. App sends that identityToken to POST /api/auth/apple
//  3. This service fetches Apple's public keys and verifies the JWT signature
//  4. We extract the stable `sub` (Apple User ID), email, and name
//  5. We upsert the user in our DB and return our own JWT + refresh token
// ─────────────────────────────────────────────────────────────────────────────
const jwt      = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger   = require('../config/logger');

// Apple's public JWKS endpoint — keys rotate periodically
const client = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache:        true,
  cacheMaxAge:  10 * 60 * 1000, // cache for 10 minutes
  rateLimit:    true,
});

/**
 * Fetches the correct Apple public key for the given JWT header.
 */
function getApplePublicKey(header) {
  return new Promise((resolve, reject) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Verifies an Apple identity token and returns the decoded payload.
 *
 * @param {string} identityToken  — the raw JWT from ASAuthorizationAppleIDCredential
 * @returns {object}  decoded payload containing: sub, email, email_verified, iss, aud, exp
 * @throws  on invalid/expired token
 */
async function verifyAppleIdentityToken(identityToken) {
  // Decode header WITHOUT verification first — we need the kid to fetch the right key
  const decoded = jwt.decode(identityToken, { complete: true });

  if (!decoded || !decoded.header) {
    throw new Error('Invalid Apple identity token — could not decode header');
  }

  const publicKey = await getApplePublicKey(decoded.header);

  // Now fully verify: signature, expiry, issuer, audience
  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    issuer:     'https://appleid.apple.com',
    audience:   process.env.APPLE_CLIENT_ID,  // Must match your Bundle ID
  });

  logger.debug('Apple identity token verified', { sub: payload.sub });

  return payload;
}

/**
 * Parses the optional `fullName` object sent by Apple on first sign-in.
 * Apple only sends the name once — save it immediately.
 *
 * @param {object|null} fullName  — { givenName, familyName } or null
 * @returns {string|null}
 */
function parseAppleFullName(fullName) {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

module.exports = { verifyAppleIdentityToken, parseAppleFullName };
