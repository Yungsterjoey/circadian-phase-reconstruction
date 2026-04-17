/**
 * KURO Dynamic Tool Registry
 *
 * Per-user, in-memory ephemeral tool store. Tools created here are:
 *   - NEVER persisted to disk or DB (session-scoped, evaporate on restart)
 *   - Scoped to a single userId (no cross-user visibility)
 *   - Auto-evicted after `ttl_seconds` (default 6h, max 24h)
 *   - Unable to shadow a built-in tool name (static REGISTRY wins)
 *   - Unable to invoke another dynamic tool (prevents uncontrolled recursion)
 *
 * Action types:
 *   http_request  — GET/POST an external URL. Auth headers stripped by default.
 *   call_tool     — invoke a STATIC tool with templated args
 *   compose       — run a sequence of the above; {{steps.N.result}} interpolation
 *
 * Template substitution is done by simple `{{path.dot.notation}}` replacement
 * against a context that includes the caller's args and prior step outputs.
 *
 * Exports:
 *   create(userId, spec)     — register a dynamic tool
 *   remove(userId, name)     — evict a dynamic tool
 *   lookup(userId, name)     — return { schema, handler } or null
 *   list(userId)             — return [{ name, description, createdAt, expiresAt }]
 *   describe(userId, name)   — return full spec or null
 *   stats()                  — aggregate counts (for health / admin)
 */

'use strict';

const http  = require('http');
const https = require('https');

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_TOOLS_PER_USER   = 16;
const MAX_TTL_SECONDS      = 86400;  // 24h hard cap
const DEFAULT_TTL_SECONDS  = 21600;  // 6h
const MAX_HTTP_BYTES       = 262144; // 256 KB
const MAX_COMPOSE_STEPS    = 5;

// Reserved/static prefixes — prevent dynamic tools from shadowing them.
// Registry.cjs also does a direct collision check; this is a belt-and-braces list.
const RESERVED_PREFIXES = ['vfs.', 'runner.', 'vision.', 'tools.', 'search.'];

// ─── Per-user store ───────────────────────────────────────────────────────────
// userId → Map<toolName, { schema, description, action, createdAt, expiresAt, spec }>
const _store = new Map();

// Sweep expired tools every 5 min; .unref() so it never blocks shutdown.
setInterval(() => {
  const now = Date.now();
  for (const [uid, tools] of _store) {
    for (const [name, entry] of tools) {
      if (entry.expiresAt <= now) tools.delete(name);
    }
    if (tools.size === 0) _store.delete(uid);
  }
}, 300000).unref();

// ─── Helpers ──────────────────────────────────────────────────────────────────

class DynamicToolError extends Error {
  constructor(msg, code) { super(msg); this.name = 'DynamicToolError'; this.code = code || 'DYN_TOOL_ERR'; }
}

function _userTools(userId) {
  if (!_store.has(userId)) _store.set(userId, new Map());
  return _store.get(userId);
}

/**
 * Interpolate `{{path.dot.notation}}` references against a context object.
 * Missing paths render as empty string. Only JSON-safe values are stringified.
 */
function renderTemplate(template, ctx) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, p) => {
    const parts = p.split('.');
    let v = ctx;
    for (const k of parts) {
      if (v == null) return '';
      v = v[k];
    }
    if (v == null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

function renderObject(obj, ctx) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return renderTemplate(obj, ctx);
  if (Array.isArray(obj)) return obj.map(v => renderObject(v, ctx));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = renderObject(v, ctx);
    return out;
  }
  return obj;
}

/** Fetch with byte cap + timeout. No auth/cookie forwarding. */
function safeHttp({ method, url, headers = {}, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new DynamicToolError(`Bad URL: ${url}`, 'BAD_URL')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new DynamicToolError(`Disallowed scheme: ${parsed.protocol}`, 'BAD_SCHEME'));
    }

    const safeHeaders = {
      'User-Agent': 'KURO-DynamicTool/1',
      'Accept':     '*/*',
      ...headers,
    };
    // Strip dangerous forwarded headers unless caller explicitly provided them AT create-time
    // (headers is already the render()'d subset from the spec — trust it)
    delete safeHeaders['Cookie'];

    const lib = parsed.protocol === 'https:' ? https : http;
    let resolved = false;
    const finish = (v, err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (err) reject(v); else resolve(v);
    };
    const timer = setTimeout(() => finish(new DynamicToolError('Request timed out', 'TIMEOUT'), true), timeoutMs);

    const opts = { method, headers: safeHeaders, timeout: timeoutMs };
    const req = lib.request(url, opts, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.destroy();
        return finish(new DynamicToolError(`HTTP ${res.statusCode}`, 'HTTP_ERROR'), true);
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', (c) => {
        bytes += c.length;
        if (bytes > MAX_HTTP_BYTES) { res.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => finish({
        status:  res.statusCode,
        headers: res.headers,
        body:    Buffer.concat(chunks).toString('utf8'),
        truncated: bytes > MAX_HTTP_BYTES,
      }, false));
      res.on('error', e => finish(e, true));
    });
    req.on('error', e => finish(e, true));
    req.on('timeout', () => { req.destroy(); finish(new DynamicToolError('Socket timed out', 'TIMEOUT'), true); });
    if (body && method !== 'GET') req.write(body);
    req.end();
  });
}

// ─── Action executors ────────────────────────────────────────────────────────

async function execHttpRequest(action, ctx) {
  const url     = renderTemplate(action.url_template, ctx);
  const method  = action.method || 'GET';
  const headers = action.headers ? renderObject(action.headers, ctx) : {};
  let body;
  if (method === 'POST' && action.body_template) {
    body = renderTemplate(action.body_template, ctx);
    // If it parses as JSON, default Content-Type
    if (!headers['Content-Type']) {
      try { JSON.parse(body); headers['Content-Type'] = 'application/json'; } catch {}
    }
  }
  const res = await safeHttp({
    method,
    url,
    headers,
    body,
    timeoutMs: action.timeout_ms || 5000,
  });
  if (action.response === 'json') {
    try { return { ...res, body: JSON.parse(res.body) }; }
    catch { return res; } // fall back to text
  }
  return res;
}

async function execCallTool(action, ctx, { userId, db, staticRegistry }) {
  const toolName = action.tool;
  // CRITICAL: only static tools are callable from dynamic tools. No recursion.
  const entry = staticRegistry[toolName];
  if (!entry) throw new DynamicToolError(`call_tool: '${toolName}' is not a static tool`, 'UNKNOWN_STATIC_TOOL');
  const args = renderObject(action.args_template || {}, ctx);
  return entry.handler(args, userId, db);
}

async function execCompose(action, ctx, deps) {
  const results = [];
  for (let i = 0; i < action.steps.length; i++) {
    const step = action.steps[i];
    const stepCtx = { ...ctx, steps: results };
    let r;
    if (step.type === 'http_request')   r = await execHttpRequest(step, stepCtx);
    else if (step.type === 'call_tool') r = await execCallTool(step, stepCtx, deps);
    else throw new DynamicToolError(`compose: nested '${step.type}' not allowed inside compose`, 'NESTED_COMPOSE');
    results.push({ result: r });
  }
  return { steps: results, final: results[results.length - 1]?.result };
}

async function executeAction(action, args, deps) {
  const ctx = { ...args };
  switch (action.type) {
    case 'http_request': return execHttpRequest(action, ctx);
    case 'call_tool':    return execCallTool(action, ctx, deps);
    case 'compose':      return execCompose(action, ctx, deps);
    default: throw new DynamicToolError(`Unknown action type: ${action.type}`, 'BAD_ACTION');
  }
}

// ─── Spec validation ──────────────────────────────────────────────────────────

function validateSpec(spec, staticRegistry) {
  if (!spec || typeof spec !== 'object')      throw new DynamicToolError('spec must be an object', 'BAD_SPEC');
  const { name, description, input_schema, action } = spec;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) {
    throw new DynamicToolError('name must be dot.notation (lowercase)', 'BAD_NAME');
  }
  if (staticRegistry && staticRegistry[name]) {
    throw new DynamicToolError(`name '${name}' collides with a built-in tool`, 'NAME_COLLISION');
  }
  for (const p of RESERVED_PREFIXES) {
    if (name.startsWith(p)) throw new DynamicToolError(`name prefix '${p}' is reserved`, 'RESERVED_PREFIX');
  }
  if (typeof description !== 'string' || description.length < 10) {
    throw new DynamicToolError('description required (min 10 chars)', 'BAD_DESC');
  }
  if (!input_schema || typeof input_schema !== 'object' || input_schema.type !== 'object') {
    throw new DynamicToolError('input_schema must be a JSON schema of type "object"', 'BAD_SCHEMA');
  }
  if (!action || typeof action !== 'object' || !action.type) {
    throw new DynamicToolError('action.type required', 'BAD_ACTION');
  }
  if (!['http_request', 'call_tool', 'compose'].includes(action.type)) {
    throw new DynamicToolError(`unknown action.type '${action.type}'`, 'BAD_ACTION');
  }
  if (action.type === 'compose' && (!Array.isArray(action.steps) || action.steps.length > MAX_COMPOSE_STEPS)) {
    throw new DynamicToolError(`compose requires 1..${MAX_COMPOSE_STEPS} steps`, 'BAD_COMPOSE');
  }
  if (action.type === 'call_tool' && !staticRegistry[action.tool]) {
    throw new DynamicToolError(`action.tool '${action.tool}' is not a static tool`, 'UNKNOWN_STATIC_TOOL');
  }
  if (action.type === 'http_request' && typeof action.url_template !== 'string') {
    throw new DynamicToolError('http_request needs url_template', 'BAD_URL_TEMPLATE');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a dynamic tool for a user.
 * Returns the created entry (name, expiresAt).
 */
function create(userId, spec, staticRegistry) {
  if (!userId) throw new DynamicToolError('userId required', 'NO_USER');
  validateSpec(spec, staticRegistry);

  const tools = _userTools(userId);
  if (!tools.has(spec.name) && tools.size >= MAX_TOOLS_PER_USER) {
    throw new DynamicToolError(`Per-user tool limit reached (${MAX_TOOLS_PER_USER})`, 'LIMIT');
  }

  const ttlSec     = Math.min(Math.max(spec.ttl_seconds || DEFAULT_TTL_SECONDS, 60), MAX_TTL_SECONDS);
  const createdAt  = Date.now();
  const expiresAt  = createdAt + ttlSec * 1000;

  tools.set(spec.name, {
    schema:      spec.input_schema,
    description: spec.description,
    action:      spec.action,
    createdAt,
    expiresAt,
    spec, // keep original for describe()
  });

  return { name: spec.name, createdAt, expiresAt, ttl_seconds: ttlSec };
}

function remove(userId, name) {
  const tools = _store.get(userId);
  if (!tools || !tools.has(name)) return { removed: false };
  tools.delete(name);
  return { removed: true, name };
}

/** Lookup — returns { schema, handler, isDynamic } suitable for the executor. */
function lookup(userId, name, staticRegistry, db) {
  const tools = _store.get(userId);
  if (!tools) return null;
  const entry = tools.get(name);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { tools.delete(name); return null; }

  return {
    schema:    entry.schema,
    policyKey: '__dynamic__',
    isDynamic: true,
    handler: async (args, uid, dbArg) => {
      return executeAction(entry.action, args || {}, {
        userId:         uid || userId,
        db:             dbArg || db,
        staticRegistry: staticRegistry || {},
      });
    },
  };
}

function list(userId) {
  const tools = _store.get(userId);
  if (!tools) return [];
  const now = Date.now();
  const out = [];
  for (const [name, e] of tools) {
    if (e.expiresAt <= now) continue;
    out.push({
      name,
      description: e.description,
      action_type: e.action.type,
      createdAt:   e.createdAt,
      expiresAt:   e.expiresAt,
    });
  }
  return out;
}

function describe(userId, name) {
  const tools = _store.get(userId);
  if (!tools) return null;
  const e = tools.get(name);
  if (!e || e.expiresAt <= Date.now()) return null;
  return {
    name,
    description:  e.description,
    input_schema: e.schema,
    action:       e.action,
    createdAt:    e.createdAt,
    expiresAt:    e.expiresAt,
    is_dynamic:   true,
  };
}

function stats() {
  let users = 0, totalTools = 0;
  for (const [, m] of _store) { users++; totalTools += m.size; }
  return { users, totalTools };
}

module.exports = {
  create, remove, lookup, list, describe, stats,
  DynamicToolError,
  // exposed for testing/debug only
  _renderTemplate: renderTemplate,
  _renderObject:   renderObject,
};
