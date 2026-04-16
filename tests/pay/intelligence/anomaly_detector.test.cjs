'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
const tmp = path.join(os.tmpdir(), `pay_an_${Date.now()}.db`);
process.env.PAY_DB_PATH = tmp;
const ledger = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();
const ad = require('../../../modules/pay/intelligence/anomaly_detector.cjs');

test('flags first payment >$50 to new merchant and persists row', async () => {
  ad._setModelForTest(async () => '{"flag":true,"reason":"First payment over $50 to this merchant","severity":"info"}');
  const r = await ad.evaluate({ payment_id: 'p1', user_id: 'u1', amount_aud: 75, merchant_id: 'm1', history: [] });
  assert.strictEqual(r.flag, true);
  assert.strictEqual(r.severity, 'info');
  const row = ledger._db().prepare('SELECT * FROM pay_anomalies WHERE payment_id=?').get('p1');
  assert.ok(row);
  assert.strictEqual(row.user_id, 'u1');
  assert.strictEqual(row.acknowledged, 0);
});

test('does not persist row when flag=false', async () => {
  ad._setModelForTest(async () => '{"flag":false,"reason":"","severity":"info"}');
  const r = await ad.evaluate({ payment_id: 'p2', user_id: 'u1', amount_aud: 2, merchant_id: 'm1', history: [{amount_aud:2},{amount_aud:3}] });
  assert.strictEqual(r.flag, false);
  const row = ledger._db().prepare('SELECT 1 FROM pay_anomalies WHERE payment_id=?').get('p2');
  assert.strictEqual(row, undefined);
});

test('swallows model error, returns safe fallback', async () => {
  ad._setModelForTest(async () => { throw new Error('x'); });
  const r = await ad.evaluate({ payment_id: 'p3', user_id: 'u1', amount_aud: 5, merchant_id: 'm2', history: [] });
  assert.strictEqual(r.flag, false);
});

test('coerces invalid severity to info', async () => {
  ad._setModelForTest(async () => '{"flag":true,"reason":"suspicious","severity":"critical"}');
  const r = await ad.evaluate({ payment_id: 'p4', user_id: 'u2', amount_aud: 100, merchant_id: 'm3', history: [] });
  assert.strictEqual(r.severity, 'info');
  const row = ledger._db().prepare('SELECT severity FROM pay_anomalies WHERE payment_id=?').get('p4');
  assert.strictEqual(row.severity, 'info');
});

test('listForUser returns unacknowledged anomalies by default', () => {
  const rows = ad.listForUser('u1');
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(r => r.acknowledged === 0));
});

test('acknowledge flips the bit', () => {
  const row = ledger._db().prepare('SELECT id FROM pay_anomalies WHERE user_id=? LIMIT 1').get('u1');
  const changed = ad.acknowledge(row.id, 'u1');
  assert.strictEqual(changed, 1);
  const refetched = ledger._db().prepare('SELECT acknowledged FROM pay_anomalies WHERE id=?').get(row.id);
  assert.strictEqual(refetched.acknowledged, 1);
});

test('acknowledge rejects cross-user attempts', () => {
  const row = ledger._db().prepare('SELECT id FROM pay_anomalies WHERE acknowledged=0 LIMIT 1').get();
  if (!row) { assert.ok(true, 'no unacked rows remain'); return; }
  const changed = ad.acknowledge(row.id, 'someone_else');
  assert.strictEqual(changed, 0);
});

test('enqueue returns an id', () => {
  const id = ad.enqueue({ payment_id: 'p5', user_id: 'u1', amount_aud: 10, merchant_id: 'm4', history: [] });
  assert.ok(id);
});

test.after(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
