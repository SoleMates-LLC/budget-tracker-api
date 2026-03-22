-- migrations/005_debts.sql
-- Debt tracking: balance, interest rate, payment info, optional link to recurring expense

CREATE TABLE IF NOT EXISTS debts (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT          NOT NULL,
  original_balance    NUMERIC(12,2) NOT NULL,          -- balance when first tracked (for progress %)
  current_balance     NUMERIC(12,2) NOT NULL,          -- current remaining balance
  interest_rate       NUMERIC(5,2)  NOT NULL DEFAULT 0, -- APR %
  monthly_payment     NUMERIC(10,2) NOT NULL DEFAULT 0, -- base monthly payment (or pulled from recurring)
  extra_payment       NUMERIC(10,2) NOT NULL DEFAULT 0, -- additional monthly payment on top
  linked_recurring_id UUID          REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS debts_user_id_idx ON debts(user_id);
