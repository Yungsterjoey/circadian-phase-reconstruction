'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const os = require('os'); const path = require('path');
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_ar_${Date.now()}.db`);
require('../../../modules/pay/core/ledger.cjs').initSchema();

const aa = require('../../../modules/pay/intelligence/admin_assistant.cjs');
const { buildRouter } = require('../../../modules/pay/admin/assistant_routes.cjs');

function app({ authOk = true, isAdmin = true } = {}) {
  const a = express();
  a.use(express.json());
  const authRequired = (req, _res, next) => { if (!authOk) return _res.status(401).json({error:'auth'}); req.user = { userId: 'henry' }; next(); };
  const requireAdmin = (_req, res, next) => isAdmin ? next() : res.status(403).json({ error: 'admin only' });
  a.use('/admin', buildRouter(authRequired, requireAdmin));
  return a;
}

test('rejects non-admin with 403', async () => {
  const res = await request(app({ isAdmin: false })).post('/admin/assistant').send({ question: 'hi' });
  assert.strictEqual(res.status, 403);
});

test('rejects missing question with 400', async () => {
  const res = await request(app()).post('/admin/assistant').send({});
  assert.strictEqual(res.status, 400);
});

test('admin gets response from assistant', async () => {
  aa._setModelForTest(async (_cfg, sys) => sys.startsWith('You are the KUROPay admin') ? '{"tool":"none","args":{}}' : '{"answer":"ok"}');
  const res = await request(app()).post('/admin/assistant').send({ question: 'anything' });
  assert.strictEqual(res.status, 200);
  assert.match(res.body.answer, /Query failed|ok/);
});
