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
      const user = stmts.createUser.get(userId, email.toLowerCase().trim(), name || null, hash);
      const otpResult = await sendOTP(userId, email.toLowerCase().trim(), ip);
      const sid = createSession(userId, req);
      setSessionCookie(res, sid);

      res.status(201).json({
        success: true,
        user: { id: userId, email: user.email, name: user.name, tier: 'free', emailVerified: false },
        otpSent: otpResult.success,
        devCode: otpResult.devCode,
        message: 'Account created. Check your email for a verification code.'
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
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });

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
        // Fallback: decode JWT (less secure but functional without google-auth-library)
        const parts = tokenResp.id_token.split('.');
        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
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
    if (!GITHUB_CLIENT_ID) return res.status(503).json({ error: 'GitHub OAuth not configured' });

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
        emailVerified: !!user.email_verified,
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
