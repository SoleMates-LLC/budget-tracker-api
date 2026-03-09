// src/routes/expenses.js
// ─────────────────────────────────────────────────────────────────────────────
//  Expense Routes  (all require JWT authentication)
//
//  GET    /api/expenses          — List expenses (filterable by year/month/category)
//  POST   /api/expenses          — Create a new expense
//  GET    /api/expenses/:id      — Get a single expense
//  PUT    /api/expenses/:id      — Update an expense
//  DELETE /api/expenses/:id      — Delete an expense
//  GET    /api/expenses/summary  — Monthly summary grouped by category
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const router  = express.Router();

const db             = require('../config/database');
const { authenticate } = require('../middleware/auth');

// All expense routes require a valid JWT
router.use(authenticate);

// ── GET /api/expenses ─────────────────────────────────────────────────────────
router.get('/',
  [
    query('year').optional().isInt({ min: 2000, max: 2100 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('category_id').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 200 }).default(100),
    query('offset').optional().isInt({ min: 0 }).default(0),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { year, month, category_id, limit, offset } = req.query;

      let whereClause = 'WHERE e.user_id = $1';
      const params = [req.user.id];
      let idx = 2;

      if (year) {
        whereClause += ` AND EXTRACT(YEAR FROM e.expense_date) = $${idx++}`;
        params.push(parseInt(year));
      }
      if (month) {
        whereClause += ` AND EXTRACT(MONTH FROM e.expense_date) = $${idx++}`;
        params.push(parseInt(month));
      }
      if (category_id) {
        whereClause += ` AND e.category_id = $${idx++}`;
        params.push(category_id);
      }

      const countResult = await db.query(
        `SELECT COUNT(*) FROM expenses e ${whereClause}`,
        params
      );

      const { rows } = await db.query(
        `SELECT
           e.id, e.amount, e.note, e.expense_date, e.created_at, e.updated_at,
           c.id    AS category_id,
           c.name  AS category_name,
           c.icon  AS category_icon,
           c.color AS category_color
         FROM expenses e
         JOIN categories c ON c.id = e.category_id
         ${whereClause}
         ORDER BY e.expense_date DESC, e.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(limit), parseInt(offset)]
      );

      res.json({
        expenses:    rows,
        total:       parseInt(countResult.rows[0].count),
        limit:       parseInt(limit),
        offset:      parseInt(offset),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/summary ─────────────────────────────────────────────────
// Returns monthly spend per category — used to power dashboard charts
router.get('/summary',
  [
    query('year').optional().isInt({ min: 2000, max: 2100 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { year, month } = req.query;
      const now = new Date();

      const targetYear  = parseInt(year  || now.getFullYear());
      const targetMonth = parseInt(month || now.getMonth() + 1);

      const { rows: monthlySpend } = await db.query(
        `SELECT * FROM monthly_spending
         WHERE user_id = $1 AND year = $2 AND month = $3`,
        [req.user.id, targetYear, targetMonth]
      );

      const { rows: budgets } = await db.query(
        `SELECT b.amount, b.category_id, c.name AS category_name
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.user_id = $1 AND b.year = $2 AND b.month = $3`,
        [req.user.id, targetYear, targetMonth]
      );

      // Merge spend + budget into one response
      const budgetMap = {};
      for (const b of budgets) budgetMap[b.category_id] = b.amount;

      const summary = monthlySpend.map(s => ({
        category_id:    s.category_id,
        category_name:  s.category_name,
        category_icon:  s.category_icon,
        category_color: s.category_color,
        total_spent:    parseFloat(s.total_spent),
        budget:         parseFloat(budgetMap[s.category_id] || 0),
        transaction_count: parseInt(s.transaction_count),
      }));

      const totalSpent  = summary.reduce((sum, s) => sum + s.total_spent, 0);
      const totalBudget = budgets.reduce((sum, b) => sum + parseFloat(b.amount), 0);

      res.json({
        year:         targetYear,
        month:        targetMonth,
        total_spent:  totalSpent,
        total_budget: totalBudget,
        by_category:  summary,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/expenses ────────────────────────────────────────────────────────
router.post('/',
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('category_id').isUUID().withMessage('Valid category_id is required'),
    body('expense_date').isISO8601().withMessage('expense_date must be a valid date (YYYY-MM-DD)'),
    body('note').optional().isString().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { amount, category_id, expense_date, note } = req.body;

      // Verify category exists
      const { rows: cats } = await db.query(
        `SELECT id FROM categories WHERE id = $1 AND (is_system = TRUE OR user_id = $2)`,
        [category_id, req.user.id]
      );
      if (cats.length === 0) return res.status(404).json({ error: 'Category not found' });

      const { rows } = await db.query(
        `INSERT INTO expenses (user_id, category_id, amount, note, expense_date)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING
           id, amount, note, expense_date, created_at,
           (SELECT name  FROM categories WHERE id = $2) AS category_name,
           (SELECT icon  FROM categories WHERE id = $2) AS category_icon,
           (SELECT color FROM categories WHERE id = $2) AS category_color`,
        [req.user.id, category_id, amount, note || null, expense_date]
      );

      res.status(201).json({ expense: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/:id ─────────────────────────────────────────────────────
router.get('/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
         FROM expenses e JOIN categories c ON c.id = e.category_id
         WHERE e.id = $1 AND e.user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
      res.json({ expense: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/expenses/:id ─────────────────────────────────────────────────────
router.put('/:id',
  [
    param('id').isUUID(),
    body('amount').optional().isFloat({ min: 0.01 }),
    body('category_id').optional().isUUID(),
    body('expense_date').optional().isISO8601(),
    body('note').optional().isString().trim().isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'ValidationError', details: errors.array() });

    try {
      const { amount, category_id, expense_date, note } = req.body;

      const { rows } = await db.query(
        `UPDATE expenses SET
           amount       = COALESCE($3, amount),
           category_id  = COALESCE($4, category_id),
           expense_date = COALESCE($5, expense_date),
           note         = COALESCE($6, note)
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [req.params.id, req.user.id, amount, category_id, expense_date, note]
      );

      if (rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
      res.json({ expense: rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────────
router.delete('/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM expenses WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Expense not found' });
      res.json({ message: 'Expense deleted' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
