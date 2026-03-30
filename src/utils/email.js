// src/utils/email.js
// ─────────────────────────────────────────────────────────────────────────────
// Email sending via Resend HTTP API (https://resend.com).
// Railway blocks all outbound SMTP ports — Resend uses HTTPS instead.
//
// Required env var (set on Railway):
//   RESEND_API_KEY — from resend.com dashboard (starts with re_)
//   EMAIL_FROM     — verified sender (default: onboarding@resend.dev for testing)
//
// If RESEND_API_KEY is not set (local dev), emails are logged to console.
// ─────────────────────────────────────────────────────────────────────────────
const logger = require('../config/logger');

const RESEND_API = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  if (!apiKey) {
    logger.info(`[DEV EMAIL] To: ${to} | Subject: ${subject} | ${text}`);
    return;
  }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  logger.info(`Email sent via Resend to ${to}`);
}

// ── Verification email ────────────────────────────────────────────────────────
async function sendVerificationEmail(toEmail, code) {
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 16px;">
    <div style="background:#111118;border:1px solid #1e1e2e;border-radius:20px;padding:40px 32px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
        <div style="width:36px;height:36px;background:#1d1d2e;border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-weight:700;font-size:13px;">eIB</span>
        </div>
        <span style="color:#fff;font-weight:700;font-size:18px;">eIFB Budget Tracker</span>
      </div>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">Verify your email</h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.5;">
        Enter this code in the app to activate your account.
      </p>
      <div style="background:#0f1729;border:1px solid #1e3a6e;border-radius:14px;padding:28px;text-align:center;margin-bottom:28px;">
        <p style="color:#6b7280;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Verification Code</p>
        <span style="font-size:44px;font-weight:700;letter-spacing:14px;color:#2563eb;font-variant-numeric:tabular-nums;">${code}</span>
      </div>
      <p style="color:#4b5563;font-size:13px;line-height:1.6;margin:0;">
        This code expires in <strong style="color:#6b7280;">24 hours</strong>.
        If you didn't create an account, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: toEmail,
    subject: `${code} is your eIFB verification code`,
    html,
    text: `Your eIFB verification code is: ${code}\n\nThis code expires in 24 hours.\n\nIf you didn't create an account, ignore this email.`,
  });
}

// ── Password reset email ──────────────────────────────────────────────────────
async function sendPasswordResetEmail(toEmail, code) {
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 16px;">
    <div style="background:#111118;border:1px solid #1e1e2e;border-radius:20px;padding:40px 32px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
        <div style="width:36px;height:36px;background:#1d1d2e;border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-weight:700;font-size:13px;">eIB</span>
        </div>
        <span style="color:#fff;font-weight:700;font-size:18px;">eIFB Budget Tracker</span>
      </div>
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">Reset your password</h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.5;">
        Enter this code in the app to reset your password.
      </p>
      <div style="background:#1a0f0f;border:1px solid #6e1e1e;border-radius:14px;padding:28px;text-align:center;margin-bottom:28px;">
        <p style="color:#6b7280;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Reset Code</p>
        <span style="font-size:44px;font-weight:700;letter-spacing:14px;color:#ef4444;font-variant-numeric:tabular-nums;">${code}</span>
      </div>
      <p style="color:#4b5563;font-size:13px;line-height:1.6;margin:0;">
        This code expires in <strong style="color:#6b7280;">15 minutes</strong>.
        If you didn't request a password reset, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: toEmail,
    subject: `${code} is your eIFB password reset code`,
    html,
    text: `Your eIFB password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, ignore this email.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
