'use strict';

/**
 * KURO::PAY — Payment Ledger
 * Additive schema migrations for kuro_pay_payments and kuro_pay_cards.
 * Uses existing db from layers/auth/db.cjs (WAL mode already set).
 */

function getDB() {
  try { return require('../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

function initSchema() {
  const db = getDB();
  if (!db) {
    console.warn('[KURO::PAY] DB not available — ledger schema skipped');
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kuro_pay_payments (
      id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id               TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending',
      qr_raw                TEXT,
      merchant_account      TEXT,
      merchant_name         TEXT,
      bank_bin              TEXT,
      bank_code             TEXT,
      bank_name             TEXT,
      amount_aud            REAL,
      amount_vnd            REAL,
      currency              TEXT DEFAULT 'VND',
      stripe_payment_intent_id TEXT,
      x402_payment_id       TEXT,
      x402_receipt_json     TEXT,
      reference             TEXT,
      network               TEXT DEFAULT 'vietqr',
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      settled_at            DATETIME,
      error                 TEXT
    );

    CREATE TABLE IF NOT EXISTS kuro_pay_cards (
      id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id                  TEXT NOT NULL,
      stripe_customer_id       TEXT NOT NULL,
      stripe_payment_method_id TEXT NOT NULL UNIQUE,
      last4                    TEXT,
      brand                    TEXT,
      exp_month                INTEGER,
      exp_year                 INTEGER,
      is_default               INTEGER DEFAULT 0,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Additive index — ignore if already exists
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_kpp_user ON kuro_pay_payments(user_id, created_at DESC)`); } catch(_){}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_kpc_user ON kuro_pay_cards(user_id)`); } catch(_){}

  // ── ATM session table ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS kuro_pay_atm_sessions (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
      atm_qr_raw         TEXT,
      atm_country        TEXT,
      requested_amount   REAL,
      requested_currency TEXT,
      warm_token_id      TEXT,
      payment_id         TEXT,
      status             TEXT DEFAULT 'pending',
      created_at         INTEGER NOT NULL,
      expires_at         INTEGER NOT NULL
    );
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_kpa_user ON kuro_pay_atm_sessions(user_id, status)`); } catch(_){}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_kpa_expiry ON kuro_pay_atm_sessions(expires_at, status)`); } catch(_){}

  // ── Reserve ledger ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS kuro_pay_reserve (
      id                   TEXT PRIMARY KEY,
      payment_id           TEXT NOT NULL,
      payment_amount_usd   REAL NOT NULL,
      reserve_contribution REAL NOT NULL,
      reserve_rate         REAL DEFAULT 0.03,
      event_type           TEXT DEFAULT 'payment',
      created_at           INTEGER NOT NULL
    );
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_kpr_pid ON kuro_pay_reserve(payment_id)`); } catch(_){}

  // ── Additive columns on kuro_pay_payments (ignore if column exists) ──
  for (const col of [
    'settlement_latency_ms INTEGER',
    'x402_tx_signature TEXT',
    'x402_network TEXT',
    'warm_token_id TEXT',
  ]) {
    try { db.exec(`ALTER TABLE kuro_pay_payments ADD COLUMN ${col}`); } catch(_){}
  }

  // ── Additive column on kuro_pay_cards (ignore if column exists) ──
  try { db.exec(`ALTER TABLE kuro_pay_cards ADD COLUMN warm_token_id TEXT`); } catch(_){}
  try { db.exec(`ALTER TABLE kuro_pay_cards ADD COLUMN warm_token_expires_at INTEGER`); } catch(_){}

  console.log('[KURO::PAY] Ledger schema ready');
}

// runMigrations alias (matches spec's test invocation)
function runMigrations() { return initSchema(); }

// ── Payment record helpers ────────────────────────────────────────

function insertPayment(db, fields) {
  const {
    id, userId, qrRaw, merchantAccount, merchantName,
    bankBin, bankCode, bankName, amountAUD, amountVND,
    currency, reference, network,
  } = fields;
  return db.prepare(`
    INSERT INTO kuro_pay_payments
      (id, user_id, qr_raw, merchant_account, merchant_name,
       bank_bin, bank_code, bank_name, amount_aud, amount_vnd,
       currency, reference, network, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
  `).run(id, userId, qrRaw, merchantAccount, merchantName,
         bankBin, bankCode, bankName, amountAUD, amountVND,
         currency, reference, network);
}

function updatePaymentStripe(db, id, stripeIntentId) {
  db.prepare(`UPDATE kuro_pay_payments SET stripe_payment_intent_id=?, status='stripe_charged' WHERE id=?`)
    .run(stripeIntentId, id);
}

function updatePaymentSettled(db, id, x402ReceiptJson) {
  db.prepare(`UPDATE kuro_pay_payments SET x402_receipt_json=?, status='settled', settled_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(x402ReceiptJson, id);
}

function updatePaymentError(db, id, error) {
  db.prepare(`UPDATE kuro_pay_payments SET status='error', error=? WHERE id=?`).run(error, id);
}

function getPayment(db, id) {
  return db.prepare(`SELECT * FROM kuro_pay_payments WHERE id=?`).get(id);
}

function getUserPayments(db, userId, limit = 20) {
  return db.prepare(`SELECT * FROM kuro_pay_payments WHERE user_id=? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
}

// ── Card record helpers ───────────────────────────────────────────

function upsertCard(db, fields) {
  const { id, userId, stripeCustomerId, stripePmId, last4, brand, expMonth, expYear, isDefault } = fields;
  if (isDefault) db.prepare(`UPDATE kuro_pay_cards SET is_default=0 WHERE user_id=?`).run(userId);
  db.prepare(`
    INSERT OR REPLACE INTO kuro_pay_cards
      (id, user_id, stripe_customer_id, stripe_payment_method_id, last4, brand, exp_month, exp_year, is_default)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, userId, stripeCustomerId, stripePmId, last4, brand, expMonth, expYear, isDefault ? 1 : 0);
}

function getUserCards(db, userId) {
  return db.prepare(`SELECT * FROM kuro_pay_cards WHERE user_id=? ORDER BY is_default DESC, created_at DESC`).all(userId);
}

// ── ATM session helpers ───────────────────────────────────────────
const crypto = require('crypto');

function createATMSession(userId, qrRaw, country, amount, currency, warmTokenId) {
  const db = getDB();
  if (!db) throw new Error('DB unavailable');
  const id  = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO kuro_pay_atm_sessions
      (id, user_id, atm_qr_raw, atm_country, requested_amount, requested_currency,
       warm_token_id, status, created_at, expires_at)
    VALUES (?,?,?,?,?,?,?,'pending',?,?)
  `).run(id, userId, qrRaw, country, amount, currency, warmTokenId, now, now + 60_000);
  return id;
}

function attachATMPayment(sessionId, paymentId, status = 'settled') {
  const db = getDB();
  if (!db) return;
  db.prepare(`UPDATE kuro_pay_atm_sessions SET payment_id=?, status=? WHERE id=?`)
    .run(paymentId, status, sessionId);
}

function expireATMSessions() {
  const db = getDB();
  if (!db) return 0;
  const r = db.prepare(`UPDATE kuro_pay_atm_sessions SET status='expired'
                         WHERE expires_at < ? AND status='pending'`).run(Date.now());
  return r.changes || 0;
}

// ── Reserve helpers ───────────────────────────────────────────────
function recordReserve(paymentId, amountUSD, eventType = 'payment') {
  const db = getDB();
  if (!db) throw new Error('DB unavailable');
  const rate         = 0.03;
  const contribution = parseFloat((amountUSD * rate).toFixed(4));
  db.prepare(`
    INSERT INTO kuro_pay_reserve
      (id, payment_id, payment_amount_usd, reserve_contribution, reserve_rate,
       event_type, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(crypto.randomUUID(), paymentId, amountUSD, contribution, rate, eventType, Date.now());
  return contribution;
}

function deductReserveForDispute(paymentId, amountUSD) {
  // Negative entry — preserves audit trail rather than mutating the original row.
  return recordReserve(paymentId, -Math.abs(amountUSD), 'dispute');
}

// ── Updates for new payment columns ───────────────────────────────
function updatePaymentSettlementMeta(db, id, { latencyMs, txSignature, network }) {
  db.prepare(`UPDATE kuro_pay_payments
              SET settlement_latency_ms=?, x402_tx_signature=?, x402_network=?
              WHERE id=?`).run(latencyMs ?? null, txSignature ?? null, network ?? null, id);
}

module.exports = {
  initSchema,
  runMigrations,
  getDB,
  insertPayment,
  updatePaymentStripe,
  updatePaymentSettled,
  updatePaymentError,
  updatePaymentSettlementMeta,
  getPayment,
  getUserPayments,
  upsertCard,
  getUserCards,
  createATMSession,
  attachATMPayment,
  expireATMSessions,
  recordReserve,
  deductReserveForDispute,
};
