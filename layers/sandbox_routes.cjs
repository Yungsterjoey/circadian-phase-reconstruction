/**
 * KURO::SANDBOX ROUTES v1.0
 * /api/sandbox/* — Isolated code execution for KuroChatApp
 *
 * All routes require authentication. Tier-gated:
 *   free:      sandbox disabled (403)
 *   pro:       enabled, tight budgets
 *   sovereign: enabled, higher budgets
 *
 * Does NOT reuse /api/dev/* endpoints.
 * Calls the kuro-sandbox sidecar on 127.0.0.1:3101.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const SANDBOX_BASE = process.env.KURO_SANDBOX_DIR || '/var/lib/kuro/sandboxes';
const SANDBOX_RUNNER_URL = process.env.SANDBOX_RUNNER_URL || 'http://127.0.0.1:3101';

// ═══════════════════════════════════════════════════════════════════════════
// TIER BUDGETS
// ═══════════════════════════════════════════════════════════════════════════
const TIER_BUDGETS = {
  pro: {
    max_runtime_seconds: 15,
    max_memory_mb: 128,
    max_output_bytes: 524288,          // 512 KB
    max_workspace_bytes: 20971520,     // 20 MB
    max_files_touched: 20,
    max_runs_per_minute: 3,
    max_concurrent_runs_per_user: 1,
  },
  sovereign: {
    max_runtime_seconds: 60,
    max_memory_mb: 512,
    max_output_bytes: 2097152,         // 2 MB
    max_workspace_bytes: 104857600,    // 100 MB
    max_files_touched: 100,
    max_runs_per_minute: 10,
    max_concurrent_runs_per_user: 2,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER (in-memory, per-user)
// ═══════════════════════════════════════════════════════════════════════════
const userRunTimestamps = new Map(); // userId → [ts, ts, ...]
const userActiveRuns = new Map();    // userId → count

function checkRunRate(userId, tier) {
  const budgets = TIER_BUDGETS[tier];
  if (!budgets) return { allowed: false, reason: 'tier_disabled' };

  // Check concurrent
  const active = userActiveRuns.get(userId) || 0;
  if (active >= budgets.max_concurrent_runs_per_user) {
    return { allowed: false, reason: 'max_concurrent_runs' };
  }

  // Check per-minute
  const now = Date.now();
  const stamps = (userRunTimestamps.get(userId) || []).filter(t => now - t < 60000);
  userRunTimestamps.set(userId, stamps);
  if (stamps.length >= budgets.max_runs_per_minute) {
    return { allowed: false, reason: 'rate_limited' };
  }

  return { allowed: true };
}

function recordRunStart(userId) {
  const stamps = userRunTimestamps.get(userId) || [];
  stamps.push(Date.now());
  userRunTimestamps.set(userId, stamps);
  userActiveRuns.set(userId, (userActiveRuns.get(userId) || 0) + 1);
}

function recordRunEnd(userId) {
  const c = userActiveRuns.get(userId) || 1;
  userActiveRuns.set(userId, Math.max(0, c - 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function genId() { return crypto.randomBytes(16).toString('hex'); }

/** Sanitize path segment — no traversal, no special chars */
function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'untitled';
}

/** Ensure resolved path stays under base */
function enforceBase(base, rel) {
  const full = path.resolve(base, rel);
  if (!full.startsWith(path.resolve(base) + path.sep) && full !== path.resolve(base)) {
    throw new Error('Path traversal blocked');
  }
  return full;
}

/** Artifact MIME allowlist */
const MIME_MAP = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.html': 'text/html', '.htm': 'text/html',
  '.json': 'application/json', '.xml': 'application/xml',
  '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript', '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.log': 'text/plain',
};

/** HTTP call to the sidecar */
function sidecarRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SANDBOX_RUNNER_URL);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Sidecar timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mount sandbox routes.
 * @param {object} auth - auth middleware object ({ required, ... })
 * @param {object} db - { db, stmts } from layers/auth/db.cjs
 */
function createSandboxRoutes(auth, db) {
  const router = express.Router();
  const { db: sqlite } = db;

  // Ensure tables exist (additive migration)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sandbox_workspaces (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sandbox_runs (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        status        TEXT DEFAULT 'queued',
        entrypoint    TEXT DEFAULT 'main.py',
        exit_code     INTEGER,
        budget_json   TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at    DATETIME,
        finished_at   DATETIME
      );
      CREATE TABLE IF NOT EXISTS sandbox_artifacts (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL,
        workspace_id  TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        path          TEXT NOT NULL,
        mime          TEXT,
        size          INTEGER DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sbx_ws_user ON sandbox_workspaces(user_id);
      CREATE INDEX IF NOT EXISTS idx_sbx_runs_ws ON sandbox_runs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_sbx_artifacts_run ON sandbox_artifacts(run_id);
    `);
    console.log('[SANDBOX] DB tables ensured');
  } catch (e) {
    console.error('[SANDBOX] DB migration error:', e.message);
  }

  // Prepared statements
  const stmts = {
    createWorkspace: sqlite.prepare('INSERT INTO sandbox_workspaces (id, user_id, name) VALUES (?, ?, ?)'),
    listWorkspaces: sqlite.prepare('SELECT * FROM sandbox_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'),
    getWorkspace: sqlite.prepare('SELECT * FROM sandbox_workspaces WHERE id = ? AND user_id = ?'),
    updateWorkspace: sqlite.prepare('UPDATE sandbox_workspaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    createRun: sqlite.prepare('INSERT INTO sandbox_runs (id, workspace_id, user_id, entrypoint, budget_json) VALUES (?, ?, ?, ?, ?)'),
    getRun: sqlite.prepare('SELECT * FROM sandbox_runs WHERE id = ? AND user_id = ?'),
    updateRunStatus: sqlite.prepare('UPDATE sandbox_runs SET status = ?, exit_code = ?, started_at = ?, finished_at = ? WHERE id = ?'),
    createArtifact: sqlite.prepare('INSERT INTO sandbox_artifacts (id, run_id, workspace_id, user_id, path, mime, size) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    getRunArtifacts: sqlite.prepare('SELECT * FROM sandbox_artifacts WHERE run_id = ? AND user_id = ?'),
  };

  // ─── Tier gate middleware ─────────────────────────────────────────────────
  function requireSandboxTier(req, res, next) {
    const tier = req.user?.tier || 'free';
    if (tier === 'free') {
      return res.status(403).json({
        error: 'sandbox_disabled',
        message: 'Sandbox requires Pro or Sovereign tier',
        upgrade_url: '/api/stripe/checkout',
      });
    }
    req.sandboxBudgets = TIER_BUDGETS[tier] || TIER_BUDGETS.pro;
    next();
  }

  // ─── All routes require auth ──────────────────────────────────────────────
  router.use(auth.required);

  // ─── POST /workspaces — create workspace ──────────────────────────────────
  router.post('/workspaces', requireSandboxTier, (req, res) => {
    try {
      const userId = req.user.userId;
      const name = safeName(req.body?.name || 'workspace-' + Date.now());
      const id = genId();

      // Enforce max workspaces
      const existing = stmts.listWorkspaces.all(userId);
      if (existing.length >= 20) {
        return res.status(400).json({ error: 'Max 20 workspaces per user' });
      }

      // Create on disk
      const wsDir = path.join(SANDBOX_BASE, userId, id, 'files');
      fs.mkdirSync(wsDir, { recursive: true });
      fs.mkdirSync(path.join(SANDBOX_BASE, userId, id, 'runs'), { recursive: true });

      stmts.createWorkspace.run(id, userId, name);
      res.json({ id, name, created: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── GET /workspaces — list ───────────────────────────────────────────────
  router.get('/workspaces', requireSandboxTier, (req, res) => {
    const workspaces = stmts.listWorkspaces.all(req.user.userId);
    res.json({ workspaces });
  });

  // ─── GET /workspaces/:id — metadata ───────────────────────────────────────
  router.get('/workspaces/:id', requireSandboxTier, (req, res) => {
    const ws = stmts.getWorkspace.get(req.params.id, req.user.userId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    res.json(ws);
  });

  // ─── POST /files/write — write a file into workspace ─────────────────────
  router.post('/files/write', requireSandboxTier, (req, res) => {
    try {
      const { workspaceId, filePath, content } = req.body;
      if (!workspaceId || !filePath) return res.status(400).json({ error: 'workspaceId and filePath required' });

      const ws = stmts.getWorkspace.get(workspaceId, req.user.userId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });

      const sanitized = safeName(path.basename(filePath));
      const subdir = path.dirname(filePath).split('/').filter(Boolean).map(safeName).join('/');
      const wsFilesDir = path.join(SANDBOX_BASE, req.user.userId, workspaceId, 'files');
      const targetDir = subdir ? path.join(wsFilesDir, subdir) : wsFilesDir;
      enforceBase(wsFilesDir, subdir || '.');
      fs.mkdirSync(targetDir, { recursive: true });

      const target = path.join(targetDir, sanitized);
      enforceBase(wsFilesDir, path.relative(wsFilesDir, target));

      // Size check
      const contentBuf = Buffer.from(content || '', 'utf8');
      if (contentBuf.length > req.sandboxBudgets.max_workspace_bytes) {
        return res.status(413).json({ error: 'File too large' });
      }

      fs.writeFileSync(target, contentBuf);
      stmts.updateWorkspace.run(workspaceId);
      res.json({ success: true, path: path.relative(wsFilesDir, target), size: contentBuf.length });
    } catch (e) {
      res.status(e.message.includes('traversal') ? 400 : 500).json({ error: e.message });
    }
  });

  // ─── POST /files/upload — binary upload ───────────────────────────────────
  router.post('/files/upload', requireSandboxTier, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    try {
      const workspaceId = req.headers['x-workspace-id'];
      const fileName = safeName(req.headers['x-filename'] || `upload_${Date.now()}`);
      if (!workspaceId) return res.status(400).json({ error: 'X-Workspace-Id header required' });

      const ws = stmts.getWorkspace.get(workspaceId, req.user.userId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });

      const wsFilesDir = path.join(SANDBOX_BASE, req.user.userId, workspaceId, 'files');
      const target = path.join(wsFilesDir, fileName);
      enforceBase(wsFilesDir, fileName);

      if (req.body.length > req.sandboxBudgets.max_workspace_bytes) {
        return res.status(413).json({ error: 'File too large' });
      }

      fs.writeFileSync(target, req.body);
      stmts.updateWorkspace.run(workspaceId);
      res.json({ success: true, path: fileName, size: req.body.length });
    } catch (e) {
      res.status(e.message.includes('traversal') ? 400 : 500).json({ error: e.message });
    }
  });

  // ─── GET /files/tree — list files ─────────────────────────────────────────
  router.get('/files/tree', requireSandboxTier, (req, res) => {
    try {
      const { workspaceId } = req.query;
      if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });

      const ws = stmts.getWorkspace.get(workspaceId, req.user.userId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });

      const wsDir = path.join(SANDBOX_BASE, req.user.userId, workspaceId, 'files');
      if (!fs.existsSync(wsDir)) return res.json({ files: [] });

      const files = [];
      const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rp = path.join(rel, entry.name);
          if (entry.isDirectory()) { walk(path.join(dir, entry.name), rp); continue; }
          const stat = fs.statSync(path.join(dir, entry.name));
          files.push({ path: rp, size: stat.size, mtime: stat.mtimeMs });
        }
      };
      walk(wsDir, '');
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── POST /run — submit execution job ─────────────────────────────────────
  router.post('/run', requireSandboxTier, async (req, res) => {
    try {
      const userId = req.user.userId;
      const tier = req.user.tier;
      const { workspaceId, entrypoint } = req.body;

      if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });

      const ws = stmts.getWorkspace.get(workspaceId, userId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });

      // Rate check
      const rateCheck = checkRunRate(userId, tier);
      if (!rateCheck.allowed) {
        return res.status(429).json({ error: rateCheck.reason, message: 'Rate limit hit. Try again shortly.' });
      }

      const budgets = TIER_BUDGETS[tier] || TIER_BUDGETS.pro;
      const runId = genId();
      const wsFilesDir = path.join(SANDBOX_BASE, userId, workspaceId, 'files');
      const runDir = path.join(SANDBOX_BASE, userId, workspaceId, 'runs', runId);
      fs.mkdirSync(runDir, { recursive: true });

      stmts.createRun.run(runId, workspaceId, userId, entrypoint || 'main.py', JSON.stringify(budgets));
      recordRunStart(userId);

      // Call sidecar
      try {
        const result = await sidecarRequest('POST', '/run', {
          workspacePath: wsFilesDir,
          entrypoint: entrypoint || 'main.py',
          budgets,
          runDir,
        });

        if (result.status !== 200) {
          stmts.updateRunStatus.run('error', 1, new Date().toISOString(), new Date().toISOString(), runId);
          recordRunEnd(userId);
          return res.status(result.status || 500).json({ error: result.body?.error || 'Sidecar error', runId });
        }

        // Sidecar returned a runId — it runs async, we poll
        res.json({ runId, sidecarRunId: result.body.runId, status: 'queued' });
      } catch (e) {
        stmts.updateRunStatus.run('error', 1, new Date().toISOString(), new Date().toISOString(), runId);
        recordRunEnd(userId);
        return res.status(502).json({ error: `Sandbox runner unavailable: ${e.message}`, runId });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── GET /run/:runId — status + logs ──────────────────────────────────────
  router.get('/run/:runId', requireSandboxTier, async (req, res) => {
    try {
      const run = stmts.getRun.get(req.params.runId, req.user.userId);
      if (!run) return res.status(404).json({ error: 'Run not found' });

      // Check sidecar for live status
      const runDir = path.join(SANDBOX_BASE, req.user.userId, run.workspace_id, 'runs', run.id);
      const metaPath = path.join(runDir, 'meta.json');

      // If we have meta.json on disk, the run is done
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (run.status !== 'done' && run.status !== 'error') {
            stmts.updateRunStatus.run(
              meta.status || 'done', meta.exitCode ?? null,
              meta.startedAt ? new Date(meta.startedAt).toISOString() : null,
              meta.finishedAt ? new Date(meta.finishedAt).toISOString() : null,
              run.id
            );
            recordRunEnd(req.user.userId);

            // Register artifacts
            if (meta.artifacts?.length) {
              for (const art of meta.artifacts) {
                const ext = path.extname(art.path).toLowerCase();
                stmts.createArtifact.run(genId(), run.id, run.workspace_id, req.user.userId, art.path, MIME_MAP[ext] || 'application/octet-stream', art.size || 0);
              }
            }
          }

          const stdout = fs.existsSync(path.join(runDir, 'stdout.log'))
            ? fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf8').slice(0, 1048576)
            : '';
          const stderr = fs.existsSync(path.join(runDir, 'stderr.log'))
            ? fs.readFileSync(path.join(runDir, 'stderr.log'), 'utf8').slice(0, 1048576)
            : '';

          return res.json({
            runId: run.id, workspaceId: run.workspace_id,
            status: meta.status || 'done', exitCode: meta.exitCode,
            stdout, stderr,
            artifacts: meta.artifacts || [],
            createdAt: run.created_at, startedAt: meta.startedAt, finishedAt: meta.finishedAt,
          });
        } catch (e) { /* fall through to sidecar poll */ }
      }

      // Poll sidecar for status (run might still be in-progress)
      try {
        const budgetJson = run.budget_json ? JSON.parse(run.budget_json) : {};
        // We need the sidecar's runId. For simplicity, check all in-memory.
        // Try the meta.json approach first (above). If not yet written, return queued/running.
        return res.json({
          runId: run.id, workspaceId: run.workspace_id,
          status: run.status || 'running', exitCode: run.exit_code,
          stdout: '', stderr: '', artifacts: [],
          createdAt: run.created_at,
        });
      } catch (e) {
        return res.json({
          runId: run.id, status: run.status || 'unknown',
          stdout: '', stderr: '', artifacts: [],
        });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── GET /artifacts/:runId/:path — serve artifact with safety headers ─────
  router.get('/artifacts/:runId/*', requireSandboxTier, (req, res) => {
    try {
      const run = stmts.getRun.get(req.params.runId, req.user.userId);
      if (!run) return res.status(404).json({ error: 'Run not found' });

      const artPath = req.params[0]; // everything after /artifacts/:runId/
      if (!artPath) return res.status(400).json({ error: 'Artifact path required' });

      const artifactDir = path.join(SANDBOX_BASE, req.user.userId, run.workspace_id, 'runs', run.id, 'artifacts');
      const fullPath = enforceBase(artifactDir, artPath);

      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return res.status(404).json({ error: 'Artifact not found' });
      }

      const ext = path.extname(artPath).toLowerCase();
      const mime = MIME_MAP[ext];
      if (!mime) return res.status(403).json({ error: 'File type not allowed' });

      // Security headers
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', 'private, no-store');

      // For HTML, add extra sandbox CSP
      if (ext === '.html' || ext === '.htm') {
        res.setHeader('Content-Security-Policy',
          "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; sandbox");
      }

      const stream = fs.createReadStream(fullPath);
      stream.pipe(res);
    } catch (e) {
      res.status(e.message.includes('traversal') ? 400 : 500).json({ error: e.message });
    }
  });

  // ─── Health ───────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    sidecarRequest('GET', '/health')
      .then(r => res.json({ sandbox: 'ok', runner: r.body }))
      .catch(() => res.json({ sandbox: 'ok', runner: 'unavailable' }));
  });

  return router;
}

module.exports = createSandboxRoutes;
