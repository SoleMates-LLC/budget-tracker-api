// src/routes/income.js
// GET  /api/income?year=&month=  — get monthly income for current user
// PUT  /api/income               — set monthly income for current user
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const router = express.Router();

const db           = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── GET /api/income ───────────────────────────────────────────────────────────
router.get('/',
  [
    query('year').isInt({ min: 2000, max: 2100 }).withMessage('Valid year required'),
    query('month').isInt({ min: 1, max: 12 }).withMessage('Valid month required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { year, month } = req.query;
      const { rows } = await db.query(
        'SELECT amount FROM monthly_income WHERE user_id = $1 AND year = $2 AND month = $3',
        [req.user.id, parseInt(year), parseInt(month)]
      );
      res.json({ income: rows[0] ? parseFloat(rows[0].amount) : 0 });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/income ───────────────────────────────────────────────────────────
router.put('/',
  [
    body('year').isInt({ min: 2000, max: 2100 }),
    body('month').isInt({ min: 1, max: 12 }),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { year, month, amount } = req.body;
      const { rows } = await db.query(
        `INSERT INTO monthly_income (user_id, year, month, amount, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, year, month)
         DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
         RETURNING amount`,
        [req.user.id, parseInt(year), parseInt(month), parseFloat(amount)]
      );
      res.json({ income: parseFloat(rows[0].amount) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
