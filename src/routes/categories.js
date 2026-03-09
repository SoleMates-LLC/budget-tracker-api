// src/routes/categories.js
// ─────────────────────────────────────────────────────────────────────────────
//  Category Routes  (all require JWT)
//
//  GET    /api/categories         — List all (system + user's custom)
//  POST   /api/categories         — Create a custom category
//  DELETE /api/categories/:id     — Delete a custom category (not system ones)
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router  = express.Router();

const db               = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ── GET /api/categories ───────────────────────────────────────────────────────
// Public — system categories are not sensitive. Custom categories are included
// when a valid JWT is present, otherwise only system categories are returned.
router.get('/', async (req, res, next) => {
  try {
    // Optionally include user's custom categories if authenticated
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, { issuer: 'budget-tracker-api' });
        userId = payload.sub;
      } catch { /* unauthenticated — return system categories only */ }
    }

    const { rows } = await db.query(
      `SELECT id, name, icon, color, is_system, sort_order
       FROM categories
       WHERE is_system = TRUE ${userId ? 'OR user_id = $1' : ''}
       ORDER BY is_system DESC, sort_order ASC, name ASC`,
      userId ? [userId] : []
    );
    res.json({ categories: rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/categories ──────────────────────────────────────────────────────
router.post('/', authenticate,
  [
    body('name').isString().trim().isLength({ min: 1, max: 50 }),
    body('icon').optional().isString().trim().isLength({ max: 10 }),
    body('color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { name, icon = '📦', color = '#8a93a8' } = req.body;

      const { rows } = await db.query(
        `INSERT INTO categories (user_id, name, icon, color, is_system)
         VALUES ($1, $2, $3, $4, FALSE)
         RETURNING *`,
        [req.user.id, name, icon, color]
      );

      res.status(201).json({ category: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/categories/:id ────────────────────────────────────────────────
router.delete('/:id', authenticate,
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      // Only allow deleting custom (non-system) categories owned by this user
      const { rowCount } = await db.query(
        `DELETE FROM categories WHERE id = $1 AND user_id = $2 AND is_system = FALSE`,
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Category not found or cannot be deleted' });
      }
      res.json({ message: 'Category deleted' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
