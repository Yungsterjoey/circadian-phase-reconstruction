/**
 * KURO::PREEMPT v2 Routes
 * 
 * RT-03: All endpoints require X-KURO-Token auth
 * RT-06: No message history from client — server-side session lookup
 */

const preempt = require('./preempt_engine.cjs');

function mountPreemptRoutes(app, logEvent, MODELS, validateToken, getSessionContext) {

  /**
   * RT-03: Auth middleware for preempt routes
   */
  function requireAuth(req, res, next) {
    const token = req.headers['x-kuro-token'] || req.body?.token;
    if (!token) return res.status(401).json({ error: 'Auth required' });

    // Use the same validateToken function as /api/stream
    const validation = validateToken(token);
    if (!validation || !validation.valid) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    req.kuroUser = validation.user || {};

    // RT-03: Dev mode speculation requires devAllowed
    if (req.body?.mode === 'dev' && !req.kuroUser.devAllowed) {
      return res.status(403).json({ error: 'Dev mode not permitted' });
    }

    next();
  }

  /**
   * POST /api/preempt/speculate
   * RT-03: Auth required
   * RT-06: Only sessionId + partialInput from client, context from server
   */
  app.post('/api/preempt/speculate', requireAuth, async (req, res) => {
    try {
      const { sessionId, partialInput, mode } = req.body;
      if (!sessionId || !partialInput) {
        return res.status(400).json({ error: 'Missing sessionId or partialInput' });
      }

      // Sanitize input length — don't speculate on novels
      if (partialInput.length > 1000) {
        return res.status(400).json({ error: 'Input too long for speculation' });
      }

      const modelKey = mode === 'dev' ? 'dev' : 'main';
      const modelConfig = {
        ...(MODELS[modelKey] || MODELS.main),
        mode: modelKey
      };

      // RT-06: Server-side context lookup, not client-supplied messages
      const result = await preempt.speculate(
        sessionId, partialInput, getSessionContext, modelConfig
      );

      if (logEvent) {
        logEvent('preempt_speculate', req, {
          sessionId,
          words: partialInput.split(/\s+/).length,
          action: result.action
        });
      }

      res.json(result);
    } catch (err) {
      console.error('[PREEMPT] speculate error:', err.message);
      res.status(500).json({ error: 'Speculation failed' });
    }
  });

  /**
   * POST /api/preempt/abort
   * RT-03: Auth required
   */
  app.post('/api/preempt/abort', requireAuth, (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) preempt.abortSpeculation(sessionId);
    res.json({ success: true });
  });

  console.log('[PREEMPT] v2 routes mounted (auth enforced)');
}

module.exports = mountPreemptRoutes;
