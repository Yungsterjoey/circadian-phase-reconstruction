'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path');
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_at_${Date.now()}.db`);
const ledger = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();
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

test('rejects unknown tool', () => {
  const out = tools.invoke('drop_database', {});
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /unknown tool/);
});

test('rejects args that look like SQL', () => {
  const out = tools.invoke('query_anomalies', { severity: "warn'; DROP TABLE users; --" });
  assert.strictEqual(out.ok, false);
});
