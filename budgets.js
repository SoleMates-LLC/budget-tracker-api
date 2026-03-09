// src/routes/budgets.js
// ─────────────────────────────────────────────────────────────────────────────
//  Budget Routes  (all require JWT authentication)
//
//  GET  /api/budgets           — Get all budgets for a given year/month
//  PUT  /api/budgets           — Bulk upsert budgets for a month
//  PUT  /api/budgets/:category_id — Update a single category budget
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const router  = express.Router();

const db               = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── GET /api/budgets ──────────────────────────────────────────────────────────
router.get('/',
  [
    query('year').optional().isInt({ min: 2000, max: 2100 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
  ],
  async (req, res, next) => {
    try {
      const now   = new Date();
      const year  = parseInt(req.query.year  || now.getFullYear());
      const month = parseInt(req.query.month || now.getMonth() + 1);

      const { rows } = await db.query(
        `SELECT
           b.id, b.amount, b.year, b.month, b.updated_at,
           c.id    AS category_id,
           c.name  AS category_name,
           c.icon  AS category_icon,
           c.color AS category_color
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.user_id = $1 AND b.year = $2 AND b.month = $3
         ORDER BY c.sort_order`,
        [req.user.id, year, month]
      );

      const total = rows.reduce((sum, b) => sum + parseFloat(b.amount), 0);

      res.json({ year, month, budgets: rows, total_budget: total });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/budgets — bulk upsert ────────────────────────────────────────────
// Body: { year, month, budgets: [{ category_id, amount }] }
router.put('/',
  [
    body('year').isInt({ min: 2000, max: 2100 }),
    body('month').isInt({ min: 1, max: 12 }),
    body('budgets').isArray({ min: 1 }),
    body('budgets.*.category_id').isUUID(),
    body('budgets.*.amount').isFloat({ min: 0 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { year, month, budgets } = req.body;

      const updated = await db.transaction(async (client) => {
        const results = [];
        for (const { category_id, amount } of budgets) {
          const { rows } = await client.query(
            `INSERT INTO budgets (user_id, category_id, amount, year, month)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, category_id, year, month)
             DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
             RETURNING *`,
            [req.user.id, category_id, amount, year, month]
          );
          results.push(rows[0]);
        }
        return results;
      });

      res.json({ year, month, budgets: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/budgets/:category_id — single budget ─────────────────────────────
router.put('/:category_id',
  [
    param('category_id').isUUID(),
    body('amount').isFloat({ min: 0 }),
    body('year').isInt({ min: 2000, max: 2100 }),
    body('month').isInt({ min: 1, max: 12 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { amount, year, month } = req.body;

      const { rows } = await db.query(
        `INSERT INTO budgets (user_id, category_id, amount, year, month)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, category_id, year, month)
         DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
         RETURNING *`,
        [req.user.id, req.params.category_id, amount, year, month]
      );

      res.json({ budget: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
