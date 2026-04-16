'use strict';
// §10 — admin-only intelligence queue monitoring.
// Factory accepts auth + admin middlewares so server.cjs can inject the
// DB-backed admin lookup used by the rest of /api/pay/admin.

const express = require('express');
const ledger = require('../core/ledger.cjs');
const iq = require('../core/intelligence_queue.cjs');

function buildRouter(requireAuth, requireAdmin) {
  const router = express.Router();
  router.use(requireAuth);
  router.use(requireAdmin);

  router.get('/queue', (_req, res) => {
    const db = ledger._db();

    const recent = db.prepare(
      `SELECT id, task_type, status, attempts, created_at, processed_at, error
         FROM intelligence_queue
         ORDER BY created_at DESC
         LIMIT 50`
    ).all();

    const byModule = db.prepare(
      `SELECT task_type,
              COUNT(*) FILTER (WHERE status='done')     AS done,
              COUNT(*) FILTER (WHERE status='failed')   AS failed,
              COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS in_flight,
              AVG(CASE WHEN status='done'
                        AND started_at IS NOT NULL
                        AND processed_at IS NOT NULL
                       THEN (julianday(processed_at) - julianday(started_at)) * 86400000.0
                  END) AS avg_latency_ms
         FROM intelligence_queue
        GROUP BY task_type`
    ).all();

    res.json({
      depth: iq.depth(),
      recent_events: recent,
      by_module: byModule,
    });
  });

  return router;
}

function mountMonitoringRoute(app, requireAuth, requireAdmin) {
  app.use('/api/pay/admin/monitoring', buildRouter(requireAuth, requireAdmin));
}

module.exports = { mountMonitoringRoute, buildRouter };
