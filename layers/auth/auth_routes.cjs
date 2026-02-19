/**
 * KURO::AUTH Routes v2.0
 * Signup, login, logout, email verification, Google OAuth, GitHub OAuth, password reset
 *
 * RT-01: OAuth state CSRF protection (crypto.randomBytes, 5min TTL)
 * RT-02: GitHub email trust (only verified: true)
 * RT-03: Account linking collision (require password to link)
 * RT-05: Password reset flow
 * RT-09: Free tier abuse detection (IP fingerprinting)
 * RT-11: Rate limit on OAuth initiation
 */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const https = require('https');
const { db, stmts, genId, genSessionId, genOTP } = require('./db.cjs');
const { sendOTP, verifyOTP } = require('./email_otp.cjs');

let OAuth2Client;
try { ({ OAuth2Client } = require('google-auth-library')); } catch(e) { OAuth2Client = null; }

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION = '+24 hours';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax', // lax for OAuth redirects (strict blocks cross-origin redirects)
  path: '/',
  maxAge: 24 * 60 * 60 * 1000
};

// ═══ Rate limiting ═══
const authAttempts = new Map();
const AUTH_RATE_LIMIT = 20;
const AUTH_WINDOW = 60 * 60 * 1000;

function checkAuthRate(ip) {
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now - entry.start > AUTH_WINDOW) {
    entry = { count: 0, start: now };
    authAttempts.set(ip, entry);
  }
  entry.count++;
  return entry.count <= AUTH_RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now - entry.start > AUTH_WINDOW) authAttempts.delete(ip);
  }
}, 15 * 60 * 1000);

// ═══ RT-01: OAuth state store ═══
const oauthStates = new Map();
const STATE_TTL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates) {
    if (now - data.created > STATE_TTL) oauthStates.delete(state);
  }
}, 60 * 1000);

function generateState(provider) {
  const state = crypto.randomBytes(32).toString('hex');
  oauthStates.set(state, { provider, created: Date.now() });
  return state;
}

function verifyState(state, provider) {
  const data = oauthStates.get(state);
  if (!data) return false;
  if (data.provider !== provider) return false;
  if (Date.now() - data.created > STATE_TTL) { oauthStates.delete(state); return false; }
  oauthStates.delete(state); // one-time use
  return true;
}

// ═══ Helpers ═══
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function setSessionCookie(res, sessionId) {
  res.cookie('kuro_sid', sessionId, COOKIE_OPTS);
}

function createSession(userId, req) {
  const sid = genSessionId();
  const ip = getIP(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 256);
  stmts.createSession.run(sid, userId, SESSION_DURATION, ip, ua);
  stmts.touchLogin.run(userId);
  return sid;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

// ═══ HTTPS JSON fetch helper (for GitHub API) ═══
function httpsJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KURO-OS/7.0',
        ...(options.headers || {})
      }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ═══ OAuth: find or create user ═══
function findOrCreateOAuthUser(provider, providerId, email, name, avatarUrl) {
  // Check if OAuth account already linked
  const existing = stmts.getOAuthAccount.get(provider, providerId);
  if (existing) {
    const user = stmts.getUserById.get(existing.user_id);
    return { user, isNew: false, linked: true };
  }

  // Check if email matches existing user
  const emailUser = stmts.getUserByEmail.get(email.toLowerCase().trim());
  if (emailUser) {
    // RT-03: Don't auto-link. Return the user but flag needsLinking
    return { user: emailUser, isNew: false, linked: false, needsLinking: true };
  }

  // Create new user (no password — OAuth only)
  const userId = genId();
  const user = stmts.createOAuthUser.get(userId, email.toLowerCase().trim(), name || null);

  // Link OAuth account
  stmts.createOAuthAccount.run(genId(), userId, provider, providerId, email, name || null, avatarUrl || null);

  return { user, isNew: true, linked: true };
}

// ═══ ACCESS TOKEN GENERATION ═══
const fs = require('fs');
const path = require('path');

function generateAccessToken() {
  // KURO-XXXX-XXXX-XXXX-XXXX format (4 groups of 4 uppercase alphanumeric)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  );
  return `KURO-${groups.join('-')}`;
}

async function storeAccessToken(userId, tier = 'free') {
  const token = generateAccessToken();
  // Store in kuro_tokens
  try {
    stmts.createKuroToken.run(token, userId, tier);
  } catch(e) {
    // If table not ready, try raw
    db.prepare('INSERT OR IGNORE INTO kuro_tokens (token, user_id, tier) VALUES (?, ?, ?)').run(token, userId, tier);
  }
  return token;
}

async function sendAccessTokenEmail(email, name, token) {
  const nodemailer = require('nodemailer');

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || '"KURO OS" <noreply@kuroglass.net>';

  const displayName = name || email.split('@')[0];

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050508;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:480px;margin:40px auto;padding:0 16px">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px">
      <div style="display:inline-flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;background:linear-gradient(135deg,#9333ea,#6366f1);border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-weight:800;font-size:14px">K</span>
        </div>
        <span style="color:#fff;font-size:18px;font-weight:300;letter-spacing:6px">KURO</span>
        <span style="color:#a855f7;font-size:14px;font-weight:500;letter-spacing:3px">.OS</span>
      </div>
    </div>

    <!-- Card -->
    <div style="background:rgba(18,18,22,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.6)">
      <p style="color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px">Sovereign Intelligence Platform</p>

      <h1 style="color:#fff;font-size:22px;font-weight:300;margin:0 0 8px;letter-spacing:-0.3px">Welcome, ${displayName}</h1>
      <p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0 0 28px;line-height:1.6">Your KURO account is ready. Use the access token below to activate it.</p>

      <!-- Token display -->
      <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(168,85,247,0.2);border-radius:14px;padding:20px 16px;text-align:center;margin-bottom:24px">
        <p style="color:rgba(255,255,255,0.3);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px">Access Token</p>
        <div style="font-family:'SF Mono','Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:#fff;word-break:break-all">
          ${token}
        </div>
        <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:12px 0 0">Copy this exactly — it is case sensitive</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="https://kuroglass.net/app" style="display:inline-block;background:linear-gradient(135deg,rgba(147,51,234,0.9),rgba(91,33,182,0.9));color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:14px;font-weight:600;letter-spacing:0.3px">
          Launch KURO &#x2192;
        </a>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:20px">
        <p style="color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;margin:0">
          In KURO OS, click <strong style="color:rgba(255,255,255,0.4)">Sign In &#x2192; Have an access token?</strong> and enter the token above. If you did not create this account, you can ignore this email.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <p style="text-align:center;color:rgba(255,255,255,0.15);font-size:11px;margin-top:24px">
      KURO OS &middot; kuroglass.net
    </p>
  </div>
</body>
</html>`;

  const text = `Welcome to KURO OS\n\nYour access token: ${token}\n\nOpen KURO OS at https://kuroglass.net/app\nClick "Sign In -> Have an access token?" and enter the token above.\n\nKURO OS · kuroglass.net`;

  if (!host || !user || !pass) {
    // No SMTP configured — return token directly so UI can display it
    console.log(`[ACCESS TOKEN:NO-SMTP] Token for ${email}: ${token}`);
    return { success: true, noSmtp: true, devToken: token };
  }

  try {
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, auth: { user, pass }
    });
    await transport.sendMail({
      from,
      to: email,
      subject: `Your KURO access token`,
      text,
      html
    });
    console.log(`[ACCESS TOKEN] Sent to ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
    return { success: true };
  } catch(e) {
    console.error('[ACCESS TOKEN] Send failed:', e.message);
    return { success: false, error: 'Failed to send email' };
  }
}

// ═══════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════

function createAuthRoutes(authMiddleware) {
  const router = express.Router();
  const auth = authMiddleware || { optional: (q,s,n)=>n(), required: (q,s,n)=>n() };

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
  const BASE_URL = process.env.KURO_URL || 'https://kuroglass.net';

  // ─── SIGNUP ──────────────────────────────────────────
  router.post('/signup', async (req, res) => {
    try {
      const ip = getIP(req);
      if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });
      const { email, password, name } = req.body;
      if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
      if (!password || !isValidPassword(password)) return res.status(400).json({ error: 'Password must be 8-128 characters' });

      const existing = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: 'Email already registered', hint: 'Try logging in instead' });

      const userId = genId();
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      stmts.createUser.get(userId, email.toLowerCase().trim(), name || null, hash);
      const accessToken = await storeAccessToken(userId, 'free');
      const tokenResult = await sendAccessTokenEmail(email.toLowerCase().trim(), name, accessToken);
      // Don't create session yet — user must activate with token

      res.status(201).json({
        success: true,
        tokenSent: tokenResult.success,
        devToken: tokenResult.devToken, // only in dev
        message: 'Account created. Check your email for your access token.'
      });
    } catch (e) {
      console.error('[AUTH] Signup error:', e.message);
      if (e.message?.includes('UNIQUE constraint')) return res.status(409).json({ error: 'Email already registered' });
      res.status(500).json({ error: 'Signup failed' });
    }
  });

  // ─── LOGIN ───────────────────────────────────────────
  router.post('/login', async (req, res) => {
    try {
      const ip = getIP(req);
      if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
      if (!user || !user.password_hash) {
        await bcrypt.hash('dummy', BCRYPT_ROUNDS); // timing-safe
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

      // Auto-promote admin on login if KURO_ADMIN_EMAIL matches
      const adminEmail = process.env.KURO_ADMIN_EMAIL;
      if (adminEmail && user.email === adminEmail.toLowerCase().trim() && !user.is_admin) {
        try { db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id); } catch(e) {}
      }

      const sid = createSession(user.id, req);
      setSessionCookie(res, sid);
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, emailVerified: !!user.email_verified } });
    } catch (e) {
      console.error('[AUTH] Login error:', e.message);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ─── LOGOUT ──────────────────────────────────────────
  router.post('/logout', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (sid) stmts.deleteSession.run(sid);
    res.clearCookie('kuro_sid', COOKIE_OPTS);
    res.json({ success: true });
  });

  // ─── VERIFY EMAIL (OTP) ──────────────────────────────
  router.post('/verify-email', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.status(401).json({ error: 'Not logged in' });
    const session = stmts.getSession.get(sid);
    if (!session) return res.status(401).json({ error: 'Session expired' });
    const { code } = req.body;
    if (!code || typeof code !== 'string' || code.length !== 6) return res.status(400).json({ error: 'Enter a 6-digit code' });
    const result = verifyOTP(session.user_id, code.trim());
    if (!result.valid) return res.status(400).json({ error: result.error });
    stmts.verifyEmail.run(session.user_id);
    res.json({ success: true, emailVerified: true });
  });

  // ─── RESEND OTP ──────────────────────────────────────
  router.post('/resend-otp', async (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.status(401).json({ error: 'Not logged in' });
    const session = stmts.getSession.get(sid);
    if (!session) return res.status(401).json({ error: 'Session expired' });
    if (session.email_verified) return res.json({ success: true, message: 'Email already verified' });
    const ip = getIP(req);
    const result = await sendOTP(session.user_id, session.email, ip);
    if (!result.success) return res.status(429).json({ error: result.error });
    res.json({ success: true, message: 'New code sent', devCode: result.devCode });
  });

  // ─── FORGOT PASSWORD (RT-05) ─────────────────────────
  router.post('/forgot-password', async (req, res) => {
    const ip = getIP(req);
    if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests' });
    const { email } = req.body;
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });

    const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'If that email exists, a code was sent' });

    const result = await sendOTP(user.id, user.email, ip);
    res.json({ success: true, message: 'If that email exists, a code was sent', devCode: result.devCode });
  });

  // ─── RESET PASSWORD (RT-05) ──────────────────────────
  router.post('/reset-password', async (req, res) => {
    const ip = getIP(req);
    if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests' });
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code, and new password required' });
    if (!isValidPassword(newPassword)) return res.status(400).json({ error: 'Password must be 8-128 characters' });

    const user = stmts.getUserByEmail.get(email.toLowerCase().trim());
    if (!user) return res.status(400).json({ error: 'Invalid code' }); // Don't reveal email existence

    const otpResult = verifyOTP(user.id, code.trim());
    if (!otpResult.valid) return res.status(400).json({ error: otpResult.error || 'Invalid code' });

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    stmts.updatePassword.run(hash, user.id);
    // Revoke all sessions for security
    stmts.deleteUserSessions.run(user.id);

    res.json({ success: true, message: 'Password reset. Please sign in.' });
  });

  // ─── GOOGLE OAUTH (RT-01, RT-02) ────────────────────
  router.get('/google', (req, res) => {
    const ip = getIP(req);
    if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests' });
    if (!GOOGLE_CLIENT_ID) return res.redirect('/app?auth=error&reason=oauth_not_configured&provider=google');

    const state = generateState('google');
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${BASE_URL}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account'
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  router.get('/google/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect('/app?auth=error&reason=google_denied');
      if (!state || !verifyState(state, 'google')) return res.redirect('/app?auth=error&reason=invalid_state');
      if (!code) return res.redirect('/app?auth=error&reason=no_code');

      // Exchange code for tokens
      const tokenResp = await httpsJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${BASE_URL}/api/auth/google/callback`,
          grant_type: 'authorization_code'
        }).toString()
      });

      if (!tokenResp.id_token) return res.redirect('/app?auth=error&reason=no_token');

      // Verify ID token
      let payload;
      if (OAuth2Client) {
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({ idToken: tokenResp.id_token, audience: GOOGLE_CLIENT_ID });
        payload = ticket.getPayload();
      } else {
        // SECURITY: Cannot verify Google JWT signature without google-auth-library — reject
        console.error('[AUTH] google-auth-library not installed — cannot verify Google OAuth tokens');
        return res.redirect('/app?auth=error&reason=oauth_verification_unavailable');
      }

      if (!payload.email_verified) return res.redirect('/app?auth=error&reason=email_not_verified');

      const result = findOrCreateOAuthUser('google', payload.sub, payload.email, payload.name, payload.picture);

      if (result.needsLinking) {
        // RT-03: Need password confirmation to link
        // Store pending link in session, redirect to link confirmation
        const pendingState = crypto.randomBytes(16).toString('hex');
        oauthStates.set(`link_${pendingState}`, {
          provider: 'google', providerId: payload.sub, email: payload.email,
          name: payload.name, avatar: payload.picture, userId: result.user.id,
          created: Date.now()
        });
        return res.redirect(`/app?auth=link&provider=google&state=${pendingState}`);
      }

      const sid = createSession(result.user.id, req);
      setSessionCookie(res, sid);
      res.redirect('/app?auth=success');
    } catch (e) {
      console.error('[AUTH] Google callback error:', e.message);
      res.redirect('/app?auth=error&reason=server_error');
    }
  });

  // ─── GITHUB OAUTH (RT-01, RT-02) ────────────────────
  router.get('/github', (req, res) => {
    const ip = getIP(req);
    if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests' });
    if (!GITHUB_CLIENT_ID) return res.redirect('/app?auth=error&reason=oauth_not_configured&provider=github');

    const state = generateState('github');
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: `${BASE_URL}/api/auth/github/callback`,
      scope: 'user:email',
      state
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/github/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect('/app?auth=error&reason=github_denied');
      if (!state || !verifyState(state, 'github')) return res.redirect('/app?auth=error&reason=invalid_state');
      if (!code) return res.redirect('/app?auth=error&reason=no_code');

      // Exchange code for access token
      const tokenResp = await httpsJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${BASE_URL}/api/auth/github/callback`
        })
      });

      if (!tokenResp.access_token) return res.redirect('/app?auth=error&reason=no_token');

      const accessToken = tokenResp.access_token;

      // Fetch user profile
      const ghUser = await httpsJson('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      // Fetch emails - RT-02: Only trust verified emails
      const ghEmails = await httpsJson('https://api.github.com/user/emails', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const verifiedEmail = (ghEmails || []).find(e => e.verified && e.primary);
      if (!verifiedEmail) {
        // RT-02: No verified email — can't create/link account safely
        return res.redirect('/app?auth=error&reason=no_verified_email');
      }

      const result = findOrCreateOAuthUser('github', String(ghUser.id), verifiedEmail.email, ghUser.name || ghUser.login, ghUser.avatar_url);

      if (result.needsLinking) {
        const pendingState = crypto.randomBytes(16).toString('hex');
        oauthStates.set(`link_${pendingState}`, {
          provider: 'github', providerId: String(ghUser.id), email: verifiedEmail.email,
          name: ghUser.name || ghUser.login, avatar: ghUser.avatar_url, userId: result.user.id,
          created: Date.now()
        });
        return res.redirect(`/app?auth=link&provider=github&state=${pendingState}`);
      }

      const sid = createSession(result.user.id, req);
      setSessionCookie(res, sid);
      res.redirect('/app?auth=success');
    } catch (e) {
      console.error('[AUTH] GitHub callback error:', e.message);
      res.redirect('/app?auth=error&reason=server_error');
    }
  });

  // ─── LINK OAUTH ACCOUNT (RT-03: requires password) ──
  router.post('/link-oauth', async (req, res) => {
    const ip = getIP(req);
    if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests' });

    const { state, password } = req.body;
    if (!state || !password) return res.status(400).json({ error: 'State and password required' });

    const pending = oauthStates.get(`link_${state}`);
    if (!pending) return res.status(400).json({ error: 'Link request expired. Try again.' });

    const user = stmts.getUserById.get(pending.userId);
    if (!user || !user.password_hash) {
      oauthStates.delete(`link_${state}`);
      return res.status(400).json({ error: 'Account cannot be linked' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    // Link the OAuth account
    stmts.createOAuthAccount.run(genId(), user.id, pending.provider, pending.providerId, pending.email, pending.name || null, pending.avatar || null);
    oauthStates.delete(`link_${state}`);

    // Create session
    const sid = createSession(user.id, req);
    setSessionCookie(res, sid);

    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, emailVerified: !!user.email_verified } });
  });

  // ─── TOKEN LOGIN (bridge legacy tokens → sessions) ──
  router.post('/token-login', async (req, res) => {
    try {
      const ip = getIP(req);
      if (!checkAuthRate(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });
      const { token } = req.body;
      if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token required' });

      // First check kuro_tokens DB table (new system)
      const dbToken = stmts.getKuroToken.get(token);
      if (dbToken) {
        let user = stmts.getUserById.get(dbToken.user_id);
        if (!user) return res.status(401).json({ error: 'Token user not found' });

        // Mark email verified if not already (they clicked a token = they own the email)
        if (!user.email_verified) {
          stmts.verifyEmail.run(user.id);
        }

        const sid = createSession(user.id, req);
        setSessionCookie(res, sid);
        return res.json({
          success: true,
          user: { id: user.id, email: user.email, name: user.name, tier: user.tier, emailVerified: true },
          authMethod: 'token'
        });
      }

      // Load tokens.json
      const fs = require('fs');
      const path = require('path');
      const tokenPaths = [
        process.env.KURO_TOKEN_FILE || '/etc/kuro/tokens.json',
        path.join(process.env.KURO_DATA || '/var/lib/kuro', 'tokens.json')
      ];

      let tokenStore = null;
      for (const tp of tokenPaths) {
        try { if (fs.existsSync(tp)) { tokenStore = JSON.parse(fs.readFileSync(tp, 'utf8')); break; } } catch(e) {}
      }

      if (!tokenStore || !tokenStore.tokens) return res.status(401).json({ error: 'Token validation unavailable' });

      // Check plain and hashed
      const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
      const entry = tokenStore.tokens[token] || tokenStore.tokens[tokenHash];
      if (!entry) return res.status(401).json({ error: 'Invalid access token' });

      // Find or create a DB user for this token holder
      const tokenEmail = (entry.email || `${(entry.name || 'token').toLowerCase().replace(/\s+/g, '')}@token.kuroglass.net`).toLowerCase().trim();
      let user = stmts.getUserByEmail.get(tokenEmail);

      if (!user) {
        // Create user account for this token holder
        const userId = genId();
        const tierMap = { operator: 'sovereign', analyst: 'pro', viewer: 'free', service: 'free' };
        const tier = tierMap[entry.role] || 'free';
        // Create without password (token-only auth)
        user = db.prepare('INSERT INTO users (id, email, name, tier, email_verified, created_at, last_login) VALUES (?, ?, ?, ?, 1, datetime(\'now\'), datetime(\'now\')) RETURNING *')
          .get(userId, tokenEmail, entry.name || 'Token User', tier);
      }

      const sid = createSession(user.id, req);
      setSessionCookie(res, sid);

      res.json({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, tier: user.tier, emailVerified: !!user.email_verified },
        authMethod: 'token'
      });
    } catch (e) {
      console.error('[AUTH] Token login error:', e.message);
      res.status(500).json({ error: 'Token login failed' });
    }
  });

  // ─── GET CURRENT USER ────────────────────────────────
  router.get('/me', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.json({ authenticated: false });

    const session = stmts.getSession.get(sid);
    if (!session) return res.json({ authenticated: false });

    const user = stmts.getUserById.get(session.user_id);
    if (!user) return res.json({ authenticated: false });

    const sub = stmts.getActiveSubscription.get(user.id);
    const oauthAccounts = stmts.getUserOAuthAccounts.all(user.id);

    res.json({
      authenticated: true,
      user: {
        id: user.id, email: user.email, name: user.name,
        tier: user.tier, profile: user.profile,
        emailVerified: !!user.email_verified, isAdmin: !!user.is_admin,
        createdAt: user.created_at, lastLogin: user.last_login,
        oauthProviders: oauthAccounts.map(a => a.provider)
      },
      subscription: sub ? {
        status: sub.status, tier: sub.tier,
        periodEnd: sub.current_period_end,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end
      } : null,
      authMethod: 'session'
    });
  });

  // ─── REVOKE ALL SESSIONS ─────────────────────────────
  router.post('/sessions/revoke', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.status(401).json({ error: 'Not logged in' });
    const session = stmts.getSession.get(sid);
    if (!session) return res.status(401).json({ error: 'Session expired' });
    const result = stmts.deleteUserSessions.run(session.user_id);
    res.clearCookie('kuro_sid', COOKIE_OPTS);
    res.json({ success: true, sessionsRevoked: result.changes });
  });

  // ─── DATA EXPORT (GDPR) ─────────────────────────────
  router.get('/export', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.status(401).json({ error: 'Not logged in' });
    const session = stmts.getSession.get(sid);
    if (!session) return res.status(401).json({ error: 'Session expired' });
    const user = stmts.getUserById.get(session.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessions = db.prepare('SELECT id, created_at, ip, user_agent, expires_at FROM sessions WHERE user_id = ?').all(session.user_id);
    const oauthAccounts = stmts.getUserOAuthAccounts.all(session.user_id);
    const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(session.user_id);
    const usage = db.prepare('SELECT action, week_num, count FROM usage WHERE user_id = ?').all(session.user_id);

    res.json({
      exportDate: new Date().toISOString(),
      user: { id: user.id, email: user.email, name: user.name, tier: user.tier, emailVerified: !!user.email_verified, createdAt: user.created_at },
      sessions: sessions.length, oauthAccounts, subscriptions, usage
    });
  });

  // ─── DELETE ACCOUNT ──────────────────────────────────
  router.delete('/account', (req, res) => {
    const sid = req.cookies?.kuro_sid;
    if (!sid) return res.status(401).json({ error: 'Not logged in' });
    const session = stmts.getSession.get(sid);
    if (!session) return res.status(401).json({ error: 'Session expired' });
    const { confirm } = req.body;
    if (confirm !== 'DELETE_MY_ACCOUNT') return res.status(400).json({ error: 'Confirmation required', hint: 'Send { "confirm": "DELETE_MY_ACCOUNT" }' });
    stmts.deleteUser.run(session.user_id);
    res.clearCookie('kuro_sid', COOKIE_OPTS);
    console.log(`[AUTH] Account deleted: ${session.user_id}`);
    res.json({ success: true, message: 'Account and all data deleted' });
  });

  return router;
}

module.exports = createAuthRoutes;
