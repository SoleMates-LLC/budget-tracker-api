// src/routes/recurring.js
// GET    /api/recurring          — list recurring expenses
// POST   /api/recurring          — create recurring expense
// PUT    /api/recurring/:id      — update recurring expense
// DELETE /api/recurring/:id      — delete recurring expense
// POST   /api/recurring/:id/log  — log a payment (creates expense + advances due date)

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── GET /api/recurring ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM recurring_expenses r
       LEFT JOIN categories c ON c.id = r.category_id
       WHERE r.user_id = $1
       ORDER BY r.next_due_date ASC, r.name ASC`,
      [req.user.id]
    );
    res.json({ recurring: rows });
  } catch (err) { next(err); }
});

// ── POST /api/recurring ───────────────────────────────────────────────────────
router.post('/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
    body('category_id').optional({ nullable: true }).isUUID(),
    body('frequency').isIn(['weekly', 'monthly', 'yearly']).withMessage('Invalid frequency'),
    body('next_due_date').isISO8601().withMessage('Valid next_due_date required'),
    body('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { name, amount, category_id, frequency, next_due_date, note } = req.body;
      const { rows } = await db.query(
        `INSERT INTO recurring_expenses (user_id, name, amount, category_id, frequency, next_due_date, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.user.id, name, amount, category_id || null, frequency, next_due_date, note || null]
      );
      res.status(201).json({ recurring: rows[0] });
    } catch (err) { next(err); }
  }
);

// ── PUT /api/recurring/:id ────────────────────────────────────────────────────
router.put('/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('amount').optional().isFloat({ gt: 0 }),
    body('category_id').optional({ nullable: true }).isUUID(),
    body('frequency').optional().isIn(['weekly', 'monthly', 'yearly']),
    body('next_due_date').optional().isISO8601(),
    body('is_active').optional().isBoolean(),
    body('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { name, amount, category_id, frequency, next_due_date, is_active, note } = req.body;
      const { rows } = await db.query(
        `UPDATE recurring_expenses SET
           name          = COALESCE($3, name),
           amount        = COALESCE($4, amount),
           category_id   = COALESCE($5, category_id),
           frequency     = COALESCE($6, frequency),
           next_due_date = COALESCE($7, next_due_date),
           is_active     = COALESCE($8, is_active),
           note          = COALESCE($9, note),
           updated_at    = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [req.params.id, req.user.id, name, amount, category_id, frequency, next_due_date, is_active, note]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'NotFound' });
      res.json({ recurring: rows[0] });
    } catch (err) { next(err); }
  }
);

// ── DELETE /api/recurring/:id ─────────────────────────────────────────────────
router.delete('/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      await db.query(
        'DELETE FROM recurring_expenses WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      res.json({ message: 'Deleted' });
    } catch (err) { next(err); }
  }
);

// ── POST /api/recurring/:id/log ───────────────────────────────────────────────
// Creates an actual expense entry and advances the next_due_date.
router.post('/:id/log',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        'SELECT * FROM recurring_expenses WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'NotFound' });
      const rec = rows[0];

      // Create the expense for today
      const today = new Date().toISOString().slice(0, 10);
      const { rows: expRows } = await db.query(
        `INSERT INTO expenses (user_id, category_id, amount, note, expense_date)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.user.id, rec.category_id, rec.amount, rec.note || `${rec.name} (recurring)`, today]
      );

      // Advance next_due_date
      const nextDue = new Date(rec.next_due_date);
      if (rec.frequency === 'weekly')  nextDue.setDate(nextDue.getDate() + 7);
      if (rec.frequency === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
      if (rec.frequency === 'yearly')  nextDue.setFullYear(nextDue.getFullYear() + 1);

      await db.query(
        'UPDATE recurring_expenses SET next_due_date = $1, updated_at = NOW() WHERE id = $2',
        [nextDue.toISOString().slice(0, 10), rec.id]
      );

      res.json({ expense_id: expRows[0].id, next_due_date: nextDue.toISOString().slice(0, 10) });
    } catch (err) { next(err); }
  }
);

module.exports = router;
