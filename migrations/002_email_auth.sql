-- migrations/002_email_auth.sql
-- Adds email/password authentication support alongside Apple Sign In.

-- Make apple_user_id nullable so email-only users don't need it
ALTER TABLE users ALTER COLUMN apple_user_id DROP NOT NULL;

-- Add password hash column for email/password users
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Ensure email has a unique constraint (may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_email_key' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;
