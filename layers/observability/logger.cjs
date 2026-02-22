'use strict';
/**
 * KURO::Logger — Phase 8 Enterprise Hardening, Commit 3
 *
 * Structured JSON logging + request correlation IDs.
 *
 * Log lines are newline-delimited JSON to stdout, parseable by
 * log aggregators (Loki, Splunk, CloudWatch, etc.).
 *
 * Format: { ts, level, event, correlationId?, userId?, ...fields }
 *
 * Usage:
 *   const { log, requestMiddleware } = require('./layers/observability/logger.cjs');
 *   app.use(requestMiddleware);
 *   log('info', 'chat_request', { userId, tokens });
 */

const crypto = require('crypto');

const LOG_LEVEL = (process.env.KURO_LOG_LEVEL || 'info').toLowerCase();
const LEVELS    = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[LOG_LEVEL] ?? 1;

function _emit(level, event, fields = {}) {
  if ((LEVELS[level] ?? 1) < MIN_LEVEL) return;
  const line = JSON.stringify({
    ts:    new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const log = {
  debug: (event, fields) => _emit('debug', event, fields),
  info:  (event, fields) => _emit('info',  event, fields),
  warn:  (event, fields) => _emit('warn',  event, fields),
  error: (event, fields) => _emit('error', event, fields),
};

// ── Request correlation middleware ────────────────────────────────────────────

/**
 * Express middleware: assign a correlation ID to every request.
 * Sets req.correlationId and X-Correlation-ID response header.
 */
function requestMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id']
    || crypto.randomBytes(8).toString('hex');
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const start = Date.now();
  res.on('finish', () => {
    // Skip noisy health/keepalive paths
    if (req.path === '/health' || req.path === '/api/health') return;
    _emit('info', 'http_request', {
      correlationId,
      method:  req.method,
      path:    req.path,
      status:  res.statusCode,
      ms:      Date.now() - start,
      userId:  req.user?.userId || undefined,
    });
  });

  next();
}

// ── Timing spans ──────────────────────────────────────────────────────────────

/**
 * Start a timing span.
 * @param {string} name
 * @param {object} [baseFields]
 * @returns {{ end(fields?: object): number }}  returns elapsed ms
 */
function startSpan(name, baseFields = {}) {
  const t = Date.now();
  return {
    end(fields = {}) {
      const ms = Date.now() - t;
      _emit('debug', `span:${name}`, { ...baseFields, ...fields, ms });
      return ms;
    },
  };
}

module.exports = { log, requestMiddleware, startSpan };
