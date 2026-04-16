'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
const tmp = path.join(os.tmpdir(), `pay_iq_${Date.now()}.db`);
process.env.PAY_DB_PATH = tmp;

const ledger = require('../../../modules/pay/core/ledger.cjs');
ledger.initSchema();
const iq = require('../../../modules/pay/core/intelligence_queue.cjs');

test('enqueue returns id and stores pending row', () => {
  const id = iq.enqueue('merchant_normalize', { merchant_account_number: '123' });
  assert.ok(id, 'should return id');
  const row = ledger._db().prepare('SELECT * FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.task_type, 'merchant_normalize');
  assert.deepStrictEqual(JSON.parse(row.payload_json), { merchant_account_number: '123' });
  assert.strictEqual(row.attempts, 0);
});

test('claimNext returns oldest pending and marks processing, increments attempts', () => {
  const claimed = iq.claimNext();
  assert.ok(claimed, 'should return a task');
  assert.strictEqual(claimed.status, 'processing');
  assert.strictEqual(claimed.attempts, 1);
  assert.deepStrictEqual(claimed.payload, { merchant_account_number: '123' });
});

test('claimNext returns null when empty', () => {
  assert.strictEqual(iq.claimNext(), null);
});

test('complete marks task done', () => {
  const id = iq.enqueue('anomaly_detect', { payment_id: 'p1' });
  const c = iq.claimNext();
  iq.complete(c.id);
  const row = ledger._db().prepare('SELECT status, processed_at FROM intelligence_queue WHERE id=?').get(c.id);
  assert.strictEqual(row.status, 'done');
  assert.ok(row.processed_at);
});

test('fail first two attempts → pending again, third → failed', () => {
  const id = iq.enqueue('anomaly_detect', { payment_id: 'p2' });
  let c = iq.claimNext(); iq.fail(c.id, 'boom1');
  let row = ledger._db().prepare('SELECT status, attempts, error FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.attempts, 1);
  assert.strictEqual(row.error, 'boom1');

  c = iq.claimNext(); iq.fail(c.id, 'boom2');
  row = ledger._db().prepare('SELECT status, attempts FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.attempts, 2);

  c = iq.claimNext(); iq.fail(c.id, 'boom3');
  row = ledger._db().prepare('SELECT status, attempts, error FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.attempts, 3);
  assert.strictEqual(row.error, 'boom3');
});

test('depth counts pending + processing', () => {
  iq.enqueue('x', {});
  iq.enqueue('x', {});
  const d = iq.depth();
  assert.ok(d >= 2, `depth should be >=2, got ${d}`);
});

test.after(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
