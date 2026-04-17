/**
 * KURO Phase 3 — Tool Registry
 *
 * Maps dot-notation tool names to their JSON schema + handler.
 * Handlers call the underlying adapters DIRECTLY (no audit logging here —
 * that is the executor's responsibility to avoid duplicate tool_calls rows).
 *
 * Exported:
 *   REGISTRY        — static tool registry (startup-loaded)
 *   SCHEMAS         — { [toolName]: jsonSchema }
 *   lookup(name, userId, db) — merged static + per-user dynamic lookup
 *   listAll(userId) — flat array of { name, description, isDynamic? } for all tools
 *                     visible to a user, used by `tools.list`
 */

'use strict';

const https = require('https');
const http  = require('http');

// ─── Raw tool implementations (no logging wrappers) ───────────────────────────
const { VFS_TOOLS }    = require('./vfs_tools.cjs');
const { RUNNER_TOOLS } = require('./runner_tools.cjs');

// Web search (used by search.web / search.news handlers)
let webFetcher = null;
try { webFetcher = require('../web/web_fetcher.cjs'); } catch {}

// Dynamic tool registry (per-user, in-memory)
const dynamicRegistry = require('./dynamic_registry.cjs');

// Vision orchestrator — loaded lazily (GPU-heavy, may not be present)
let visionOrchestrator = null;
try { visionOrchestrator = require('../vision/vision_orchestrator.cjs'); } catch(e) {}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const SCHEMAS = {
  'vision.generate': require('./schemas/vision.generate.json'),
  'vfs.list':      require('./schemas/vfs.list.json'),
  'vfs.read':      require('./schemas/vfs.read.json'),
  'vfs.write':     require('./schemas/vfs.write.json'),
  'vfs.mkdir':     require('./schemas/vfs.mkdir.json'),
  'vfs.rm':        require('./schemas/vfs.rm.json'),
  'vfs.mv':        require('./schemas/vfs.mv.json'),
  'vfs.stat':      require('./schemas/vfs.stat.json'),
  'runner.spawn':  require('./schemas/runner.spawn.json'),
  'runner.status': require('./schemas/runner.status.json'),
  'runner.kill':   require('./schemas/runner.kill.json'),
  'runner.logs':   require('./schemas/runner.logs.json'),
  'search.web':    require('./schemas/search.web.json'),
  'search.fetch':  require('./schemas/search.fetch.json'),
  'search.news':   require('./schemas/search.news.json'),
  'tools.list':     require('./schemas/tools.list.json'),
  'tools.describe': require('./schemas/tools.describe.json'),
  'tools.create':   require('./schemas/tools.create.json'),
  'tools.remove':   require('./schemas/tools.remove.json'),
};

// ─── Helpers (search.fetch) ───────────────────────────────────────────────────
function fetchUrl(url, { timeoutMs = 5000, maxBytes = 65536 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error(`Bad URL: ${url}`)); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reject(new Error(`Disallowed scheme: ${parsed.protocol}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    let resolved = false;
    const finish = (v, err) => { if (resolved) return; resolved = true; clearTimeout(timer); err ? reject(v) : resolve(v); };
    const timer = setTimeout(() => finish(new Error('TIMEOUT'), true), timeoutMs);

    const req = lib.get(url, {
      headers: { 'User-Agent': 'KURO-Fetch/1', 'Accept': 'text/html,*/*' },
      timeout: timeoutMs,
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.destroy();
        return finish(new Error(`REDIRECT_TO:${res.headers.location}`), true);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        return finish(new Error(`HTTP ${res.statusCode}`), true);
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', c => { bytes += c.length; if (bytes > maxBytes) { res.destroy(); return; } chunks.push(c); });
      res.on('end', () => finish({ body: Buffer.concat(chunks).toString('utf8'), bytes, truncated: bytes > maxBytes }, false));
      res.on('error', e => finish(e, true));
    });
    req.on('error', e => finish(e, true));
    req.on('timeout', () => { req.destroy(); finish(new Error('TIMEOUT'), true); });
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Registry: toolName → { schema, policyKey, handler } ─────────────────────
const REGISTRY = {
  // ── VFS ────────────────────────────────────────────────────────────────────
  'vfs.list': {
    schema:    SCHEMAS['vfs.list'],
    policyKey: 'vfs.list',
    async handler(args, userId /*, db */) {
      return VFS_TOOLS.vfs_list.run({ path: args.path || '' }, userId);
    },
  },
  'vfs.read': {
    schema:    SCHEMAS['vfs.read'],
    policyKey: 'vfs.read',
    async handler(args, userId /*, db */) {
      return VFS_TOOLS.vfs_read.run(args, userId);
    },
  },
  'vfs.write': {
    schema:    SCHEMAS['vfs.write'],
    policyKey: 'vfs.write',
    async handler(args, userId /*, db */) {
      return VFS_TOOLS.vfs_write.run(args, userId);
    },
  },
  'vfs.mkdir': {
    schema:    SCHEMAS['vfs.mkdir'],
    policyKey: 'vfs.mkdir',
    async handler(args, userId /*, db */) {
      return VFS_TOOLS.vfs_mkdir.run(args, userId);
    },
  },
  'vfs.rm': {
    schema:    SCHEMAS['vfs.rm'],
    policyKey: 'vfs.rm',
    async handler(args, userId /*, db */) {
      return VFS_TOOLS.vfs_rm.run(args, userId);
    },
  },
  'vfs.mv': {
    schema:    SCHEMAS['vfs.mv'],
    policyKey: 'vfs.mv',
    async handler(args, userId /*, db */) {
      const { S3VfsAdapter } = require('../vfs/vfs_s3_adapter.cjs');
      const adapter = new S3VfsAdapter(userId);
      await adapter.mv(args.src, args.dst);
      return { ok: true, src: args.src, dst: args.dst };
    },
  },
  'vfs.stat': {
    schema:    SCHEMAS['vfs.stat'],
    policyKey: 'vfs.stat',
    async handler(args, userId /*, db */) {
      const { S3VfsAdapter } = require('../vfs/vfs_s3_adapter.cjs');
      const adapter = new S3VfsAdapter(userId);
      return adapter.stat(args.path);
    },
  },

  // ── Runner ─────────────────────────────────────────────────────────────────
  'runner.spawn': {
    schema:    SCHEMAS['runner.spawn'],
    policyKey: 'runner.spawn',
    async handler(args, userId, db) {
      return RUNNER_TOOLS.runner_spawn.run(args, userId, db);
    },
  },
  'runner.status': {
    schema:    SCHEMAS['runner.status'],
    policyKey: 'runner.status',
    async handler(args, userId, db) {
      return RUNNER_TOOLS.runner_status.run(args, userId, db);
    },
  },
  'runner.kill': {
    schema:    SCHEMAS['runner.kill'],
    policyKey: 'runner.kill',
    async handler(args, userId, db) {
      return RUNNER_TOOLS.runner_kill.run(args, userId, db);
    },
  },
  'runner.logs': {
    schema:    SCHEMAS['runner.logs'],
    policyKey: 'runner.logs',
    async handler(args, userId, db) {
      return RUNNER_TOOLS.runner_logs.run(args, userId, db);
    },
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  'search.web': {
    schema:    SCHEMAS['search.web'],
    policyKey: 'search.web',
    async handler(args, userId, db) {
      if (!webFetcher || !webFetcher.WEB_ENABLED) {
        throw new Error('Web search disabled on this server (KURO_WEB_ENABLED=false)');
      }
      const { query, top_k = 5, include_context = false } = args;
      const { results, context, truncated } = await webFetcher.webSearch(query, userId, db);
      const trimmed = results.slice(0, top_k);
      const out = { query, results: trimmed, truncated };
      if (include_context) out.context = context;
      return out;
    },
  },
  'search.fetch': {
    schema:    SCHEMAS['search.fetch'],
    policyKey: 'search.fetch',
    async handler(args /*, userId, db */) {
      const { url, max_bytes = 65536, strip_html = true, timeout_ms = 5000 } = args;
      const { body, bytes, truncated } = await fetchUrl(url, { timeoutMs: timeout_ms, maxBytes: max_bytes });
      const text = strip_html ? stripHtml(body) : body;
      return { url, bytes, truncated, content: text };
    },
  },
  'search.news': {
    schema:    SCHEMAS['search.news'],
    policyKey: 'search.news',
    async handler(args, userId, db) {
      if (!webFetcher || !webFetcher.WEB_ENABLED) {
        throw new Error('News search disabled on this server (KURO_WEB_ENABLED=false)');
      }
      // Bias query toward news by appending a time qualifier. DDG HTML adapter doesn't
      // expose a native time filter, so this is best-effort — truly recent results
      // require a dedicated news adapter which can be slotted in later.
      const nudge = { day: 'last 24 hours', week: 'this week', month: 'this month' }[args.recency || 'week'];
      const augmented = `${args.query} news ${nudge}`;
      const { results, truncated } = await webFetcher.webSearch(augmented, userId, db);
      return { query: args.query, recency: args.recency || 'week', results: results.slice(0, args.top_k || 5), truncated };
    },
  },

  // ── Meta-tools (introspection + dynamic tool management) ───────────────────
  'tools.list': {
    schema:    SCHEMAS['tools.list'],
    policyKey: 'tools.list',
    async handler(args, userId /*, db */) {
      const { prefix, include_schema = false, include_dynamic = true } = args || {};
      const out = [];
      for (const [name, entry] of Object.entries(REGISTRY)) {
        if (prefix && !name.startsWith(prefix)) continue;
        const item = {
          name,
          description: entry.schema?.description || entry.schema?.title || '',
          source:      'static',
        };
        if (include_schema) item.input_schema = entry.schema;
        out.push(item);
      }
      if (include_dynamic && userId) {
        for (const d of dynamicRegistry.list(userId)) {
          if (prefix && !d.name.startsWith(prefix)) continue;
          const item = {
            name:        d.name,
            description: d.description,
            source:      'dynamic',
            action_type: d.action_type,
            expiresAt:   d.expiresAt,
          };
          if (include_schema) {
            const full = dynamicRegistry.describe(userId, d.name);
            if (full) item.input_schema = full.input_schema;
          }
          out.push(item);
        }
      }
      return { count: out.length, tools: out };
    },
  },

  'tools.describe': {
    schema:    SCHEMAS['tools.describe'],
    policyKey: 'tools.describe',
    async handler(args, userId /*, db */) {
      const { name } = args;
      const staticEntry = REGISTRY[name];
      if (staticEntry) {
        return {
          name,
          source:       'static',
          description:  staticEntry.schema?.description || staticEntry.schema?.title || '',
          input_schema: staticEntry.schema,
        };
      }
      if (userId) {
        const dyn = dynamicRegistry.describe(userId, name);
        if (dyn) return { source: 'dynamic', ...dyn };
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  },

  'tools.create': {
    schema:    SCHEMAS['tools.create'],
    policyKey: 'tools.create',
    async handler(args, userId /*, db */) {
      if (!userId) throw new Error('tools.create requires an authenticated user');
      const entry = dynamicRegistry.create(userId, args, REGISTRY);
      return {
        ok:          true,
        name:        entry.name,
        expiresAt:   entry.expiresAt,
        ttl_seconds: entry.ttl_seconds,
        note:        'Ephemeral — lives only in this process, evaporates on server restart or TTL expiry.',
      };
    },
  },

  'tools.remove': {
    schema:    SCHEMAS['tools.remove'],
    policyKey: 'tools.remove',
    async handler(args, userId /*, db */) {
      const { name } = args;
      if (REGISTRY[name]) throw new Error(`Cannot remove built-in tool: ${name}`);
      const r = dynamicRegistry.remove(userId, name);
      if (!r.removed) throw new Error(`No dynamic tool named '${name}' for this user`);
      return r;
    },
  },

  // ── Vision ──────────────────────────────────────────────────────────────────
  'vision.generate': {
    schema:    SCHEMAS['vision.generate'],
    policyKey: 'vision.generate',
    async handler(args, userId /*, db */) {
      if (!visionOrchestrator) {
        throw new Error('Vision module not available');
      }

      // Collect SSE events from the orchestrator via mock req/res
      const events = [];
      const mockReq = {
        body: {
          prompt:          args.prompt,
          negative_prompt: args.negative_prompt,
          preset:          args.preset || 'draft',
          aspect_ratio:    args.aspect_ratio,
          width:           args.width,
          height:          args.height,
          steps:           args.steps,
          guidance_scale:  args.guidance_scale,
          n:               args.n || 1,
          seed:            args.seed,
          userTier: 'pro', // tool invocation requires Pro+ (enforced by RBAC)
          profile: 'lab',
        },
        user: { userId },
        on: () => {}, // no-op for 'close' handler
      };
      const mockRes = {
        write(raw) {
          const m = raw.match(/^data: (.+)\n\n$/);
          if (m) try { events.push(JSON.parse(m[1])); } catch {}
        },
        setHeader() {},
        flushHeaders() {},
        end() {},
      };

      await visionOrchestrator.generate(mockReq, mockRes, null);

      const result = events.find(e => e.type === 'vision_result');
      if (result) {
        return {
          imageUrl: `/api/vision/image/${result.filename}`,
          filename: result.filename,
          seed: result.seed,
          dimensions: result.dimensions,
          elapsed: result.elapsed,
          pipeline: result.pipeline,
          attempts: result.attempts,
        };
      }

      const error = events.find(e => e.type === 'error');
      throw new Error(error?.message || 'Vision generation failed');
    },
  },
};

/**
 * Merged lookup — static wins over dynamic by design (protects namespace).
 * Returns { schema, policyKey, handler, isDynamic? } or null.
 */
function lookup(name, userId, db) {
  if (REGISTRY[name]) return REGISTRY[name];
  if (userId) {
    const dyn = dynamicRegistry.lookup(userId, name, REGISTRY, db);
    if (dyn) return dyn;
  }
  return null;
}

module.exports = { REGISTRY, SCHEMAS, lookup, dynamicRegistry };
