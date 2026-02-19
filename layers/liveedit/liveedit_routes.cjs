/**
 * KURO::LIVE EDIT — Express Routes
 * 
 * Mount into server.cjs:
 *   const mountLiveEditRoutes = require('./layers/liveedit_routes.cjs');
 *   mountLiveEditRoutes(app, logEvent);
 * 
 * Endpoints:
 *   POST /api/stream/correct — Submit mid-stream correction
 *   GET  /api/stream/status  — Active stream count
 * 
 * v6.3 compliance: Audited, rate-limited, no filesystem IO.
 */

const streamController = require('./stream_controller.cjs');

function mountLiveEditRoutes(app, logEvent) {

  // ── POST /api/stream/correct ─────────────────────────────────────────
  // Body: { sessionId: string, correction: string }
  // Returns: { accepted: boolean, phrase?: string, reason?: string }
  app.post('/api/stream/correct', (req, res) => {
    const { sessionId, correction } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ accepted: false, reason: 'Missing sessionId' });
    }
    if (!correction?.trim()) {
      return res.status(400).json({ accepted: false, reason: 'Missing correction' });
    }

    // Capture partial content BEFORE submitting (abort clears it)
    const partialContent = streamController.getPartial(sessionId) || '';
    const result = streamController.submitCorrection(sessionId, correction, logEvent);
    // Include partial so client can give the model context about what was already generated
    res.json({ ...result, partialContent });
  });

  // ── GET /api/stream/status ───────────────────────────────────────────
  app.get('/api/stream/status', (req, res) => {
    res.json(streamController.status());
  });

  console.log('[LIVE_EDIT] Routes mounted: /api/stream/{correct,status}');
}

module.exports = mountLiveEditRoutes;
