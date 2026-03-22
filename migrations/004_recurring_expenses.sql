-- migrations/004_recurring_expenses.sql
-- Stores recurring/scheduled expenses (e.g. rent, subscriptions).

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT          NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  category_id    UUID          REFERENCES categories(id) ON DELETE SET NULL,
  frequency      TEXT          NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  next_due_date  DATE          NOT NULL,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  note           TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_expenses(user_id, is_active, next_due_date);
