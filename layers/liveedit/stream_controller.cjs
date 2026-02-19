/**
 * KURO::LIVE EDIT — Stream Controller
 * 
 * Strategy A: Abort & Restart
 * 
 * How it works:
 *   1. /api/stream registers session in activeStreams with AbortController
 *   2. /api/stream/correct sets correction + aborts current stream
 *   3. Stream ends with {type:"aborted_for_correction", correction}
 *   4. Client auto-restarts /api/stream with correction appended
 *   5. Feels like mid-stream pivot, but is deterministic and safe
 * 
 * Safety:
 *   - Single writer per SSE response (never write from /correct)
 *   - req.on('close') cleanup prevents leaked entries
 *   - TTL sweep every 60s catches orphans
 *   - Rate limit: max 5 corrections/min per session
 *   - Max phrase length: 120 chars
 *   - Every correction audited via v6.3 chain
 * 
 * v6.3 compliance:
 *   - Routed through audit chain
 *   - No exec, no writes to filesystem
 *   - Pure in-memory state management
 */

// ─── Active Streams Registry ─────────────────────────────────────────────
// Map<sessionId, StreamEntry>
const activeStreams = new Map();

const MAX_CORRECTIONS_PER_MIN = 5;
const MAX_PHRASE_LENGTH = 120;
const STREAM_TTL_MS = 300000; // 5 min max stream lifetime
const CLEANUP_INTERVAL_MS = 60000;

/**
 * @typedef {Object} StreamEntry
 * @property {string} sessionId
 * @property {string} requestId
 * @property {import('http').ServerResponse} res - SSE response (only stream handler writes)
 * @property {AbortController} abortController
 * @property {string|null} correction - pending correction phrase
 * @property {number} createdAt
 * @property {number[]} correctionTimestamps - for rate limiting
 * @property {string} partialContent - content generated before correction
 * @property {boolean} alive
 */

// ─── Register Stream ─────────────────────────────────────────────────────

function registerStream(sessionId, requestId, res, abortController) {
  // Clean up any stale entry for this session
  const existing = activeStreams.get(sessionId);
  if (existing?.alive) {
    existing.abortController.abort();
    existing.alive = false;
  }

  const entry = {
    sessionId,
    requestId,
    res,
    abortController,
    correction: null,
    createdAt: Date.now(),
    correctionTimestamps: [],
    partialContent: '',
    alive: true,
  };

  activeStreams.set(sessionId, entry);

  return entry;
}

// ─── Unregister (on stream end or client disconnect) ─────────────────────

function unregisterStream(sessionId) {
  const entry = activeStreams.get(sessionId);
  if (entry) {
    entry.alive = false;
    activeStreams.delete(sessionId);
  }
}

// ─── Submit Correction ───────────────────────────────────────────────────

function submitCorrection(sessionId, phrase, auditFn) {
  const entry = activeStreams.get(sessionId);

  if (!entry || !entry.alive) {
    return { accepted: false, reason: 'No active stream for this session' };
  }

  // Sanitize phrase
  const cleaned = (phrase || '').trim().slice(0, MAX_PHRASE_LENGTH);
  if (cleaned.length < 3) {
    return { accepted: false, reason: 'Correction too short (min 3 chars)' };
  }

  // Rate limit: max N corrections per minute
  const now = Date.now();
  entry.correctionTimestamps = entry.correctionTimestamps.filter(t => now - t < 60000);
  if (entry.correctionTimestamps.length >= MAX_CORRECTIONS_PER_MIN) {
    return { accepted: false, reason: 'Rate limit: max 5 corrections per minute' };
  }

  entry.correctionTimestamps.push(now);
  entry.correction = cleaned;

  // Audit the correction
  if (auditFn) {
    auditFn({
      agent: 'liveedit',
      action: 'correction',
      meta: {
        sessionId,
        requestId: entry.requestId,
        phrase: cleaned,
        partialTokens: entry.partialContent.split(/\s+/).length,
      },
    });
  }

  // Abort the current generation — stream handler detects this
  entry.abortController.abort();

  return { accepted: true, phrase: cleaned };
}

// ─── Check for Pending Correction ────────────────────────────────────────
// Called by stream handler between chunks

function checkCorrection(sessionId) {
  const entry = activeStreams.get(sessionId);
  if (!entry) return null;
  return entry.correction;
}

// ─── Update Partial Content ──────────────────────────────────────────────
// Stream handler calls this as tokens arrive

function appendPartial(sessionId, token) {
  const entry = activeStreams.get(sessionId);
  if (entry) {
    entry.partialContent += token;
  }
}

// ─── Get Partial Content (for restart context) ───────────────────────────

function getPartial(sessionId) {
  const entry = activeStreams.get(sessionId);
  return entry?.partialContent || '';
}

// ─── Is Session Active ───────────────────────────────────────────────────

function isActive(sessionId) {
  const entry = activeStreams.get(sessionId);
  return entry?.alive || false;
}

// ─── Status ──────────────────────────────────────────────────────────────

function status() {
  return {
    activeStreams: activeStreams.size,
    sessions: Array.from(activeStreams.keys()),
  };
}

// ─── TTL Cleanup Sweep ───────────────────────────────────────────────────

function cleanup() {
  const now = Date.now();
  for (const [sid, entry] of activeStreams) {
    if (now - entry.createdAt > STREAM_TTL_MS) {
      entry.alive = false;
      if (!entry.abortController.signal.aborted) {
        entry.abortController.abort();
      }
      activeStreams.delete(sid);
    }
  }
}

// Start periodic cleanup
const _cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
// Don't hold process open
if (_cleanupTimer.unref) _cleanupTimer.unref();


module.exports = {
  registerStream,
  unregisterStream,
  submitCorrection,
  checkCorrection,
  appendPartial,
  getPartial,
  isActive,
  status,
  cleanup,
  MAX_CORRECTIONS_PER_MIN,
  MAX_PHRASE_LENGTH,
};
