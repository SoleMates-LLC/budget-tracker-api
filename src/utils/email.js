// src/utils/email.js
// ─────────────────────────────────────────────────────────────────────────────
// Email sending utility using nodemailer.
// Required env vars (set on Railway):
//   SMTP_HOST   — e.g. smtp.gmail.com or smtp.resend.com
//   SMTP_PORT   — 587 (TLS) or 465 (SSL)
//   SMTP_USER   — your sending account username
//   SMTP_PASS   — app password or API key
//   EMAIL_FROM  — e.g. "eIFB Budget <noreply@eifb.app>"
//
// If SMTP_HOST is not set (local dev), emails are logged to console instead.
// ─────────────────────────────────────────────────────────────────────────────
const dns = require('dns');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// Railway's network cannot reach IPv6 SMTP endpoints — force IPv4 for all DNS lookups
dns.setDefaultResultOrder('ipv4first');

function createTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendVerificationEmail(toEmail, code) {
  const from = process.env.EMAIL_FROM || 'eIFB Budget <noreply@eifb.app>';

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

  const transport = createTransport();
  if (!transport) {
    logger.info(`[DEV EMAIL] Verification code for ${toEmail}: ${code}`);
    return;
  }

  await transport.sendMail({
    from,
    to: toEmail,
    subject: `${code} is your eIFB verification code`,
    html,
    text: `Your eIFB verification code is: ${code}\n\nThis code expires in 24 hours.\n\nIf you didn't create an account, ignore this email.`,
  });

  logger.info(`Verification email sent to ${toEmail}`);
}

async function sendPasswordResetEmail(toEmail, code) {
  const from = process.env.EMAIL_FROM || 'eIFB Budget <noreply@eifb.app>';

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

  const transport = createTransport();
  if (!transport) {
    logger.info(`[DEV EMAIL] Password reset code for ${toEmail}: ${code}`);
    return;
  }

  await transport.sendMail({
    from,
    to: toEmail,
    subject: `${code} is your eIFB password reset code`,
    html,
    text: `Your eIFB password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, ignore this email.`,
  });

  logger.info(`Password reset email sent to ${toEmail}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
