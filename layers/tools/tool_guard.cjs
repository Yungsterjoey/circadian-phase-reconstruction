'use strict';
/**
 * KURO::ToolGuard — Phase 8 Enterprise Hardening, Commit 2
 *
 * Guards /api/tools/invoke with:
 *   - Execution depth guard  (MAX_DEPTH, default 1 — blocks tool→tool recursion)
 *   - Per-user concurrency limit
 *   - Circuit breaker (trips when error rate exceeds threshold)
 *   - Memory pressure guard
 *
 * All thresholds are env-configurable and degrade gracefully (never throws).
 */

const MAX_DEPTH          = parseInt(process.env.KURO_TOOL_MAX_DEPTH    || '1',    10);
const MAX_CONCURRENT     = parseInt(process.env.KURO_TOOL_MAX_CONC     || '3',    10);
const CB_THRESHOLD       = parseFloat(process.env.KURO_TOOL_CB_THRESH  || '0.5');     // error fraction
const CB_WINDOW_MS       = parseInt(process.env.KURO_TOOL_CB_WINDOW_MS || '60000', 10);
const CB_MIN_CALLS       = parseInt(process.env.KURO_TOOL_CB_MIN_CALLS || '5',    10);
const CB_RESET_MS        = parseInt(process.env.KURO_TOOL_CB_RESET_MS  || '30000', 10);
const MEMORY_PRESSURE_MB = parseInt(process.env.KURO_TOOL_MEM_MB       || '1800',  10);

// ── Per-user state ────────────────────────────────────────────────────────────
const userActive = new Map(); // userId → active invocation count

// ── Circuit breaker state ─────────────────────────────────────────────────────
const cb = { calls: [], tripped: false, trippedAt: 0 };

function _cbRecord(ok) {
  const now = Date.now();
  cb.calls.push({ ts: now, ok });
  cb.calls = cb.calls.filter(c => now - c.ts <= CB_WINDOW_MS);
  if (cb.tripped) return;
  if (cb.calls.length < CB_MIN_CALLS) return;
  const errRate = cb.calls.filter(c => !c.ok).length / cb.calls.length;
  if (errRate >= CB_THRESHOLD) {
    cb.tripped = true;
    cb.trippedAt = now;
    console.error(`[TOOL_GUARD] Circuit breaker OPEN: error_rate=${(errRate * 100).toFixed(0)}% calls=${cb.calls.length}`);
  }
}

function _cbCheck() {
  if (!cb.tripped) return true;
  if (Date.now() - cb.trippedAt > CB_RESET_MS) {
    cb.tripped = false;
    cb.calls = [];
    console.log('[TOOL_GUARD] Circuit breaker RESET');
    return true;
  }
  return false;
}

// ── Core guard logic ──────────────────────────────────────────────────────────

/**
 * Validate before execution.
 * @param {string} userId
 * @param {number} incomingDepth  — value from X-KURO-Call-Depth header
 * @returns {{ ok: boolean, status?: number, error?: string }}
 */
function precheck(userId, incomingDepth = 0) {
  if (!_cbCheck()) {
    return { ok: false, status: 503, error: 'Tool system temporarily unavailable (circuit breaker open)' };
  }
  try {
    const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    if (heapMb > MEMORY_PRESSURE_MB) {
      return { ok: false, status: 503, error: `Server under memory pressure (${heapMb.toFixed(0)} MB) — retry shortly` };
    }
  } catch { /* non-fatal */ }

  if (incomingDepth >= MAX_DEPTH) {
    return { ok: false, status: 429, error: `Tool recursion depth limit (max=${MAX_DEPTH}) exceeded` };
  }
  if ((userActive.get(userId) || 0) >= MAX_CONCURRENT) {
    return { ok: false, status: 429, error: `Concurrent tool limit (max=${MAX_CONCURRENT}) exceeded` };
  }
  return { ok: true };
}

function enter(userId) {
  userActive.set(userId, (userActive.get(userId) || 0) + 1);
}

function exit(userId, resultOk) {
  userActive.set(userId, Math.max(0, (userActive.get(userId) || 1) - 1));
  if (resultOk !== undefined) _cbRecord(resultOk);
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Express middleware for /api/tools/invoke.
 * Reads X-KURO-Call-Depth header to detect nested/recursive calls.
 */
function toolGuardMiddleware(req, res, next) {
  const userId = req.user?.userId || 'anon';
  const depth  = Math.max(0, parseInt(req.headers['x-kuro-call-depth'] || '0', 10) || 0);

  const check = precheck(userId, depth);
  if (!check.ok) {
    console.error(`[TOOL_GUARD] Blocked userId=${userId} depth=${depth} status=${check.status} reason=${check.error}`);
    return res.status(check.status).json({ error: check.error, guard: 'tool_guard' });
  }

  enter(userId);

  let done = false;
  function finish(ok) { if (!done) { done = true; exit(userId, ok); } }
  res.on('finish', () => finish(res.statusCode < 400));
  res.on('close',  () => finish(false)); // connection dropped before response

  next();
}

module.exports = { toolGuardMiddleware, precheck, enter, exit };
