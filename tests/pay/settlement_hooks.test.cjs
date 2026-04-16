'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path');
const Database = require('better-sqlite3');

// Isolate v2.5 intelligence DB in tmp
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_sh_${Date.now()}.db`);
require('../../modules/pay/core/ledger.cjs').initSchema();
const iq = require('../../modules/pay/core/intelligence_queue.cjs');

// Set up an in-memory kuro_pay_payments DB mimicking auth.db
const memDB = new Database(':memory:');
memDB.exec(`
  CREATE TABLE kuro_pay_payments (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    status TEXT,
    merchant_account TEXT,
    merchant_name TEXT,
    amount_aud REAL,
    x402_receipt_json TEXT,
    settled_at DATETIME
  );
`);
memDB.prepare(`INSERT INTO kuro_pay_payments (id, user_id, status, merchant_account, merchant_name, amount_aud) VALUES (?,?,?,?,?,?)`)
  .run('p1', 'u1', 'pending', '970436012345678', 'TRUNG NGUYEN COFFEE', 4.25);

const ledger = require('../../modules/pay/pay_ledger.cjs');

test('updatePaymentSettled enqueues intelligence tasks', () => {
  const before = iq.depth();
  ledger.updatePaymentSettled(memDB, 'p1', '{"receipt":"x"}');

  // Row is marked settled
  const row = memDB.prepare(`SELECT status FROM kuro_pay_payments WHERE id=?`).get('p1');
  assert.strictEqual(row.status, 'settled');

  const after = iq.depth();
  assert.strictEqual(after - before, 2); // merchant_normalize + anomaly_detect
});

test('updatePaymentSettled does not enqueue merchant_normalize when merchant missing', () => {
  memDB.prepare(`INSERT INTO kuro_pay_payments (id, user_id, status) VALUES ('p2','u1','pending')`).run();
  const before = iq.depth();
  ledger.updatePaymentSettled(memDB, 'p2', null);
  const after = iq.depth();
  // Only anomaly_detect enqueued, not merchant_normalize
  assert.strictEqual(after - before, 1);
});
