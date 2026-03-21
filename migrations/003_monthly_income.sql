-- migrations/003_monthly_income.sql
-- Stores monthly income per user, per month.

CREATE TABLE IF NOT EXISTS monthly_income (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year       INTEGER     NOT NULL,
  month      INTEGER     NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_income_user ON monthly_income(user_id, year, month);
