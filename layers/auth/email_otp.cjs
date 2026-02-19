/**
 * KURO::EMAIL OTP v1.0
 * 6-digit OTP via Nodemailer SMTP (Brevo/Sendinblue relay)
 *
 * Rate limits:
 *   - Max 5 OTP sends per user per hour
 *   - Max 5 verification attempts per code (GPT-02)
 *   - IP-based rate limiting (10 OTP requests per IP per hour)
 */

const nodemailer = require('nodemailer');
const { stmts, genOTP } = require('./db.cjs');

// IP rate limiter (in-memory)
const ipOtpCounts = new Map();
const IP_OTP_LIMIT = 10;
const IP_WINDOW = 60 * 60 * 1000; // 1 hour

// Cleanup every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipOtpCounts) {
    if (now - entry.windowStart > IP_WINDOW) ipOtpCounts.delete(ip);
  }
}, 30 * 60 * 1000);

// SMTP transport — configured via env vars
// Set these in /etc/kuro/env or systemd environment:
//   SMTP_HOST=smtp-relay.brevo.com
//   SMTP_PORT=587
//   SMTP_USER=<your-brevo-login>
//   SMTP_PASS=<your-brevo-api-key>
//   SMTP_FROM=noreply@kuroglass.net

let transporter = null;

function initTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[OTP] SMTP not configured — OTP emails will be logged to console');
    return false;
  }

  transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100
  });

  transporter.verify().then(() => {
    console.log('[OTP] SMTP transport ready');
  }).catch(e => {
    console.error('[OTP] SMTP verify failed:', e.message);
    transporter = null;
  });

  return true;
}

initTransport();

/**
 * Send OTP to user
 * Returns: { success, code?, error? }
 */
async function sendOTP(userId, email, ip) {
  // IP rate limit
  const ipKey = ip || 'unknown';
  const now = Date.now();
  let ipEntry = ipOtpCounts.get(ipKey);
  if (!ipEntry || now - ipEntry.windowStart > IP_WINDOW) {
    ipEntry = { count: 0, windowStart: now };
    ipOtpCounts.set(ipKey, ipEntry);
  }
  if (ipEntry.count >= IP_OTP_LIMIT) {
    return { success: false, error: 'Too many OTP requests. Try again later.' };
  }

  // Per-user rate limit (5/hour)
  const recent = stmts.countRecentOTPs.get(userId);
  if (recent && recent.cnt >= 5) {
    return { success: false, error: 'Too many codes sent. Wait before requesting another.' };
  }

  const code = genOTP();
  stmts.createOTP.run(userId, code);
  ipEntry.count++;

  // Send email
  const mailOpts = {
    from: process.env.SMTP_FROM || '"KURO OS" <noreply@kuroglass.net>',
    to: email,
    subject: 'Your KURO access code',
    text: `Your code: ${code}\n\nEnter this in KURO OS to verify your identity.\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\n— KURO OS · kuroglass.net`,
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px 0">
        <div style="background:#09090b;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.08)">
          <div style="text-align:center;margin-bottom:24px">
            <div style="display:inline-block;width:40px;height:40px;background:linear-gradient(135deg,#9333ea,#6366f1);border-radius:10px;line-height:40px;color:#fff;font-weight:700;font-size:18px">K</div>
          </div>
          <p style="color:#fff;font-size:14px;margin:0 0 16px;text-align:center">Your verification code:</p>
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;text-align:center;margin-bottom:16px">
            <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#fff;font-family:monospace">${code}</span>
          </div>
          <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;text-align:center">Expires in 10 minutes</p>
        </div>
        <p style="color:rgba(255,255,255,0.25);font-size:11px;text-align:center;margin-top:16px">
          If you didn't request this, ignore this email.<br>
          KURO OS · kuroglass.net
        </p>
      </div>
    `
  };

  if (transporter) {
    try {
      await transporter.sendMail(mailOpts);
      console.log(`[OTP] Sent to ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
      return { success: true };
    } catch (e) {
      console.error('[OTP] Send failed:', e.message);
      return { success: false, error: 'Failed to send email. Try again.' };
    }
  } else {
    // Dev fallback — log to console
    console.log(`[OTP:DEV] Code for ${email}: ${code}`);
    return { success: true, devCode: process.env.NODE_ENV === 'development' ? code : undefined };
  }
}

/**
 * Verify OTP code
 * Returns: { valid, error? }
 */
function verifyOTP(userId, code) {
  const otp = stmts.getActiveOTP.get(userId);

  if (!otp) {
    return { valid: false, error: 'No active code. Request a new one.' };
  }

  // Increment attempt (GPT-02)
  stmts.incrementOTPAttempt.run(otp.id);

  if (otp.attempts >= 4) { // This is the 5th attempt
    return { valid: false, error: 'Too many attempts. Request a new code.' };
  }

  if (otp.code !== code) {
    const remaining = 4 - otp.attempts;
    return { valid: false, error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
  }

  // Valid — mark used
  stmts.markOTPUsed.run(otp.id);
  return { valid: true };
}

module.exports = { sendOTP, verifyOTP, initTransport };
