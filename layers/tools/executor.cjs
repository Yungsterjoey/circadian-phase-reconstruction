/**
 * KURO Phase 3 — Tool Executor
 *
 * Validates args against JSON schema, enforces per-tool policies,
 * executes the handler with a hard timeout, truncates output, and
 * records every invocation in the tool_calls audit table.
 *
 * Wire format in:
 *   { kuro_tool_call: { id: string, name: string, args: object } }
 *
 * Wire format out:
 *   { kuro_tool_result: { id, name, ok, result, error, truncated } }
 *
 * Feature flags (read once at startup):
 *   KURO_JSON_TOOLS_ENABLED  — default true. If false, all calls return 503.
 *   KURO_JSON_TOOLS_ONLY     — default false. Governs XML compat (not checked here).
 */

'use strict';

const AjvModule = require('ajv');
const Ajv       = typeof AjvModule === 'function' ? AjvModule : (AjvModule.default || AjvModule);

const { REGISTRY }                                  = require('./registry.cjs');
const { POLICIES, PolicyError, enforcePolicy, truncateResult } = require('./policies.cjs');

// ─── Feature flag ─────────────────────────────────────────────────────────────
const JSON_TOOLS_ENABLED =
  (process.env.KURO_JSON_TOOLS_ENABLED ?? 'true').toLowerCase() !== 'false';

// ─── Pre-compile validators once at load ──────────────────────────────────────
const ajv = new Ajv({ strict: false, allErrors: true });
const VALIDATORS = {};
for (const [name, entry] of Object.entries(REGISTRY)) {
  try { VALIDATORS[name] = ajv.compile(entry.schema); }
  catch (e) { console.error(`[TOOLS] Schema compile error for ${name}:`, e.message); }
}

// ─── Audit helper ─────────────────────────────────────────────────────────────
function auditRecord(db, userId, toolName, args, output, status, ms, errMsg) {
  if (!db) return;
  try {
    db.prepare(
      'INSERT INTO tool_calls (user_id, ts, tool, input_json, output_json, status, ms) VALUES (?,?,?,?,?,?,?)',
    ).run(
      userId  || null,
      Date.now(),
      toolName,
      JSON.stringify(args   || {}),
      JSON.stringify(output !== undefined ? output : { error: errMsg }),
      status,
      ms,
    );
  } catch { /* non-fatal */ }
}

/**
 * Invoke a JSON tool call.
 *
 * @param {{ kuro_tool_call: { id, name, args } }} envelope
 * @param {string} userId
 * @param {object} db  — better-sqlite3 instance (may be null in tests)
 * @returns {{ kuro_tool_result: { id, name, ok, result, error, truncated } }}
 */
async function invoke(envelope, userId, db) {
  // ── Feature flag check ────────────────────────────────────────────────────
  if (!JSON_TOOLS_ENABLED) {
    return {
      kuro_tool_result: {
        id: null, name: null, ok: false,
        result: null,
        error: 'JSON tool protocol disabled (KURO_JSON_TOOLS_ENABLED=false)',
        truncated: false,
      },
    };
  }

  // ── Validate envelope ─────────────────────────────────────────────────────
  const tc = envelope?.kuro_tool_call;
  if (!tc || typeof tc !== 'object') {
    return {
      kuro_tool_result: {
        id: null, name: null, ok: false,
        result: null, error: 'INVALID_ENVELOPE: missing kuro_tool_call', truncated: false,
      },
    };
  }

  const { id = null, name, args = {} } = tc;
  if (!name || typeof name !== 'string') {
    return {
      kuro_tool_result: {
        id, name: null, ok: false,
        result: null, error: 'INVALID_TOOL: missing name', truncated: false,
      },
    };
  }

  const entry = REGISTRY[name];
  if (!entry) {
    return {
      kuro_tool_result: {
        id, name, ok: false,
        result: null, error: `UNKNOWN_TOOL: ${name}`, truncated: false,
      },
    };
  }

  const argsObj = (args && typeof args === 'object') ? args : {};

  // ── Schema validation ─────────────────────────────────────────────────────
  const validate = VALIDATORS[name];
  if (validate && !validate(argsObj)) {
    const errMsg = ajv.errorsText(validate.errors);
    auditRecord(db, userId, name, argsObj, null, 'schema_error', 0, errMsg);
    return {
      kuro_tool_result: {
        id, name, ok: false,
        result: null,
        error: `Schema validation failed: ${errMsg}`,
        truncated: false,
      },
    };
  }

  // ── Policy enforcement ────────────────────────────────────────────────────
  const policy   = POLICIES[entry.policyKey || name];
  const bytesIn  = Buffer.byteLength(JSON.stringify(argsObj), 'utf8');

  try {
    enforcePolicy(name, userId || 'anon', policy, bytesIn, argsObj);
  } catch (policyErr) {
    auditRecord(db, userId, name, argsObj, null, 'policy_error', 0, policyErr.message);
    return {
      kuro_tool_result: {
        id, name, ok: false,
        result: null, error: policyErr.message, truncated: false,
      },
    };
  }

  // ── Execute with timeout ──────────────────────────────────────────────────
  const ts         = Date.now();
  const timeoutMs  = policy?.timeout_ms || 30000;
  let result       = null;
  let error        = null;
  let truncated    = false;

  try {
    result = await Promise.race([
      entry.handler(argsObj, userId, db),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('TOOL_TIMEOUT')), timeoutMs),
      ),
    ]);

    // ── Truncate output ────────────────────────────────────────────────────
    const maxOut = policy?.max_bytes_out || 524288;
    ({ result, truncated } = truncateResult(result, maxOut));

  } catch (e) {
    error = e.message;
  }

  const ms     = Date.now() - ts;
  const status = error ? 'error' : 'ok';
  auditRecord(db, userId, name, argsObj, error ? null : result, status, ms, error);

  return {
    kuro_tool_result: {
      id,
      name,
      ok:        !error,
      result:    error ? null : result,
      error:     error || null,
      truncated,
    },
  };
}

module.exports = { invoke, JSON_TOOLS_ENABLED };
