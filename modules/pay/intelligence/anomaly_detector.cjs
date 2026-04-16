'use strict';
// §4.2 — Async flagging. Info-only. Never blocks transactions. Copy is neutral.
const { randomUUID } = require('crypto');
const ledger = require('../core/ledger.cjs');
const iq = require('../core/intelligence_queue.cjs');
const worker = require('./worker.cjs');
const { ORCHESTRATOR, chat, safeParse } = require('./models.cjs');

const SYSTEM = [
  'Classify a single payment as noteworthy or not, given the user\'s 30-day history.',
  'Noteworthy: first payment >$50 to a new merchant, amount >3σ above mean, unusual time-of-day (3am-5am), or first payment in a new country.',
  'Copy must be neutral — never accusatory. Prefer "Heads up —" or "Just confirming".',
  'JSON only. Schema: {"flag":bool,"reason":string,"severity":"info"|"notice"|"warn"}.',
].join(' ');

const FALLBACK = { flag: false, reason: '', severity: 'info' };
const VALID_SEVERITY = new Set(['info', 'notice', 'warn']);

let _modelFn = async (system, user) => chat(ORCHESTRATOR, system, user);

function summariseHistory(history) {
  if (!history || !history.length) return { count: 0, mean: 0, stddev: 0 };
  const amounts = history.map(h => Number(h.amount_aud) || 0);
  const mean = amounts.reduce((s, x) => s + x, 0) / amounts.length;
  const variance = amounts.reduce((s, x) => s + (x - mean) ** 2, 0) / amounts.length;
  return { count: amounts.length, mean, stddev: Math.sqrt(variance) };
}

async function evaluate({ payment_id, user_id, amount_aud, merchant_id, history }) {
  let result = FALLBACK;
  try {
    const raw = await _modelFn(SYSTEM, {
      payment: { payment_id, amount_aud, merchant_id, at_iso: new Date().toISOString() },
      history_summary: summariseHistory(history),
    });
    result = safeParse(raw, FALLBACK);
    if (!VALID_SEVERITY.has(result.severity)) result.severity = 'info';
    if (typeof result.flag !== 'boolean') result.flag = false;
  } catch (_) {
    result = FALLBACK;
  }

  if (result.flag) {
    ledger._db().prepare(
      `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), user_id, payment_id, 'heuristic', result.reason || '', result.severity);
  }
  return result;
}

function enqueue({ payment_id, user_id, amount_aud, merchant_id, history }) {
  return iq.enqueue('anomaly_detect', { payment_id, user_id, amount_aud, merchant_id, history });
}

function listForUser(user_id, { unacknowledged_only = true } = {}) {
  const sql = unacknowledged_only
    ? `SELECT * FROM pay_anomalies WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC`
    : `SELECT * FROM pay_anomalies WHERE user_id=? ORDER BY created_at DESC`;
  return ledger._db().prepare(sql).all(user_id);
}

function acknowledge(id, user_id) {
  return ledger._db().prepare(
    `UPDATE pay_anomalies SET acknowledged=1 WHERE id=? AND user_id=?`
  ).run(id, user_id).changes;
}

worker.register('anomaly_detect', async (payload) => { await evaluate(payload); });

module.exports = {
  evaluate,
  enqueue,
  listForUser,
  acknowledge,
  _setModelForTest: fn => { _modelFn = fn; },
};
