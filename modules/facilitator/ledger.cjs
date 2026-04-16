'use strict';

// KURO x402 Facilitator — event ledger
// Uses the shared kuro.db (WAL mode). Additive schema only.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

function getDB() {
  try { return require('../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

let _initialised = false;

function initSchema() {
  if (_initialised) return;
  const db = getDB();
  if (!db) {
    console.warn('[FACILITATOR] DB not available — schema skipped');
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  _initialised = true;
}

function sha256Hex(obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return crypto.createHash('sha256').update(s).digest('hex');
}

function recordVerify({ scheme, payer, status, reason, payload, requestTs }) {
  const db = getDB();
  if (!db) return null;
  const stmt = db.prepare(`
    INSERT INTO kuro_facilitator_events
      (kind, scheme, payer, status, reason, payload_hash, request_ts)
    VALUES
      ('verify', ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);
  return stmt.get(scheme, payer || null, status, reason || null, sha256Hex(payload), requestTs || null)?.id;
}

function recordSettle({ scheme, idempotencyKey, payer, network, amount, currency, txRef, status, reason, payload, requestTs }) {
  const db = getDB();
  if (!db) return null;
  const stmt = db.prepare(`
    INSERT INTO kuro_facilitator_events
      (kind, scheme, idempotency_key, payer, network, amount, currency, tx_ref, status, reason, payload_hash, request_ts)
    VALUES
      ('settle', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);
  return stmt.get(
    scheme,
    idempotencyKey || null,
    payer || null,
    network || null,
    amount != null ? String(amount) : null,
    currency || null,
    txRef || null,
    status,
    reason || null,
    sha256Hex(payload),
    requestTs || null,
  )?.id;
}

function findByIdempotencyKey(key) {
  const db = getDB();
  if (!db || !key) return null;
  return db.prepare(`
    SELECT id, scheme, payer, network, amount, currency, tx_ref, status, reason, created_at
    FROM kuro_facilitator_events
    WHERE idempotency_key = ?
      AND kind = 'settle'
    LIMIT 1
  `).get(key);
}

module.exports = {
  initSchema,
  sha256Hex,
  recordVerify,
  recordSettle,
  findByIdempotencyKey,
};
