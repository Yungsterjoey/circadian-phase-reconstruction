'use strict';
// §4.5 + §8.2 — READ-ONLY whitelisted tools. No raw SQL ever reaches the model.
// Every tool: validate args, build prepared statement with placeholders, return structured data.
//
// DB routing (post-fix for dual-DB split):
//   - kuro_pay_payments lives in the AUTH db (layers/auth/db.cjs)
//     — this is where production payments actually land (x402 + Stripe)
//   - pay_anomalies lives in the v2.5 db (modules/pay/core/ledger.cjs)
//     — intelligence layer owns this table end-to-end
const ledger = require('../core/ledger.cjs');
const { db: authDb } = require('../../../layers/auth/db.cjs');

const SQL_META = /[;'"\\]|--|\/\*|\*\//;  // any SQL meta-char in a scalar arg => reject

function validateScalar(v) {
  if (v == null) return true;
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'string' && v.length <= 100 && !SQL_META.test(v)) return true;
  return false;
}

function query_payments({ status, user_id, limit = 20 } = {}) {
  const clauses = []; const args = [];
  if (status) { clauses.push('status=?'); args.push(status); }
  if (user_id) { clauses.push('user_id=?'); args.push(user_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Math.max(1, Number(limit) || 20), 200);
  return authDb.prepare(
    `SELECT id, created_at, user_id, status, currency,
            merchant_account, merchant_name,
            amount_aud, amount_vnd,
            network, settled_at, error
       FROM kuro_pay_payments ${where}
      ORDER BY created_at DESC
      LIMIT ?`
  ).all(...args, lim);
}

function query_anomalies({ severity, user_id, acknowledged, limit = 20 } = {}) {
  const clauses = []; const args = [];
  if (severity) { clauses.push('severity=?'); args.push(severity); }
  if (user_id) { clauses.push('user_id=?'); args.push(user_id); }
  if (acknowledged === 0 || acknowledged === 1) { clauses.push('acknowledged=?'); args.push(acknowledged); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Math.max(1, Number(limit) || 20), 200);
  return ledger._db().prepare(
    `SELECT id, user_id, payment_id, flag_type, reason, severity, acknowledged, created_at FROM pay_anomalies ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...args, lim);
}

function get_stats({ timeframe = 'today' } = {}) {
  const bounds = { today: "date('now')", '7d': "date('now','-7 days')", '30d': "date('now','-30 days')" }[timeframe];
  if (!bounds) throw new Error('invalid timeframe');
  const v25 = ledger._db();
  return {
    timeframe,
    payments_count:  authDb.prepare(`SELECT COUNT(*) AS c FROM kuro_pay_payments WHERE date(created_at) >= ${bounds}`).get().c,
    payments_failed: authDb.prepare(`SELECT COUNT(*) AS c FROM kuro_pay_payments WHERE status='failed' AND date(created_at) >= ${bounds}`).get().c,
    anomalies_warn:  v25.prepare(`SELECT COUNT(*) AS c FROM pay_anomalies WHERE severity='warn' AND date(created_at) >= ${bounds}`).get().c,
  };
}

const TOOLS = {
  query_payments:  { fn: query_payments,  schema: ['status','user_id','limit'] },
  query_anomalies: { fn: query_anomalies, schema: ['severity','user_id','acknowledged','limit'] },
  get_stats:       { fn: get_stats,       schema: ['timeframe'] },
};

function invoke(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  for (const k of Object.keys(args || {})) {
    if (!tool.schema.includes(k)) return { ok: false, error: `unknown arg ${k} for ${name}` };
    if (!validateScalar(args[k])) return { ok: false, error: `invalid value for ${k}` };
  }
  try {
    return { ok: true, data: tool.fn(args) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function listToolsForModel() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, args: t.schema }));
}

module.exports = { invoke, listToolsForModel, _TOOLS: TOOLS };
