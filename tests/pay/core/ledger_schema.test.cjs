'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `pay_test_${Date.now()}.db`);
process.env.PAY_DB_PATH = tmp;

const ledger = require('../../../modules/pay/core/ledger.cjs');

test('initSchema creates v2.5 intelligence tables', () => {
  ledger.initSchema();
  const db = ledger._db();
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = rows.map(r => r.name);
  assert.ok(names.includes('merchant_cache'), 'merchant_cache missing');
  assert.ok(names.includes('pay_anomalies'), 'pay_anomalies missing');
  assert.ok(names.includes('support_tickets'), 'support_tickets missing');
  assert.ok(names.includes('intelligence_queue'), 'intelligence_queue missing');
});

test('pay_anomalies has severity CHECK constraint', () => {
  const db = ledger._db();
  assert.throws(() => {
    db.prepare(
      `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity) VALUES (?,?,?,?,?,?)`
    ).run('t1', 'u1', 'p1', 'x', 'y', 'catastrophe');
  }, /CHECK constraint failed/);
});

test.after(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
