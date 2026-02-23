/**
 * KURO Phase 3 — Tool Registry
 *
 * Maps dot-notation tool names to their JSON schema + handler.
 * Handlers call the underlying adapters DIRECTLY (no audit logging here —
 * that is the executor's responsibility to avoid duplicate tool_calls rows).
 *
 * Exported: REGISTRY, SCHEMAS
 */

'use strict';

// ─── Raw tool implementations (no logging wrappers) ───────────────────────────
const { VFS_TOOLS }    = require('./vfs_tools.cjs');
const { RUNNER_TOOLS } = require('./runner_tools.cjs');

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
};

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

module.exports = { REGISTRY, SCHEMAS };
