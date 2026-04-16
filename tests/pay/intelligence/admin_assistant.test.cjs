'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path');

// Isolate BOTH databases so admin_tools' auth-DB path resolves under test.
const stamp = Date.now();
process.env.KURO_DATA   = path.join(os.tmpdir(), `kuro_aa_${stamp}`);
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_aa_${stamp}.db`);

const ledger    = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();
const payLedger = require('../../../modules/pay/pay_ledger.cjs');   payLedger.initSchema();
const { db: authDb } = require('../../../layers/auth/db.cjs');
const aa = require('../../../modules/pay/intelligence/admin_assistant.cjs');

test('ask uses tool result in response', async () => {
  authDb.prepare(
    `INSERT INTO kuro_pay_payments (id, user_id, status, amount_aud, currency)
     VALUES ('KP-1', 'u1', 'failed', 45, 'AUD')`
  ).run();
  let step = 0;
  aa._setModelForTest(async (_sys, _user) => {
    step++;
    if (step === 1) return '{"tool":"query_payments","args":{"status":"failed","limit":5}}';
    return '{"answer":"1 failed transaction today (KP-1 · AUD $45)"}';
  });
  const r = await aa.ask('Show me today\'s failed transactions');
  assert.match(r.answer, /KP-1/);
});

test('rejects tool call outside whitelist', async () => {
  aa._setModelForTest(async () => '{"tool":"drop_users","args":{}}');
  const r = await aa.ask('delete users');
  assert.match(r.answer, /Query failed/);
});

test('fails gracefully on model error', async () => {
  aa._setModelForTest(async () => { throw new Error('boom'); });
  const r = await aa.ask('anything');
  assert.match(r.answer, /Query failed/);
});
