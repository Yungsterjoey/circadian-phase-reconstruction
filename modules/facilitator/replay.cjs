'use strict';

// KURO x402 Facilitator — nonce replay cache
// TTL: 10 minutes (600s). Freshness: ±120s.

const TTL_SECONDS       = 600;
const FRESHNESS_SECONDS = 120;

function getDB() {
  try { return require('../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

function now() { return Math.floor(Date.now() / 1000); }

// Returns true if the nonce was unseen and has now been recorded.
// Returns false if the nonce was already seen (replay).
function claim(nonce, scheme) {
  const db = getDB();
  if (!db) return true; // degrade open — better than blocking on DB outage
  const ts = now();
  try {
    db.prepare(`
      INSERT INTO kuro_facilitator_nonces (nonce, scheme, seen_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(nonce, scheme, ts, ts + TTL_SECONDS);
    return true;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
    throw e;
  }
}

function isFresh(requestTs) {
  if (!Number.isFinite(requestTs)) return false;
  const skew = Math.abs(now() - requestTs);
  return skew <= FRESHNESS_SECONDS;
}

// Garbage-collect expired nonces. Safe to call periodically.
function sweep() {
  const db = getDB();
  if (!db) return 0;
  return db.prepare(`DELETE FROM kuro_facilitator_nonces WHERE expires_at < ?`).run(now()).changes;
}

module.exports = {
  TTL_SECONDS,
  FRESHNESS_SECONDS,
  claim,
  isFresh,
  sweep,
};
