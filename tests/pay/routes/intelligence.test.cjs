'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const os = require('os'); const path = require('path');
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_ir_${Date.now()}.db`);
const ledger = require('../../../modules/pay/core/ledger.cjs'); ledger.initSchema();

const rs = require('../../../modules/pay/intelligence/receipt_search.cjs');
const fx = require('../../../modules/pay/intelligence/fx_explainer.cjs');
const ad = require('../../../modules/pay/intelligence/anomaly_detector.cjs');
const { buildRouter } = require('../../../modules/pay/routes/intelligence.cjs');

function app({ authed = true } = {}) {
  const a = express();
  a.use(express.json());
  const requireAuth = (req, res, next) => {
    if (!authed) return res.status(401).json({ error: 'auth' });
    req.user = { userId: 'u1' };
    next();
  };
  a.use('/intel', buildRouter(requireAuth));
  return a;
}

test('POST /intel/search parses NL query', async () => {
  rs._setModelForTest(async () => '{"keywords":["coffee"],"merchant_category":["cafe"]}');
  const res = await request(app()).post('/intel/search').send({ q: 'coffee' });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.keywords, ['coffee']);
});

test('POST /intel/fx-copy returns copy', async () => {
  fx._setModelForTest(async () => '{"copy":"dynamic copy"}');
  const res = await request(app()).post('/intel/fx-copy').send({ amount_aud: 5, applied_rate: 0.00005, mid_rate: 0.00005 });
  assert.strictEqual(res.status, 200);
  assert.match(res.body.copy, /dynamic|You pay/);
});

test('POST /intel/fx-copy rejects missing amount with 400', async () => {
  const res = await request(app()).post('/intel/fx-copy').send({});
  assert.strictEqual(res.status, 400);
});

test('GET /intel/anomalies returns unacked for user', async () => {
  ledger._db().prepare(
    `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity, acknowledged) VALUES (?,?,?,?,?,?,?)`
  ).run('x1','u1','p1','heuristic','r','warn', 0);
  const res = await request(app()).get('/intel/anomalies');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.length, 1);
});

test('POST /intel/anomalies/:id/ack acknowledges', async () => {
  ledger._db().prepare(
    `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity, acknowledged) VALUES (?,?,?,?,?,?,?)`
  ).run('x2','u1','p2','heuristic','r','notice', 0);
  const res = await request(app()).post('/intel/anomalies/x2/ack');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.acknowledged, true);
});

test('POST /intel/anomalies/:id/ack wrong user returns acknowledged:false', async () => {
  ledger._db().prepare(
    `INSERT INTO pay_anomalies (id, user_id, payment_id, flag_type, reason, severity, acknowledged) VALUES (?,?,?,?,?,?,?)`
  ).run('x3','u2','p3','heuristic','r','notice', 0);
  const res = await request(app()).post('/intel/anomalies/x3/ack');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.acknowledged, false);
});

test('rejects unauthed with 401', async () => {
  const res = await request(app({ authed: false })).post('/intel/search').send({ q: 'x' });
  assert.strictEqual(res.status, 401);
});
