'use strict';
// §7.1 / §7.4 / §7.6 — user-facing intelligence endpoints.
// Factory accepts requireAuth so tests can stub and server.cjs can wire real auth.

const express = require('express');
const rs = require('../intelligence/receipt_search.cjs');
const fx = require('../intelligence/fx_explainer.cjs');
const ad = require('../intelligence/anomaly_detector.cjs');

function buildRouter(requireAuth) {
  const router = express.Router();

  router.use(express.json());
  router.use(requireAuth);

  router.post('/search', async (req, res) => {
    const q = String((req.body && req.body.q) || '').slice(0, 500);
    const filter = await rs.parse(q);
    res.json(filter);
  });

  router.post('/fx-copy', async (req, res) => {
    const { amount_aud, applied_rate, mid_rate } = req.body || {};
    if (!(Number(amount_aud) > 0)) return res.status(400).json({ error: 'amount_aud required' });
    const out = await fx.explain({ amount_aud, applied_rate, mid_rate });
    res.json(out);
  });

  router.get('/anomalies', (req, res) => {
    const user_id = req.user && req.user.userId;
    if (!user_id) return res.status(401).json({ error: 'auth required' });
    res.json(ad.listForUser(user_id, { unacknowledged_only: true }));
  });

  router.post('/anomalies/:id/ack', (req, res) => {
    const user_id = req.user && req.user.userId;
    if (!user_id) return res.status(401).json({ error: 'auth required' });
    const changed = ad.acknowledge(req.params.id, user_id);
    res.json({ acknowledged: changed > 0 });
  });

  return router;
}

function mountIntelRoutes(app, requireAuth) {
  app.use('/api/pay/intel', buildRouter(requireAuth));
}

module.exports = { mountIntelRoutes, buildRouter };
