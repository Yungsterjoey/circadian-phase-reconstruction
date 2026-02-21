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
    subject: 'Your KURO verification code',
    text: `Your KURO code: ${code}\n\nEnter this in KURO OS to continue. Expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\n— KURO OS · kuroglass.net`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>KURO OS — Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000000">
  <tr>
    <td align="center" style="padding:52px 20px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">

        <!-- Logo: 3D isometric glass cube + wordmark -->
        <tr>
          <td align="center" style="padding-bottom:36px">
            <svg width="54" height="54" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto 16px">
              <defs>
                <linearGradient id="kct" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#f3e8ff"/>
                  <stop offset="60%" stop-color="#c084fc"/>
                  <stop offset="100%" stop-color="#a855f7"/>
                </linearGradient>
                <linearGradient id="kcl" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#9333ea"/>
                  <stop offset="100%" stop-color="#3b0764"/>
                </linearGradient>
                <linearGradient id="kcr" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="#7c3aed"/>
                  <stop offset="100%" stop-color="#1e0a3c"/>
                </linearGradient>
              </defs>
              <!-- Cube faces -->
              <polygon points="28,4 52,16 28,28 4,16" fill="url(#kct)"/>
              <polygon points="4,16 28,28 28,52 4,40" fill="url(#kcl)"/>
              <polygon points="52,16 52,40 28,52 28,28" fill="url(#kcr)"/>
              <!-- Glass edge highlights -->
              <polyline points="28,4 52,16 52,40 28,52 4,40 4,16 28,4" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>
              <line x1="28" y1="28" x2="28" y2="52" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>
              <line x1="28" y1="4" x2="28" y2="28" stroke="rgba(255,255,255,0.22)" stroke-width="0.5"/>
              <line x1="4" y1="16" x2="52" y2="16" stroke="rgba(255,255,255,0.0)" stroke-width="0"/>
              <!-- Top-face specular catchlight -->
              <polygon points="28,4 52,16 28,28 4,16" fill="rgba(255,255,255,0.07)"/>
              <line x1="28" y1="4" x2="52" y2="16" stroke="rgba(255,255,255,0.45)" stroke-width="0.8"/>
              <line x1="28" y1="4" x2="4" y2="16" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>
            </svg>
            <div style="font-size:20px;font-weight:200;letter-spacing:10px;color:#ffffff;line-height:1;margin-bottom:3px">KURO<span style="color:#a855f7;font-weight:500;letter-spacing:4px;font-size:16px">.OS</span></div>
            <div style="font-size:9px;letter-spacing:4px;color:rgba(168,85,247,0.5);text-transform:uppercase;font-weight:500">Sovereign Intelligence</div>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#08080d;border:1px solid rgba(168,85,247,0.18);border-radius:22px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,0.8),0 32px 80px rgba(0,0,0,0.9)">

            <!-- Card header -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:linear-gradient(160deg,rgba(168,85,247,0.08) 0%,rgba(99,102,241,0.03) 100%);padding:30px 32px 24px;border-bottom:1px solid rgba(255,255,255,0.04)">
                  <p style="margin:0 0 8px;font-size:9px;letter-spacing:3.5px;text-transform:uppercase;color:rgba(168,85,247,0.6);font-weight:600">Verification Code</p>
                  <h1 style="margin:0 0 10px;font-size:24px;font-weight:300;color:#ffffff;letter-spacing:-0.5px;line-height:1.2">One-time code</h1>
                  <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.38);line-height:1.65">Enter this in KURO OS to continue. Expires in&nbsp;<span style="color:rgba(255,255,255,0.6);font-weight:500">10 minutes</span>.</p>
                </td>
              </tr>

              <!-- Code block -->
              <tr>
                <td style="padding:24px 32px">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background:#000000;border:1px solid rgba(168,85,247,0.22);border-radius:16px;padding:24px 12px;text-align:center">
                        <p style="margin:0 0 14px;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.18);font-weight:500">One-Time Code</p>
                        <p style="margin:0;font-family:'SF Mono','Cascadia Code','Menlo','Courier New',Courier,monospace;font-size:40px;font-weight:700;letter-spacing:16px;color:#ffffff;text-indent:16px;line-height:1">${code}</p>
                        <p style="margin:14px 0 0;font-size:11px;color:rgba(255,255,255,0.16)">Single use &middot; Do not share</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer note -->
              <tr>
                <td style="padding:0 32px 28px;border-top:1px solid rgba(255,255,255,0.04)">
                  <p style="margin:16px 0 0;font-size:12px;color:rgba(255,255,255,0.18);line-height:1.75">If you didn't request this code, you can safely ignore this email. KURO support will never ask you for this code.</p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:28px">
            <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.1);letter-spacing:0.5px">
              KURO OS &middot; <a href="https://kuroglass.net" style="color:rgba(168,85,247,0.35);text-decoration:none">kuroglass.net</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
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

  // Atomic increment + check (prevents race condition on concurrent requests)
  const updated = stmts.incrementOTPAttempt.run(otp.id);

  // Re-read after increment to get accurate attempt count
  const current = stmts.getActiveOTP.get(userId);
  if (!current || current.attempts > 5) {
    return { valid: false, error: 'Too many attempts. Request a new code.' };
  }

  if (otp.code !== code) {
    const remaining = Math.max(0, 5 - current.attempts);
    return { valid: false, error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
  }

  // Valid — mark used
  stmts.markOTPUsed.run(otp.id);
  return { valid: true };
}

module.exports = { sendOTP, verifyOTP, initTransport };
