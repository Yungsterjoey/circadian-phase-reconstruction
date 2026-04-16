'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
const tmp = path.join(os.tmpdir(), `pay_worker_${Date.now()}.db`);
process.env.PAY_DB_PATH = tmp;

const ledger = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();
const iq = require('../../../modules/pay/core/intelligence_queue.cjs');
const worker = require('../../../modules/pay/intelligence/worker.cjs');

test('worker runs registered handler once per task', async () => {
  const seen = [];
  worker.register('test_task', async (payload) => { seen.push(payload); });
  iq.enqueue('test_task', { n: 1 });
  iq.enqueue('test_task', { n: 2 });
  await worker.drain();
  assert.deepStrictEqual(seen.map(s => s.n).sort(), [1, 2]);
  const rows = ledger._db().prepare("SELECT status FROM intelligence_queue WHERE task_type='test_task'").all();
  assert.ok(rows.every(r => r.status === 'done'), 'all should be done');
});

test('worker marks task failed after MAX_ATTEMPTS handler throws', async () => {
  worker.register('boom', async () => { throw new Error('nope'); });
  const id = iq.enqueue('boom', {});
  await worker.drain(); // attempt 1 fails → pending
  await worker.drain(); // attempt 2 fails → pending
  await worker.drain(); // attempt 3 fails → failed
  const row = ledger._db().prepare('SELECT status, attempts, error FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.attempts, 3);
  assert.match(row.error, /nope/);
});

test('unregistered task_type marks row failed immediately (after retry limit)', async () => {
  const id = iq.enqueue('no_handler_here', { x: 1 });
  await worker.drain();
  await worker.drain();
  await worker.drain();
  const row = ledger._db().prepare('SELECT status, error FROM intelligence_queue WHERE id=?').get(id);
  assert.strictEqual(row.status, 'failed');
  assert.match(row.error, /no handler/);
});

test.after(() => { try { fs.unlinkSync(tmp); } catch (_) {} });
