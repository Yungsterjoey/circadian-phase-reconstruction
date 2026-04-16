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

  console.log('[KURO::PAY] Ledger schema ready');
}

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

module.exports = {
  initSchema,
  getDB,
  insertPayment,
  updatePaymentStripe,
  updatePaymentSettled,
  updatePaymentError,
  getPayment,
  getUserPayments,
  upsertCard,
  getUserCards,
};
