-- migrations/001_initial_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  Budget Tracker — Initial Database Schema
--  Run via: node migrations/run.js
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────────────────────────────────
-- Stores every user who has authenticated via Apple Sign In.
-- apple_user_id is Apple's stable `sub` claim from their identity token.
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  apple_user_id   TEXT        NOT NULL UNIQUE,   -- Apple's stable user identifier
  email           TEXT        UNIQUE,             -- May be null (user can hide email)
  full_name       TEXT,                           -- Provided only on first sign-in
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_apple_user_id ON users(apple_user_id);

-- ── Refresh Tokens ────────────────────────────────────────────────────────────
-- Stores long-lived refresh tokens so users stay logged in.
-- Each device gets its own token; revoke individually or all at once.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,   -- SHA-256 hash of the actual token
  device_name TEXT,                           -- e.g. "iPhone 15 Pro"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ                    -- NULL = active, set to revoke
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- ── Categories ────────────────────────────────────────────────────────────────
-- Seed data — the 8 built-in categories. Users cannot delete these but can
-- create custom ones (user_id will be set for custom categories).
CREATE TABLE IF NOT EXISTS categories (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID    REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system category
  name       TEXT    NOT NULL,
  icon       TEXT    NOT NULL DEFAULT '📦',
  color      TEXT    NOT NULL DEFAULT '#8a93a8',
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_system_name
  ON categories(name) WHERE is_system = TRUE;

-- Seed system categories
INSERT INTO categories (name, icon, color, is_system, sort_order) VALUES
  ('Housing',       '🏠', '#1a2744', TRUE, 1),
  ('Food & Dining', '🍽️', '#e87722', TRUE, 2),
  ('Transport',     '🚗', '#2980b9', TRUE, 3),
  ('Entertainment', '🎬', '#c9a84c', TRUE, 4),
  ('Shopping',      '🛍️', '#8e44ad', TRUE, 5),
  ('Health',        '💊', '#1e7d4b', TRUE, 6),
  ('Utilities',     '⚡', '#16a085', TRUE, 7),
  ('Other',         '📦', '#8a93a8', TRUE, 8)
ON CONFLICT DO NOTHING;

-- ── Budgets ───────────────────────────────────────────────────────────────────
-- One budget row per user per category per month.
-- year + month (1-12) uniquely identify a budget period.
CREATE TABLE IF NOT EXISTS budgets (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  UUID    NOT NULL REFERENCES categories(id),
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  year         SMALLINT       NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month        SMALLINT       NOT NULL CHECK (month BETWEEN 1 AND 12),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_user_year_month ON budgets(user_id, year, month);

-- ── Expenses ─────────────────────────────────────────────────────────────────
-- Core transaction table. Every expense belongs to a user and a category.
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  UUID    NOT NULL REFERENCES categories(id),
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  note         TEXT,
  expense_date DATE    NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_id   ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category  ON expenses(user_id, category_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
-- Automatically keeps updated_at current on any row update.
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── Useful views ─────────────────────────────────────────────────────────────
-- Monthly spending summary — makes the dashboard query simple.
CREATE OR REPLACE VIEW monthly_spending AS
SELECT
  e.user_id,
  EXTRACT(YEAR  FROM e.expense_date)::SMALLINT AS year,
  EXTRACT(MONTH FROM e.expense_date)::SMALLINT AS month,
  e.category_id,
  c.name  AS category_name,
  c.icon  AS category_icon,
  c.color AS category_color,
  SUM(e.amount)   AS total_spent,
  COUNT(e.id)     AS transaction_count
FROM expenses e
JOIN categories c ON c.id = e.category_id
GROUP BY e.user_id, year, month, e.category_id, c.name, c.icon, c.color;
