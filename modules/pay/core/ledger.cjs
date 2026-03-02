'use strict';

const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const path = require('path');

const DB_PATH = path.join('/opt/kuro/data', 'pay.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH, { verbose: null });
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema();
  }
  return _db;
}

function initSchema() {
  const db = _db || getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS pay_ledger (
      id              TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL,
      type            TEXT NOT NULL,
      amount_minor    INTEGER NOT NULL,
      currency        TEXT NOT NULL,
      amount_minor_to INTEGER,
      currency_to     TEXT,
      from_ref        TEXT,
      to_ref          TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      ai_action       TEXT,
      ai_confidence   REAL,
      ai_memo         TEXT,
      external_id     TEXT,
      metadata        TEXT
    );

    CREATE TABLE IF NOT EXISTS pay_insights_cache (
      id              TEXT PRIMARY KEY,
      generated_at    TEXT NOT NULL,
      profile_used    TEXT,
      payload         TEXT
    );

    CREATE TABLE IF NOT EXISTS pay_audit (
      id              TEXT PRIMARY KEY,
      timestamp       TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      ledger_id       TEXT,
      actor           TEXT NOT NULL DEFAULT 'system',
      prev_hash       TEXT,
      hash            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pay_vaults (
      id              TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      name            TEXT NOT NULL,
      emoji           TEXT DEFAULT '💰',
      currency        TEXT NOT NULL DEFAULT 'AUD',
      goal_minor      INTEGER DEFAULT 0,
      current_minor   INTEGER DEFAULT 0,
      colour          TEXT DEFAULT '#a855f7'
    );

    CREATE TABLE IF NOT EXISTS pay_round_ups (
      id              TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      amount_cents    INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued',
      ledger_id       TEXT
    );

    CREATE TABLE IF NOT EXISTS pay_payees (
      id              TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      name            TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'bsb',
      bsb             TEXT,
      account_number  TEXT,
      payid           TEXT,
      crypto_address  TEXT,
      currency        TEXT NOT NULL DEFAULT 'AUD',
      favourite       INTEGER NOT NULL DEFAULT 0,
      last_used       TEXT,
      metadata        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payees_fav ON pay_payees(favourite DESC, last_used DESC);
  `);
}

/* ------------------------------------------------------------------ */
/*  pay_ledger                                                        */
/* ------------------------------------------------------------------ */

function insertLedger(entry) {
  const db = getDb();
  const id = entry.id || randomUUID();
  const now = entry.created_at || new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO pay_ledger
      (id, created_at, type, amount_minor, currency, amount_minor_to,
       currency_to, from_ref, to_ref, status, ai_action, ai_confidence,
       ai_memo, external_id, metadata)
    VALUES
      (@id, @created_at, @type, @amount_minor, @currency, @amount_minor_to,
       @currency_to, @from_ref, @to_ref, @status, @ai_action, @ai_confidence,
       @ai_memo, @external_id, @metadata)
  `);

  stmt.run({
    id,
    created_at: now,
    type: entry.type,
    amount_minor: entry.amount_minor,
    currency: entry.currency,
    amount_minor_to: entry.amount_minor_to ?? null,
    currency_to: entry.currency_to ?? null,
    from_ref: entry.from_ref ?? null,
    to_ref: entry.to_ref ?? null,
    status: entry.status || 'pending',
    ai_action: entry.ai_action ?? null,
    ai_confidence: entry.ai_confidence ?? null,
    ai_memo: entry.ai_memo ?? null,
    external_id: entry.external_id ?? null,
    metadata: entry.metadata ? (typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata)) : null,
  });

  return id;
}

function updateLedgerStatus(id, status) {
  const db = getDb();
  const stmt = db.prepare('UPDATE pay_ledger SET status = ? WHERE id = ?');
  return stmt.run(status, id);
}

function getLedger(limit = 50, offset = 0) {
  const db = getDb();
  return db.prepare('SELECT * FROM pay_ledger ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function getLedgerById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM pay_ledger WHERE id = ?').get(id);
}

/* ------------------------------------------------------------------ */
/*  pay_insights_cache                                                */
/* ------------------------------------------------------------------ */

function getInsight() {
  const db = getDb();
  return db.prepare('SELECT * FROM pay_insights_cache ORDER BY generated_at DESC LIMIT 1').get() || null;
}

function saveInsight(id, profile, payload) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pay_insights_cache (id, generated_at, profile_used, payload)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, new Date().toISOString(), profile, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

/* ------------------------------------------------------------------ */
/*  pay_audit                                                         */
/* ------------------------------------------------------------------ */

function insertAudit(record) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO pay_audit (id, timestamp, event_type, ledger_id, actor, prev_hash, hash)
    VALUES (@id, @timestamp, @event_type, @ledger_id, @actor, @prev_hash, @hash)
  `);
  stmt.run({
    id: record.id,
    timestamp: record.timestamp,
    event_type: record.event_type,
    ledger_id: record.ledger_id ?? null,
    actor: record.actor || 'system',
    prev_hash: record.prev_hash ?? null,
    hash: record.hash,
  });
}

function getAuditPage(limit = 50, offset = 0) {
  const db = getDb();
  return db.prepare('SELECT * FROM pay_audit ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function getAuditChain() {
  const db = getDb();
  return db.prepare('SELECT * FROM pay_audit ORDER BY rowid ASC').all();
}

function getLastAuditHash() {
  const db = getDb();
  const row = db.prepare('SELECT hash FROM pay_audit ORDER BY rowid DESC LIMIT 1').get();
  return row ? row.hash : null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function redact(str) {
  if (!str || str.length < 8) return '****';
  return str.slice(0, 4) + '...' + str.slice(-4);
}

/* ------------------------------------------------------------------ */
/*  Vaults                                                             */
/* ------------------------------------------------------------------ */

function getVaults() { return getDb().prepare('SELECT * FROM pay_vaults ORDER BY created_at DESC').all(); }
function getVault(id) { return getDb().prepare('SELECT * FROM pay_vaults WHERE id = ?').get(id); }
function insertVault(v) {
  getDb().prepare('INSERT INTO pay_vaults (id, name, emoji, currency, goal_minor, current_minor, colour) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    v.id || randomUUID(), v.name, v.emoji || '💰', v.currency || 'AUD', v.goal_minor || 0, v.current_minor || 0, v.colour || '#a855f7'
  );
  return getVault(v.id);
}
function updateVault(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE pay_vaults SET ${sets} WHERE id = @id`).run({ ...fields, id });
  return getVault(id);
}
function deleteVault(id) { getDb().prepare('DELETE FROM pay_vaults WHERE id = ?').run(id); }

/* ------------------------------------------------------------------ */
/*  Round-ups                                                          */
/* ------------------------------------------------------------------ */

function insertRoundUp(amountCents) {
  const id = randomUUID();
  getDb().prepare('INSERT INTO pay_round_ups (id, amount_cents) VALUES (?, ?)').run(id, amountCents);
  return { id, amount_cents: amountCents, status: 'queued' };
}
function getPendingRoundUps() { return getDb().prepare("SELECT * FROM pay_round_ups WHERE status = 'queued' ORDER BY created_at").all(); }
function updateRoundUpStatus(id, status, ledgerId) {
  getDb().prepare('UPDATE pay_round_ups SET status = ?, ledger_id = ? WHERE id = ?').run(status, ledgerId || null, id);
}

/* ------------------------------------------------------------------ */
/*  Payees                                                             */
/* ------------------------------------------------------------------ */

function getPayees() { return getDb().prepare('SELECT * FROM pay_payees ORDER BY favourite DESC, last_used DESC NULLS LAST, created_at DESC').all(); }
function getPayee(id) { return getDb().prepare('SELECT * FROM pay_payees WHERE id = ?').get(id); }
function insertPayee(p) {
  const id = p.id || randomUUID();
  getDb().prepare('INSERT INTO pay_payees (id, name, type, bsb, account_number, payid, crypto_address, currency, favourite, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, p.name, p.type || 'bsb', p.bsb || null, p.account_number || null, p.payid || null, p.crypto_address || null, p.currency || 'AUD', p.favourite ? 1 : 0, p.metadata ? JSON.stringify(p.metadata) : null
  );
  return getPayee(id);
}
function updatePayee(id, fields) {
  const allowed = ['name', 'type', 'bsb', 'account_number', 'payid', 'crypto_address', 'currency', 'favourite', 'last_used', 'metadata'];
  const updates = {};
  for (const k of allowed) { if (fields[k] !== undefined) updates[k] = k === 'metadata' ? JSON.stringify(fields[k]) : fields[k]; }
  if (!Object.keys(updates).length) return getPayee(id);
  const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE pay_payees SET ${sets} WHERE id = @id`).run({ ...updates, id });
  return getPayee(id);
}
function deletePayee(id) { getDb().prepare('DELETE FROM pay_payees WHERE id = ?').run(id); }
function touchPayee(id) { getDb().prepare("UPDATE pay_payees SET last_used = datetime('now') WHERE id = ?").run(id); }

module.exports = {
  getDb,
  initSchema,
  insertLedger,
  updateLedgerStatus,
  getLedger,
  getLedgerById,
  getInsight,
  saveInsight,
  insertAudit,
  getAuditPage,
  getAuditChain,
  getLastAuditHash,
  redact,
  getVaults, getVault, insertVault, updateVault, deleteVault,
  insertRoundUp, getPendingRoundUps, updateRoundUpStatus,
  getPayees, getPayee, insertPayee, updatePayee, deletePayee, touchPayee,
};
