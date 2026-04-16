'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const os = require('os'); const path = require('path');
process.env.PAY_DB_PATH = path.join(os.tmpdir(), `pay_mon_${Date.now()}.db`);
require('../../../modules/pay/core/ledger.cjs').initSchema();
const { buildRouter } = require('../../../modules/pay/routes/monitoring.cjs');

function app({ authed = true, admin = true } = {}) {
  const a = express();
  a.use(express.json());
  const requireAuth  = (req, _res, next) => { if (!authed) return _res.status(401).json({error:'auth'}); req.user = { userId:'henry' }; next(); };
  const requireAdmin = (_req, res, next) => admin ? next() : res.status(403).json({ error: 'admin only' });
  a.use('/mon', buildRouter(requireAuth, requireAdmin));
  return a;
}

test('queue stats endpoint returns depth + recent_events + by_module', async () => {
  const res = await request(app()).get('/mon/queue');
  assert.strictEqual(res.status, 200);
  assert.ok('depth' in res.body);
  assert.ok('recent_events' in res.body);
  assert.ok('by_module' in res.body);
  assert.ok(Array.isArray(res.body.recent_events));
  assert.ok(Array.isArray(res.body.by_module));
});

test('forbidden without admin', async () => {
  const res = await request(app({ admin: false })).get('/mon/queue');
  assert.strictEqual(res.status, 403);
});

test('forbidden without auth', async () => {
  const res = await request(app({ authed: false })).get('/mon/queue');
  assert.strictEqual(res.status, 401);
});
