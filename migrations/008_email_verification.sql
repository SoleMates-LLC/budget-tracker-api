-- 008_email_verification.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token   TEXT,
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

-- Apple Sign In users are considered verified (Apple guarantees real emails)
UPDATE users SET email_verified = true WHERE apple_user_id IS NOT NULL;

-- Dev user is also verified
UPDATE users SET email_verified = true WHERE apple_user_id = 'dev-user';
