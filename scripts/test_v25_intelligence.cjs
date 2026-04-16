#!/usr/bin/env node
'use strict';
// v2.5 intelligence smoke — init schema, stub models, enqueue one task of each type,
// drain the worker, assert every row landed in 'done'. Exits 0 on success, 1 on failure.
// Must NOT talk to the real Ollama endpoint — use _setModelForTest stubs.

const os = require('os');
const path = require('path');
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_smoke_${Date.now()}.db`);

const ledger = require('../modules/pay/core/ledger.cjs');
ledger.initSchema();

const mn = require('../modules/pay/intelligence/merchant_normalizer.cjs');
const ad = require('../modules/pay/intelligence/anomaly_detector.cjs');
const tt = require('../modules/pay/intelligence/ticket_triager.cjs');
const worker = require('../modules/pay/intelligence/worker.cjs');

mn._setModelForTest(async () => '{"displayName":"Test","category":"other","confidence":0.8}');
ad._setModelForTest(async () => '{"flag":true,"reason":"smoke","severity":"info"}');
tt._setModelForTest(async () => '{"category":"other","severity":"low","prefilled_body":"smoke","suggested_resolution":""}');

(async () => {
  try {
    mn.enqueueIfNew({ merchant_account_number: '970436000000001', raw_name: 'SMOKE MERCHANT' });
    ad.enqueue({ payment_id: 'smoke-p1', user_id: 'smoke-u1', amount_aud: 75, merchant_id: '970436000000001', history: [] });
    tt.enqueue({ user_id: 'smoke-u1', payment_id: 'smoke-p1', user_message: 'smoke test ticket' });

    await worker.drain();

    const rows = ledger._db().prepare(
      'SELECT task_type, status, attempts, error FROM intelligence_queue ORDER BY task_type'
    ).all();

    console.log('\nQueue state after drain:');
    for (const r of rows) console.log(`  ${r.task_type.padEnd(20)} ${r.status.padEnd(10)} attempts=${r.attempts}` + (r.error ? ` error=${r.error}` : ''));

    const ok = rows.length === 3 && rows.every(r => r.status === 'done');
    console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAIL');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('SMOKE ERROR:', err && err.stack || err);
    process.exit(1);
  }
})();
