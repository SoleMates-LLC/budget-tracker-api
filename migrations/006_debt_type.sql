-- 006_debt_type.sql
ALTER TABLE debts ADD COLUMN IF NOT EXISTS debt_type TEXT NOT NULL DEFAULT 'other';
