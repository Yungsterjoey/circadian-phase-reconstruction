/**
 * KURO Web Fetcher
 *
 * Unified fetch + search helper used by web_routes.cjs.
 * Wraps the search adapter, enforces per-user rate limits,
 * and logs every call to tool_calls as "web.search".
 *
 * ENV:
 *   KURO_WEB_ENABLED      — default true
 *   KURO_WEB_MAX_RESULTS  — default 5, hard cap 10
 *   KURO_WEB_TIMEOUT_MS   — default 4000
 *   KURO_WEB_MAX_TOKENS   — default 2000 (approx chars of injected context)
 *   KURO_WEB_RATE_LIMIT   — calls per minute per user, default 10
 */

'use strict';

const { DuckDuckGoAdapter }  = require('./web_duckduckgo_adapter.cjs');

// ─── Config ───────────────────────────────────────────────────────────────────
const WEB_ENABLED    = (process.env.KURO_WEB_ENABLED     ?? 'true').toLowerCase() !== 'false';
const MAX_RESULTS    = Math.min(parseInt(process.env.KURO_WEB_MAX_RESULTS  || '5',  10), 10);
const TIMEOUT_MS     = parseInt(process.env.KURO_WEB_TIMEOUT_MS   || '4000', 10);
const MAX_TOKENS     = parseInt(process.env.KURO_WEB_MAX_TOKENS   || '2000', 10);
const RATE_PER_MIN   = parseInt(process.env.KURO_WEB_RATE_LIMIT   || '10',   10);

// ─── Rate limit state ─────────────────────────────────────────────────────────
const _rateState = new Map(); // userId → [timestamps]
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, ts] of _rateState) {
    const t = ts.filter(x => x > cutoff);
    if (!t.length) _rateState.delete(k); else _rateState.set(k, t);
  }
}, 120000).unref();

function checkRateLimit(userId) {
  const now    = Date.now();
  const cutoff = now - 60000;
  let ts = (_rateState.get(userId) || []).filter(t => t > cutoff);
  if (ts.length >= RATE_PER_MIN) {
    throw Object.assign(new Error(`Web search rate limit: ${RATE_PER_MIN} req/min`), { code: 'RATE_LIMIT' });
  }
  ts.push(now);
  _rateState.set(userId, ts);
}

// ─── Adapter (singleton) ──────────────────────────────────────────────────────
const adapter = new DuckDuckGoAdapter();

/**
 * Audit a web search call in tool_calls.
 */
function audit(db, userId, query, results, status, ms, errMsg) {
  if (!db) return;
  try {
    db.prepare(
      'INSERT INTO tool_calls (user_id, ts, tool, input_json, output_json, status, ms) VALUES (?,?,?,?,?,?,?)',
    ).run(
      userId || null,
      Date.now(),
      'web.search',
      JSON.stringify({ query }),
      JSON.stringify(results || { error: errMsg }),
      status,
      ms,
    );
  } catch { /* non-fatal */ }
}

/**
 * Build the context injection string for the chat pipeline.
 * Truncates to MAX_TOKENS characters (approximate).
 */
function buildContextInjection(results) {
  if (!results || !results.length) return '';

  let lines = ['=== WEB CONTEXT ==='];
  let chars  = lines[0].length;
  let truncated = false;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const block = `[${i + 1}] ${r.title} — ${r.url}\n    ${r.snippet}`;
    if (chars + block.length + 1 > MAX_TOKENS) {
      truncated = true;
      break;
    }
    lines.push(block);
    chars += block.length + 1;
  }

  lines.push('=== END WEB CONTEXT ===');
  if (truncated) lines.push('[truncated]');
  return lines.join('\n');
}

/**
 * Main search function.
 * @param {string} query
 * @param {string} userId
 * @param {object|null} db — better-sqlite3 instance for auditing
 * @returns {Promise<{ results, context, truncated }>}
 */
async function webSearch(query, userId, db) {
  if (!WEB_ENABLED) {
    throw Object.assign(new Error('Web search disabled (KURO_WEB_ENABLED=false)'), { code: 'DISABLED' });
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw Object.assign(new Error('query is required'), { code: 'INVALID_QUERY' });
  }

  checkRateLimit(userId || 'anon');

  const ts = Date.now();
  let results = [];
  let status  = 'ok';
  let errMsg  = null;

  try {
    results = await adapter.search(query.trim(), { maxResults: MAX_RESULTS, timeoutMs: TIMEOUT_MS });
  } catch (e) {
    status = 'error';
    errMsg = e.message;
    audit(db, userId, query, null, status, Date.now() - ts, errMsg);
    throw e;
  }

  audit(db, userId, query, results, status, Date.now() - ts, null);

  const context   = buildContextInjection(results);
  const truncated = context.includes('[truncated]');

  return { results, context, truncated };
}

module.exports = { webSearch, buildContextInjection, WEB_ENABLED, MAX_RESULTS, RATE_PER_MIN };
