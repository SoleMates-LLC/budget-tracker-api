-- 007_debt_term.sql
ALTER TABLE debts ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS loan_term_months INTEGER;
