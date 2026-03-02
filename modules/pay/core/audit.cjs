'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const ledger = require('./ledger.cjs');

/**
 * SHA-256 hash-chained audit log for KURO::PAY.
 *
 * Each record's hash = SHA-256( prev_hash | timestamp | event_type | ledger_id | actor )
 * The first record in the chain uses prev_hash = '0'.
 */

function computeHash(prevHash, timestamp, eventType, ledgerId, actor) {
  const message = [prevHash || '0', timestamp, eventType, ledgerId || '', actor].join('|');
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * Inscribe a new audit record into the hash chain.
 * @param {string} eventType - e.g. 'ledger.create', 'transfer.fund', 'status.update'
 * @param {string|null} ledgerId - related pay_ledger id (nullable)
 * @param {string} actor - who performed the action, defaults to 'system'
 * @returns {{ id, timestamp, event_type, ledger_id, actor, prev_hash, hash }}
 */
function inscribe(eventType, ledgerId, actor = 'system') {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const prevHash = ledger.getLastAuditHash() || '0';
  const hash = computeHash(prevHash, timestamp, eventType, ledgerId, actor);

  const record = {
    id,
    timestamp,
    event_type: eventType,
    ledger_id: ledgerId || null,
    actor,
    prev_hash: prevHash,
    hash,
  };

  ledger.insertAudit(record);
  return record;
}

/**
 * Walk the full audit chain and verify every hash.
 * @returns {{ valid: boolean, total: number, broken_at: number|null }}
 */
function verifyChain() {
  const chain = ledger.getAuditChain();
  if (chain.length === 0) return { valid: true, total: 0, broken_at: null };

  for (let i = 0; i < chain.length; i++) {
    const rec = chain[i];
    const expectedPrev = i === 0 ? '0' : chain[i - 1].hash;

    if (rec.prev_hash !== expectedPrev) {
      return { valid: false, total: chain.length, broken_at: i };
    }

    const expected = computeHash(rec.prev_hash, rec.timestamp, rec.event_type, rec.ledger_id, rec.actor);
    if (rec.hash !== expected) {
      return { valid: false, total: chain.length, broken_at: i };
    }
  }

  return { valid: true, total: chain.length, broken_at: null };
}

module.exports = { inscribe, verifyChain };
