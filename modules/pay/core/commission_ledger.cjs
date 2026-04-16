'use strict';

// Commission is stored on the kuro_pay_payments row itself (commission_aud,
// commission_paid, commission_payout_id columns added in migration v10).
// This module provides query helpers over those columns.

function getDB() {
  try { return require('../../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

// Record commission for a settled payment.
// Called by quote_engine after Stripe charge succeeds.
function recordCommission(paymentId, commissionAUD) {
  const db = getDB();
  if (!db) return;
  db.prepare(`UPDATE kuro_pay_payments SET commission_aud=? WHERE id=?`)
    .run(commissionAUD, paymentId);
}

// Sum of all unpaid commission across all payments.
function pendingTotal() {
  const db = getDB();
  if (!db) return 0;
  const row = db.prepare(
    `SELECT COALESCE(SUM(commission_aud), 0) AS total
       FROM kuro_pay_payments
      WHERE commission_aud IS NOT NULL AND commission_paid = 0 AND status = 'settled'`
  ).get();
  return parseFloat((row?.total || 0).toFixed(4));
}

// Return rows with unpaid commission.
function getUnpaid() {
  const db = getDB();
  if (!db) return [];
  return db.prepare(
    `SELECT id, user_id, commission_aud, created_at
       FROM kuro_pay_payments
      WHERE commission_aud IS NOT NULL AND commission_paid = 0 AND status = 'settled'
      ORDER BY created_at ASC`
  ).all();
}

// Mark all currently-unpaid rows as paid, recording payout ID.
function markPaid(payoutId) {
  const db = getDB();
  if (!db) return 0;
  const result = db.prepare(
    `UPDATE kuro_pay_payments
        SET commission_paid = 1, commission_payout_id = ?
      WHERE commission_aud IS NOT NULL AND commission_paid = 0 AND status = 'settled'`
  ).run(payoutId);
  return result.changes;
}

module.exports = { recordCommission, pendingTotal, getUnpaid, markPaid };
