'use strict';

/* ------------------------------------------------------------------ */
/*  KURO::PAY — Addiction Mirror                                       */
/*  In-memory session tracking. Resets on server restart.              */
/*  NEVER blocks execution. Awareness state only.                      */
/* ------------------------------------------------------------------ */

const sessions = new Map();   // sessionId -> { txn_count, spend_aud_cents, first_activity, last_activity }

const THRESHOLD_AUD  = Number(process.env.PAY_AWARENESS_THRESHOLD_AUD)  || 200;
const THRESHOLD_TXNS = Number(process.env.PAY_AWARENESS_THRESHOLD_TXNS) || 5;

/* ------------------------------------------------------------------ */
/*  recordActivity                                                     */
/* ------------------------------------------------------------------ */

function recordActivity(sessionId, amountCents) {
  try {
    const now = Date.now();
    const existing = sessions.get(sessionId);

    if (existing) {
      existing.txn_count += 1;
      existing.spend_aud_cents += Math.abs(amountCents || 0);
      existing.last_activity = now;
    } else {
      sessions.set(sessionId, {
        txn_count: 1,
        spend_aud_cents: Math.abs(amountCents || 0),
        first_activity: now,
        last_activity: now,
      });
    }
  } catch (_) {
    // Never blocks execution
  }
}

/* ------------------------------------------------------------------ */
/*  getStats                                                           */
/* ------------------------------------------------------------------ */

function getStats(sessionId) {
  const entry = sessions.get(sessionId);

  if (!entry) {
    return {
      txns: 0,
      spend_aud: 0,
      duration_min: 0,
      should_surface_awareness: false,
    };
  }

  const spendAud = entry.spend_aud_cents / 100;
  const durationMin = Math.round((entry.last_activity - entry.first_activity) / 60_000);

  const shouldSurface =
    entry.spend_aud_cents > (THRESHOLD_AUD * 100) ||
    entry.txn_count > THRESHOLD_TXNS;

  return {
    txns: entry.txn_count,
    spend_aud: spendAud,
    duration_min: durationMin,
    should_surface_awareness: shouldSurface,
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  recordActivity,
  getStats,
  // Exposed for testing
  _sessions: sessions,
};
