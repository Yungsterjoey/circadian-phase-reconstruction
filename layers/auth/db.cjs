/**
 * KURO::AUTH Database — SQLite via better-sqlite3
 * Sovereign data store — zero external dependencies
 *
 * v2: +display_name, +avatar_url on oauth_accounts
 *     +password_hash nullable (for OAuth-only accounts)
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const DB_PATH = path.join(DB_DIR, 'kuro.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ═══════════════════════════════════════════════════════
// SCHEMA MIGRATION
// ═══════════════════════════════════════════════════════

const SCHEMA_VERSION = 4;

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  if (current >= SCHEMA_VERSION) return;

  console.log(`[AUTH:DB] Migrating schema v${current} → v${SCHEMA_VERSION}`);

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        email           TEXT UNIQUE NOT NULL,
        name            TEXT,
        password_hash   TEXT,
        tier            TEXT DEFAULT 'free' CHECK(tier IN ('free','pro','sovereign')),
        profile         TEXT DEFAULT 'enterprise',
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_verified  INTEGER DEFAULT 0,
        last_login      DATETIME
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  DATETIME NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip          TEXT,
        user_agent  TEXT
      );

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider      TEXT NOT NULL,
        provider_id   TEXT NOT NULL,
        email         TEXT,
        display_name  TEXT,
        avatar_url    TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, provider_id)
      );

      CREATE TABLE IF NOT EXISTS passkeys (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key      BLOB NOT NULL,
        counter         INTEGER DEFAULT 0,
        device_type     TEXT,
        backed_up       INTEGER DEFAULT 0,
        transports      TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS email_otps (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code        TEXT NOT NULL,
        expires_at  DATETIME NOT NULL,
        used        INTEGER DEFAULT 0,
        attempts    INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id    TEXT NOT NULL,
        stripe_price_id       TEXT,
        status                TEXT NOT NULL,
        tier                  TEXT NOT NULL,
        current_period_start  DATETIME,
        current_period_end    DATETIME,
        cancel_at_period_end  INTEGER DEFAULT 0,
        created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS kuro_tokens (
        token           TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tier            TEXT DEFAULT 'free',
        dev_allowed     INTEGER DEFAULT 0,
        max_agent_tier  INTEGER DEFAULT 1,
        capabilities    TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked         INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS usage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL,
        action      TEXT NOT NULL,
        week_num    INTEGER NOT NULL,
        count       INTEGER DEFAULT 1,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, action, week_num)
      );

      CREATE TABLE IF NOT EXISTS stripe_events (
        event_id     TEXT PRIMARY KEY,
        event_type   TEXT NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_kuro_tokens_user ON kuro_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_user_week ON usage(user_id, week_num);
    `);
  }

  if (current < 2) {
    // v2: Add columns if missing (idempotent via try/catch)
    try { db.exec('ALTER TABLE oauth_accounts ADD COLUMN display_name TEXT'); } catch(e) {}
    try { db.exec('ALTER TABLE oauth_accounts ADD COLUMN avatar_url TEXT'); } catch(e) {}
    try { db.exec('ALTER TABLE oauth_accounts ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch(e) {}
  }

  if (current < 3) {
    // v3: Admin flag
    try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch(e) {}
  }

  if (current < 4) {
    // v4: VFS metadata + quotas + projects
    db.exec(`
      CREATE TABLE IF NOT EXISTS vfs_files (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        path        TEXT NOT NULL,
        size        INTEGER DEFAULT 0,
        mime_type   TEXT,
        backend     TEXT DEFAULT 's3',
        s3_key      TEXT,
        is_dir      INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, path)
      );

      CREATE TABLE IF NOT EXISTS vfs_quotas (
        user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        limit_bytes INTEGER NOT NULL DEFAULT 104857600,
        used_bytes  INTEGER NOT NULL DEFAULT 0,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        vfs_path    TEXT,
        meta        TEXT DEFAULT '{}',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_vfs_files_user ON vfs_files(user_id);
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    `);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  console.log(`[AUTH:DB] Schema v${SCHEMA_VERSION} applied`);
}

migrate();

// Bootstrap admin from env
const KURO_ADMIN_EMAIL = process.env.KURO_ADMIN_EMAIL;
if (KURO_ADMIN_EMAIL) {
  const adminUser = db.prepare('SELECT id, is_admin FROM users WHERE email = ?').get(KURO_ADMIN_EMAIL.toLowerCase().trim());
  if (adminUser && !adminUser.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminUser.id);
    console.log(`[AUTH:DB] Bootstrapped admin: ${KURO_ADMIN_EMAIL}`);
  } else if (!adminUser) {
    console.log(`[AUTH:DB] KURO_ADMIN_EMAIL=${KURO_ADMIN_EMAIL} — user not found yet, will promote on first login`);
  }
}

// ═══════════════════════════════════════════════════════
// PREPARED STATEMENTS
// ═══════════════════════════════════════════════════════

const stmts = {
  // Users
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare(`INSERT INTO users (id, email, name, password_hash, tier)
    VALUES (?, ?, ?, ?, 'free') RETURNING *`),
  createOAuthUser: db.prepare(`INSERT INTO users (id, email, name, password_hash, tier, email_verified)
    VALUES (?, ?, ?, NULL, 'free', 1) RETURNING *`),
  updateTier: db.prepare('UPDATE users SET tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  verifyEmail: db.prepare('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  isAdmin: db.prepare('SELECT is_admin FROM users WHERE id = ?'),
  listUsers: db.prepare('SELECT id, email, name, tier, is_admin, email_verified, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 200'),
  setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  touchLogin: db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  // Sessions
  createSession: db.prepare(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
    VALUES (?, ?, datetime('now', ?), ?, ?)`),
  getSession: db.prepare(`SELECT s.*, u.email, u.name, u.tier, u.profile, u.email_verified
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')`),
  refreshSession: db.prepare("UPDATE sessions SET expires_at = datetime('now', '+24 hours') WHERE id = ? AND expires_at > datetime('now')"),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  cleanExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),

  // OAuth
  getOAuthAccount: db.prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_id = ?'),
  getOAuthByUserAndProvider: db.prepare('SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?'),
  getUserOAuthAccounts: db.prepare('SELECT provider, email, display_name, avatar_url FROM oauth_accounts WHERE user_id = ?'),
  createOAuthAccount: db.prepare(`INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, display_name, avatar_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),

  // OTP
  createOTP: db.prepare(`INSERT INTO email_otps (user_id, code, expires_at)
    VALUES (?, ?, datetime('now', '+10 minutes'))`),
  getActiveOTP: db.prepare(`SELECT * FROM email_otps
    WHERE user_id = ? AND used = 0 AND attempts < 5 AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1`),
  incrementOTPAttempt: db.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?'),
  markOTPUsed: db.prepare('UPDATE email_otps SET used = 1 WHERE id = ?'),
  countRecentOTPs: db.prepare(`SELECT COUNT(*) as cnt FROM email_otps
    WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`),

  // Subscriptions
  upsertSubscription: db.prepare(`INSERT INTO subscriptions
    (id, user_id, stripe_customer_id, stripe_price_id, status, tier, current_period_start, current_period_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
    status=excluded.status, tier=excluded.tier,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,
    updated_at=CURRENT_TIMESTAMP`),
  getActiveSubscription: db.prepare(`SELECT * FROM subscriptions
    WHERE user_id = ? AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`),

  // Stripe events (idempotency)
  checkStripeEvent: db.prepare('SELECT 1 FROM stripe_events WHERE event_id = ?'),
  recordStripeEvent: db.prepare('INSERT INTO stripe_events (event_id, event_type) VALUES (?, ?)'),

  // Usage
  getUsage: db.prepare('SELECT * FROM usage WHERE user_id = ? AND action = ? AND week_num = ?'),
  upsertUsage: db.prepare(`INSERT INTO usage (user_id, action, week_num, count)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id, action, week_num)
    DO UPDATE SET count = count + excluded.count`),

  // Kuro Tokens
  createKuroToken: db.prepare('INSERT OR IGNORE INTO kuro_tokens (token, user_id, tier) VALUES (?, ?, ?)'),
  getKuroToken: db.prepare('SELECT * FROM kuro_tokens WHERE token = ? AND revoked = 0'),
};

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function genId() { return crypto.randomBytes(16).toString('hex'); }
function genSessionId() { return crypto.randomBytes(32).toString('hex'); }
function genOTP() { return String(Math.floor(100000 + Math.random() * 900000)); }

// Session cleanup (hourly)
setInterval(() => {
  const result = stmts.cleanExpiredSessions.run();
  if (result.changes > 0) console.log(`[AUTH:DB] Cleaned ${result.changes} expired sessions`);
}, 60 * 60 * 1000);

module.exports = { db, stmts, genId, genSessionId, genOTP, DB_PATH };
