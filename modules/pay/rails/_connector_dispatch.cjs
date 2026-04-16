'use strict';

// Routes initiate() calls to preferred → fallback connector.
// Preferred connector gets a 10-second timeout; on failure, fallback is tried.
// Records connector_used on the kuro_pay_payments row.

const TIMEOUT_MS = 10_000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('connector_timeout')), ms)),
  ]);
}

function loadConnector(id) {
  try {
    return require(`../connectors/${id}.cjs`);
  } catch (err) {
    return null;
  }
}

function recordConnectorUsed(payoutId, connectorId) {
  try {
    const ledger = require('../pay_ledger.cjs');
    const db     = ledger.getDB();
    if (db) db.prepare(`UPDATE kuro_pay_payments SET connector_used=? WHERE id=?`).run(connectorId, payoutId);
  } catch (_) {}
}

async function callConnector(preferred, fallback, params) {
  const preferredConnector = loadConnector(preferred);
  if (preferredConnector) {
    try {
      const result = await withTimeout(preferredConnector.initiate(params), TIMEOUT_MS);
      if (result?.payoutId) recordConnectorUsed(result.payoutId, preferred);
      return result;
    } catch (err) {
      console.warn(`[connector_dispatch] ${preferred} failed (${err.message}), trying ${fallback}`);
    }
  }

  const fallbackConnector = loadConnector(fallback);
  if (!fallbackConnector) {
    throw new Error(`No connector available (tried ${preferred}, ${fallback})`);
  }

  const result = await fallbackConnector.initiate(params);
  if (result?.payoutId) recordConnectorUsed(result.payoutId, fallback);
  return result;
}

async function connectorStatus(payoutId) {
  const ledger = require('../pay_ledger.cjs');
  const db     = ledger.getDB();
  if (!db) return { status: 'unknown' };

  const row = db.prepare(
    `SELECT status, settled_at, connector_used, x402_receipt_json FROM kuro_pay_payments WHERE id=?`
  ).get(payoutId);
  if (!row) return { status: 'not_found' };

  const proof = row.x402_receipt_json ? JSON.parse(row.x402_receipt_json) : null;
  return { status: row.status, settledAt: row.settled_at, connectorUsed: row.connector_used, proof };
}

module.exports = { callConnector, connectorStatus };
