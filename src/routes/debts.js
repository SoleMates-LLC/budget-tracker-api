// src/routes/debts.js
// GET    /api/debts         — list all debts for the user
// POST   /api/debts         — create a debt
// PUT    /api/debts/:id     — update a debt (balance, payment, etc.)
// DELETE /api/debts/:id     — delete a debt

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── GET /api/debts ────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT d.*,
              r.name  AS recurring_name,
              r.amount AS recurring_amount
       FROM debts d
       LEFT JOIN recurring_expenses r ON r.id = d.linked_recurring_id
       WHERE d.user_id = $1
       ORDER BY d.current_balance DESC, d.created_at ASC`,
      [req.user.id]
    );
    res.json({ debts: rows });
  } catch (err) { next(err); }
});

// ── POST /api/debts ───────────────────────────────────────────────────────────
router.post('/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('current_balance').isFloat({ min: 0 }).withMessage('Balance must be 0 or greater'),
    body('original_balance').optional().isFloat({ min: 0 }),
    body('interest_rate').isFloat({ min: 0, max: 100 }).withMessage('Interest rate must be 0–100'),
    body('monthly_payment').isFloat({ min: 0 }).withMessage('Monthly payment must be 0 or greater'),
    body('extra_payment').optional().isFloat({ min: 0 }),
    body('debt_type').optional().isString(),
    body('start_date').optional({ nullable: true }).isISO8601(),
    body('loan_term_months').optional({ nullable: true }).isInt({ min: 1 }),
    body('linked_recurring_id').optional({ nullable: true }).isUUID(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const {
        name, current_balance, interest_rate, monthly_payment,
        extra_payment = 0, linked_recurring_id = null, debt_type = 'other',
        start_date = null, loan_term_months = null,
      } = req.body;
      // Default original_balance to current_balance if not provided
      const original_balance = req.body.original_balance ?? current_balance;

      const { rows } = await db.query(
        `INSERT INTO debts
           (user_id, name, debt_type, start_date, loan_term_months, original_balance, current_balance, interest_rate, monthly_payment, extra_payment, linked_recurring_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [req.user.id, name, debt_type, start_date || null, loan_term_months || null, original_balance, current_balance, interest_rate, monthly_payment, extra_payment, linked_recurring_id || null]
      );
      res.status(201).json({ debt: rows[0] });
    } catch (err) { next(err); }
  }
);

// ── PUT /api/debts/:id ────────────────────────────────────────────────────────
router.put('/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('current_balance').optional().isFloat({ min: 0 }),
    body('original_balance').optional().isFloat({ min: 0 }),
    body('interest_rate').optional().isFloat({ min: 0, max: 100 }),
    body('monthly_payment').optional().isFloat({ min: 0 }),
    body('extra_payment').optional().isFloat({ min: 0 }),
    body('debt_type').optional().isString(),
    body('start_date').optional({ nullable: true }).isISO8601(),
    body('loan_term_months').optional({ nullable: true }).isInt({ min: 1 }),
    body('linked_recurring_id').optional({ nullable: true }).isUUID(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { name, debt_type, start_date, loan_term_months, current_balance, original_balance, interest_rate, monthly_payment, extra_payment, linked_recurring_id } = req.body;
      const { rows, rowCount } = await db.query(
        `UPDATE debts SET
           name                = COALESCE($3, name),
           debt_type           = COALESCE($4, debt_type),
           start_date          = COALESCE($5, start_date),
           loan_term_months    = COALESCE($6, loan_term_months),
           current_balance     = COALESCE($7, current_balance),
           original_balance    = COALESCE($8, original_balance),
           interest_rate       = COALESCE($9, interest_rate),
           monthly_payment     = COALESCE($10, monthly_payment),
           extra_payment       = COALESCE($11, extra_payment),
           linked_recurring_id = COALESCE($12, linked_recurring_id),
           updated_at          = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [req.params.id, req.user.id, name, debt_type, start_date, loan_term_months, current_balance, original_balance, interest_rate, monthly_payment, extra_payment, linked_recurring_id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'NotFound' });
      res.json({ debt: rows[0] });
    } catch (err) { next(err); }
  }
);

// ── DELETE /api/debts/:id ─────────────────────────────────────────────────────
router.delete('/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const { rowCount } = await db.query(
        'DELETE FROM debts WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'NotFound' });
      res.json({ message: 'Deleted' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
