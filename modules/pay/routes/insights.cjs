'use strict';

const express = require('express');
const router = express.Router();

const insightEngine = require('../intelligence/insight_engine.cjs');
const oracle = require('../intelligence/oracle.cjs');
const events = require('../core/events.cjs');

/* ------------------------------------------------------------------ */
/*  GET /insights/latest — Return cached insight from DB               */
/* ------------------------------------------------------------------ */

router.get('/latest', (req, res) => {
  try {
    const latest = insightEngine.getLatest();

    if (!latest) {
      return res.json({
        ok: true,
        data: null,
        message: 'No insights generated yet. Cycle runs every 15 minutes.',
      });
    }

    // Parse payload if stored as string
    let payload = latest.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { /* keep as string */ }
    }

    return res.json({
      ok: true,
      data: {
        id: latest.id,
        generated_at: latest.generated_at,
        profile_used: latest.profile_used,
        insight: payload,
      },
    });
  } catch (err) {
    console.error('[PAY::Insights] latest error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /insights/refresh — Trigger oracle, stream as SSE             */
/* ------------------------------------------------------------------ */

router.post('/refresh', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendStage = (stage, detail) => {
    res.write(`data: ${JSON.stringify({ type: 'stage', stage, detail, timestamp: new Date().toISOString() })}\n\n`);
  };

  try {
    const sessionId = (req.user && req.user.userId) || req.ip || '__anonymous__';

    sendStage('gathering', 'Fetching market data and portfolio state...');

    sendStage('oracle', 'Querying sovereign oracle (deep profile)...');
    const oracleResult = await oracle.queryOracle(sessionId);

    sendStage('cycle', 'Running insight cycle...');
    const cycleResult = await insightEngine.generateCycleInsight();

    sendStage('complete', 'Insight generation finished.');

    res.write(`data: ${JSON.stringify({
      type: 'complete',
      oracle: oracleResult,
      cycle_insight: cycleResult,
      timestamp: new Date().toISOString(),
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[PAY::Insights] refresh error:', err.message || err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Insight refresh failed', timestamp: new Date().toISOString() })}\n\n`);
    res.end();
  }
});

/* ------------------------------------------------------------------ */
/*  GET /insights/stream — Persistent SSE for live events              */
/* ------------------------------------------------------------------ */

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial heartbeat
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  /* ---- Event listeners ---- */
  function onInsightReady(payload) {
    try {
      res.write(`data: ${JSON.stringify({ type: 'insight_ready', ...payload, timestamp: new Date().toISOString() })}\n\n`);
    } catch (_) {
      // Connection may be closed
    }
  }

  function onTransaction(payload) {
    try {
      res.write(`data: ${JSON.stringify({ type: 'transaction', ...payload, timestamp: new Date().toISOString() })}\n\n`);
    } catch (_) {
      // Connection may be closed
    }
  }

  // Register on the internal event bus
  events.on('insight_ready', onInsightReady);
  events.on('transaction', onTransaction);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 30_000);
  if (heartbeat.unref) heartbeat.unref();

  /* ---- Cleanup on disconnect ---- */
  req.on('close', () => {
    clearInterval(heartbeat);
    events.off('insight_ready', onInsightReady);
    events.off('transaction', onTransaction);
  });
});

module.exports = router;
