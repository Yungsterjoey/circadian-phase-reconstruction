'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path');

// Isolate BOTH databases: auth DB (for kuro_pay_payments) and v2.5 DB (for pay_anomalies).
const stamp = Date.now();
process.env.KURO_DATA   = path.join(os.tmpdir(), `kuro_at_${stamp}`);
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_at_${stamp}.db`);

const ledger    = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();
const payLedger = require('../../../modules/pay/pay_ledger.cjs');   payLedger.initSchema();
const { db: authDb } = require('../../../layers/auth/db.cjs');
const tools = require('../../../modules/pay/intelligence/admin_tools.cjs');

test('get_stats returns aggregate object', () => {
  const out = tools.invoke('get_stats', { timeframe: 'today' });
  assert.ok(out.ok);
  assert.ok('payments_count' in out.data);
});

test('query_anomalies supports severity filter', () => {
  ledger._db().prepare(
    `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity) VALUES (?,?,?,?,?,?)`
  ).run('a1','u1','p1','heuristic','r','warn');
  const out = tools.invoke('query_anomalies', { severity: 'warn' });
  assert.strictEqual(out.data.length, 1);
});

test('query_payments reads from kuro_pay_payments (production table)', () => {
  authDb.prepare(
    `INSERT INTO kuro_pay_payments (id, user_id, status, merchant_account, merchant_name, amount_aud, currency)
     VALUES (?,?,?,?,?,?,?)`
  ).run('pp-1', 'u1', 'settled', '970436000000001', 'COFFEE CO', 4.25, 'AUD');
  const out = tools.invoke('query_payments', { user_id: 'u1' });
  assert.ok(out.ok);
  assert.strictEqual(out.data.length, 1);
  assert.strictEqual(out.data[0].id, 'pp-1');
  assert.strictEqual(out.data[0].merchant_name, 'COFFEE CO');
  assert.strictEqual(out.data[0].amount_aud, 4.25);
});

test('rejects unknown tool', () => {
  const out = tools.invoke('drop_database', {});
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /unknown tool/);
});

test('rejects args that look like SQL', () => {
  const out = tools.invoke('query_anomalies', { severity: "warn'; DROP TABLE users; --" });
  assert.strictEqual(out.ok, false);
});
