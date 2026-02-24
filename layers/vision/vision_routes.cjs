/**
 * KURO::VISION — Express Routes
 * 
 * Mount into existing server.cjs:
 *   const visionRoutes = require('./layers/vision_routes.cjs');
 *   visionRoutes(app, logEvent);
 * 
 * Endpoints:
 *   POST /api/vision/generate  — SSE stream: full vision pipeline
 *   GET  /api/vision/status    — GPU mutex + storage stats
 *   GET  /api/vision/image/:fn — Serve generated image (fenced)
 *   POST /api/vision/cleanup   — Manual retention cleanup
 * 
 * v6.3 compliance: All audited, fenced to /var/lib/kuro/vision/.
 */

const path = require('path');
const fs = require('fs');
const { generate } = require('./vision_orchestrator.cjs');
const gpuMutex = require('./vision_gpu_mutex.cjs');
const storage = require('./vision_storage.cjs');

function mountVisionRoutes(app, logEvent, authMiddleware, tierGate, preflightVisionVRAM) {

  // ── POST /api/vision/generate ────────────────────────────────────────
  // SSE stream. Body: { prompt, sessionId?, profile?, seed?, width?, height?, steps? }
  // TIER GATE: Pro+ only (free tier gets 1 sample/day via quota, but route requires auth)
  app.post('/api/vision/generate', async (req, res) => {
    // Auth check — vision requires authenticated user
    const user = req.user;
    if (!user || !user.userId) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Authentication required for image generation.' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // Tier check — free users get vision_daily quota (1/day), Pro/Sovereign get more
    const userTier = user.tier || 'free';
    if (tierGate?.checkQuota) {
      const quota = tierGate.checkQuota(user.userId, userTier, 'vision');
      if (!quota.allowed) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        res.write(`data: ${JSON.stringify({
          type: 'error',
          message: userTier === 'free'
            ? 'Free tier image generation limit reached. Upgrade to Pro for more.'
            : `Daily image generation limit reached (${quota.limit}). Resets tomorrow.`,
          quota: { used: quota.used, limit: quota.limit, tier: userTier },
          upgrade_url: userTier === 'free' ? '/api/stripe/checkout' : null
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      }
    }

    const profile = req.body.profile || 'lab';

    // Profile gate: gov cannot use vision by default (tier 1 = read-only)
    if (profile === 'gov') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Vision generation not available in Government profile' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // Backpressure: reject if GPU already locked
    const mutexState = gpuMutex.isLocked();
    if (mutexState.locked) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({
        type: 'vision_busy',
        message: 'Vision pipeline is currently processing another request. Please try again shortly.',
        elapsed: mutexState.elapsed
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Handle client disconnect
    req.on('close', () => {
      // Will be cleaned up by orchestrator's finally block
    });

    // VRAM preflight gate (right before FLUX pipeline)
    if (typeof preflightVisionVRAM === 'function') {
      try {
        await preflightVisionVRAM({
          preset: req.body?.preset || 'draft',
          n: req.body?.n || 1,
        });
      } catch (e) {
        console.warn(`[VISION:PREFLIGHT] failed: ${e.message}`);
      }
    }

    await generate(req, res, logEvent);

    // Record usage for quota tracking
    if (tierGate?.recordUsage && user?.userId) {
      tierGate.recordUsage(user.userId, 'vision');
    }

    res.end();
  });

  // ── GET /api/vision/status ───────────────────────────────────────────
  app.get('/api/vision/status', (req, res) => {
    const mutex = gpuMutex.isLocked();
    const stats = storage.stats();
    res.json({
      gpu: mutex,
      storage: stats,
      ready: !mutex.locked
    });
  });

  // ── GET /api/vision/image/:filename ──────────────────────────────────
  // Fenced to VISION_DIR only
  app.get('/api/vision/image/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // sanitize
    if (!filename.startsWith('vision_') || !filename.endsWith('.png')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(storage.VISION_DIR, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filepath).pipe(res);
  });

  // ── POST /api/vision/cleanup ─────────────────────────────────────────
  app.post('/api/vision/cleanup', (req, res) => {
    const profile = req.body.profile || 'lab';
    const result = storage.cleanup(profile);

    if (logEvent) {
      logEvent({
        agent: 'vision',
        action: 'cleanup',
        meta: result
      });
    }

    res.json(result);
  });

  // ── GET /api/vision/session/:id ──────────────────────────────────────
  app.get('/api/vision/session/:id', (req, res) => {
    const session = storage.loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  console.log('[VISION] Routes mounted: /api/vision/{generate,status,image,cleanup,session}');
}

module.exports = mountVisionRoutes;
