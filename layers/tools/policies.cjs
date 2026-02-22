/**
 * KURO Phase 3 — Tool Policies
 *
 * Per-tool enforcement rules:
 *   max_calls_per_minute — in-memory sliding-window rate limit per userId
 *   max_bytes_in         — max size of serialised args payload
 *   max_bytes_out        — max size of serialised result (truncated if exceeded)
 *   timeout_ms           — hard timeout for handler execution
 *   cmd_pattern          — (runner.spawn) regex the `cmd` field must satisfy
 *   path_prefix          — (vfs.*) all path args must start with this prefix
 *
 * All limits are enforced BEFORE the handler executes.
 */

'use strict';

// ─── Policy table ─────────────────────────────────────────────────────────────
const POLICIES = {
  'vfs.list':  {
    max_calls_per_minute: 60,
    max_bytes_in:  1024,
    max_bytes_out: 65536,     // 64 KB directory listing
    timeout_ms:    10000,
    path_prefix:   '/',
  },
  'vfs.read':  {
    max_calls_per_minute: 60,
    max_bytes_in:  1024,
    max_bytes_out: 524288,    // 512 KB file content
    timeout_ms:    15000,
    path_prefix:   '/',
  },
  'vfs.write': {
    max_calls_per_minute: 20,
    max_bytes_in:  10485760,  // 10 MB — includes content field
    max_bytes_out: 512,
    timeout_ms:    30000,
    path_prefix:   '/',
  },
  'vfs.mkdir': {
    max_calls_per_minute: 20,
    max_bytes_in:  1024,
    max_bytes_out: 256,
    timeout_ms:    10000,
    path_prefix:   '/',
  },
  'vfs.rm':    {
    max_calls_per_minute: 20,
    max_bytes_in:  1024,
    max_bytes_out: 256,
    timeout_ms:    10000,
    path_prefix:   '/',
  },
  'vfs.mv':    {
    max_calls_per_minute: 20,
    max_bytes_in:  2048,
    max_bytes_out: 256,
    timeout_ms:    10000,
    path_prefix:   '/',
  },
  'vfs.stat':  {
    max_calls_per_minute: 60,
    max_bytes_in:  1024,
    max_bytes_out: 2048,
    timeout_ms:    10000,
    path_prefix:   '/',
  },
  'runner.spawn':  {
    max_calls_per_minute: 5,
    max_bytes_in:  4096,
    max_bytes_out: 512,
    timeout_ms:    8000,
    // cmd must be a safe filename: alphanumeric/dash/dot, .py or .js extension
    cmd_pattern:   /^[a-zA-Z0-9_\-.]+\.(py|js)$/,
  },
  'runner.status': {
    max_calls_per_minute: 60,
    max_bytes_in:  256,
    max_bytes_out: 1024,
    timeout_ms:    5000,
  },
  'runner.kill':   {
    max_calls_per_minute: 10,
    max_bytes_in:  256,
    max_bytes_out: 256,
    timeout_ms:    5000,
  },
  'runner.logs':   {
    max_calls_per_minute: 30,
    max_bytes_in:  512,
    max_bytes_out: 524288,
    timeout_ms:    5000,
  },
};

// ─── In-memory rate limit state: `userId:toolName` → [timestamps] ─────────────
const _rateLimitState = new Map();

// Trim state older than 2 min every 5 min to avoid memory growth
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [key, ts] of _rateLimitState) {
    const trimmed = ts.filter(t => t > cutoff);
    if (trimmed.length === 0) _rateLimitState.delete(key);
    else _rateLimitState.set(key, trimmed);
  }
}, 300000).unref(); // unref so this timer doesn't prevent process exit

class PolicyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PolicyError';
    this.code = code || 'POLICY_VIOLATION';
  }
}

/**
 * Enforce all policy rules for a tool invocation.
 * Throws PolicyError on any violation.
 *
 * @param {string} toolName    dot-notation name, e.g. 'vfs.read'
 * @param {string} userId
 * @param {object} policy      policy object from POLICIES[toolName]
 * @param {number} bytesIn     serialised byte-length of args
 * @param {object} args        raw args object (for allowlist checks)
 */
function enforcePolicy(toolName, userId, policy, bytesIn, args) {
  if (!policy) throw new PolicyError(`No policy defined for tool: ${toolName}`, 'NO_POLICY');

  // 1. Rate limit
  const key = `${userId}:${toolName}`;
  const now = Date.now();
  const cutoff = now - 60000;
  let ts = (_rateLimitState.get(key) || []).filter(t => t > cutoff);
  if (ts.length >= policy.max_calls_per_minute) {
    throw new PolicyError(
      `Rate limit exceeded: ${toolName} allows ${policy.max_calls_per_minute} calls/min`,
      'RATE_LIMIT',
    );
  }
  ts.push(now);
  _rateLimitState.set(key, ts);

  // 2. Input byte cap
  if (bytesIn > policy.max_bytes_in) {
    throw new PolicyError(
      `Args payload too large: ${bytesIn} bytes (max ${policy.max_bytes_in})`,
      'PAYLOAD_TOO_LARGE',
    );
  }

  // 3. Path prefix check (VFS tools)
  if (policy.path_prefix !== undefined) {
    const pathFields = [args.path, args.src, args.dst].filter(Boolean);
    for (const p of pathFields) {
      // Block directory traversal
      if (p.includes('..')) {
        throw new PolicyError(`Path traversal denied: ${p}`, 'PATH_TRAVERSAL');
      }
    }
  }

  // 4. runner.spawn cmd allowlist
  if (policy.cmd_pattern !== undefined && args.cmd !== undefined) {
    if (!policy.cmd_pattern.test(args.cmd)) {
      throw new PolicyError(
        `runner.spawn cmd rejected: '${args.cmd}' — must be a .py or .js filename`,
        'CMD_NOT_ALLOWED',
      );
    }
  }
}

/**
 * Truncate result if it exceeds max_bytes_out.
 * Returns { result, truncated }.
 */
function truncateResult(result, maxBytesOut) {
  const str = JSON.stringify(result);
  const bytes = Buffer.byteLength(str, 'utf8');
  if (bytes <= maxBytesOut) return { result, truncated: false };

  // Try to produce a partial result that fits
  const half = Math.floor(maxBytesOut / 2);
  const partial = str.slice(0, half);
  return {
    result: { _truncated: true, _original_bytes: bytes, _limit: maxBytesOut, partial },
    truncated: true,
  };
}

module.exports = { POLICIES, PolicyError, enforcePolicy, truncateResult };
