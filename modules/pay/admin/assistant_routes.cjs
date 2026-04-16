'use strict';
// §4.5 / §7.5 — admin-gated HTTP entry for Henry's natural-language assistant.
// Accepts auth + admin middlewares via factory so server.cjs can inject the
// same DB-backed admin lookup used by the facilitator and /api/admin routes.

const express = require('express');
const aa = require('../intelligence/admin_assistant.cjs');

function buildRouter(authRequired, requireAdmin) {
  const router = express.Router();

  router.post('/assistant',
    express.json(),
    authRequired,
    requireAdmin,
    async (req, res) => {
      const question = String((req.body && req.body.question) || '').slice(0, 2000).trim();
      if (!question) return res.status(400).json({ error: 'question required' });
      const out = await aa.ask(question);
      res.json(out);
    }
  );

  return router;
}

function mountAssistantRoute(app, authRequired, requireAdmin) {
  app.use('/api/pay/admin', buildRouter(authRequired, requireAdmin));
}

module.exports = { mountAssistantRoute, buildRouter };
