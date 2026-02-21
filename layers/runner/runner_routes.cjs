/**
 * KURO Runner Routes v1.0
 *
 * Mount: app.use('/api/runner', require('./layers/runner/runner_routes.cjs')(auth, { db }))
 *
 * Routes:
 *   POST   /api/runner/spawn            spawn a job
 *   GET    /api/runner/events/:jobId    SSE log stream
 *   GET    /api/runner/status/:jobId    job status
 *   POST   /api/runner/kill/:jobId      SIGKILL running job
 *   GET    /api/runner/artifacts/:jobId list artifacts
 *
 * All routes require auth. Jobs are userId-scoped.
 * Isolation: Docker (preferred) → direct (dev fallback, requires KURO_RUNNER_ALLOW_DIRECT=1).
 */

const express   = require('express');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');

const DATA_DIR       = process.env.KURO_DATA || '/var/lib/kuro';
const JOB_DIR        = path.join(DATA_DIR, 'runner_jobs');
const HARD_CAP_SECS  = parseInt(process.env.KURO_SANDBOX_TIMEOUT_SECONDS || '60', 10);
const ALLOW_DIRECT   = process.env.KURO_RUNNER_ALLOW_DIRECT === '1';
const SSE_MAX_SECS   = HARD_CAP_SECS + 60; // SSE connection max lifetime

// ── Check isolation backend ──────────────────────────────────────────────────
let useDocker = false;
try { execSync('docker info', { stdio: 'ignore', timeout: 5000 }); useDocker = true; }
catch { /* Docker not available */ }

// ── Snapshot materializer (loaded lazily from vfs_snapshot.cjs in Commit 2) ──
let materializeSnapshot = null;
try { ({ materializeSnapshot } = require('../vfs/vfs_snapshot.cjs')); } catch { /* added in Commit 2 */ }

// ── Language config ──────────────────────────────────────────────────────────
const LANG_CFG = {
  python: {
    entryArgs: (ep) => ['python3', '-u', ep],
    dockerImage: process.env.SANDBOX_PYTHON_IMAGE || 'kuro-sandbox-runner:latest',
  },
  node: {
    entryArgs: (ep) => ['node', ep],
    dockerImage: process.env.SANDBOX_NODE_IMAGE || 'node:18-alpine',
  },
};

// ── Tier budgets ─────────────────────────────────────────────────────────────
const BUDGETS = {
  free:      null,
  pro:       { max_seconds: 15, max_memory_mb: 128, max_output_bytes: 524288,  max_concurrent: 1, max_rpm: 3  },
  sovereign: { max_seconds: 60, max_memory_mb: 512, max_output_bytes: 2097152, max_concurrent: 2, max_rpm: 10 },
};

// ── In-memory job state ───────────────────────────────────────────────────────
// jobId → { userId, proc, listeners: Set<fn>, status }
const activeJobs = new Map();

// ── Per-user rate limiting ────────────────────────────────────────────────────
const userRateTs  = new Map(); // userId → [timestamps]
const userActive  = new Map(); // userId → activeCount

function rateCheck(userId, budgets) {
  const active = userActive.get(userId) || 0;
  if (active >= budgets.max_concurrent) return { ok: false, reason: 'max_concurrent_reached' };
  const now = Date.now();
  const ts = (userRateTs.get(userId) || []).filter(t => now - t < 60000);
  userRateTs.set(userId, ts);
  if (ts.length >= budgets.max_rpm) return { ok: false, reason: 'rate_limited' };
  return { ok: true };
}
function rateRecord(userId) {
  const ts = userRateTs.get(userId) || []; ts.push(Date.now()); userRateTs.set(userId, ts);
  userActive.set(userId, (userActive.get(userId) || 0) + 1);
}
function rateDone(userId) {
  userActive.set(userId, Math.max(0, (userActive.get(userId) || 1) - 1));
}

// ── SSE dispatch helpers ──────────────────────────────────────────────────────
function dispatch(jobId, event) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const fn of job.listeners) fn(data);
}

function appendLog(db, jobId, stream, chunk) {
  try {
    db.prepare('INSERT INTO runner_logs (job_id, ts, stream, chunk) VALUES (?, ?, ?, ?)')
      .run(jobId, Date.now(), stream, chunk.slice(0, 65536)); // cap individual chunk
  } catch { /* non-fatal */ }
}

function updateStatus(db, jobId, status, exitCode, startedAt, finishedAt) {
  db.prepare(`UPDATE runner_jobs SET status=?, exit_code=?, started_at=?, finished_at=? WHERE job_id=?`)
    .run(status, exitCode ?? null, startedAt ?? null, finishedAt ?? null, jobId);
}

function finishJob(db, jobId, status, exitCode, userId) {
  const now = Date.now();
  updateStatus(db, jobId, status, exitCode, null, now);
  // also set started_at if not set
  db.prepare('UPDATE runner_jobs SET started_at = COALESCE(started_at, ?) WHERE job_id = ?').run(now, jobId);
  rateDone(userId);
  activeJobs.delete(jobId);
}

function secsToHMS(s) {
  return [Math.floor(s/3600), Math.floor((s%3600)/60), s%60].map(n => String(n).padStart(2,'0')).join(':');
}

// ── Process spawner ───────────────────────────────────────────────────────────
function spawnProcess(job) {
  const { jobId, lang, entrypoint, workspacePath, budgets } = job;
  const langCfg = LANG_CFG[lang] || LANG_CFG.python;
  const artifactDir = path.join(JOB_DIR, jobId, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  if (useDocker) {
    const memFlag = `${budgets.max_memory_mb}m`;
    const args = [
      'run', '--rm', '--network=none', '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--memory', memFlag, '--memory-swap', memFlag,
      '--cpus', '1', '--pids-limit', '64',
      '--ulimit', 'nofile=256:256',
      '--security-opt', 'no-new-privileges',
      '-v', `${workspacePath}:/workspace:ro`,
      '-v', `${artifactDir}:/artifacts:rw`,
      '-w', '/workspace',
      '--env', `ARTIFACT_DIR=/artifacts`,
      langCfg.dockerImage,
      ...langCfg.entryArgs(entrypoint),
    ];
    return spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  if (ALLOW_DIRECT) {
    // Dev fallback: direct execution, no isolation
    console.warn(`[RUNNER] KURO_RUNNER_ALLOW_DIRECT: spawning ${lang} without isolation (job ${jobId})`);
    const [bin, ...binArgs] = langCfg.entryArgs(path.join(workspacePath, entrypoint));
    return spawn(bin, binArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workspacePath,
      env: { HOME: '/tmp', ARTIFACT_DIR: artifactDir, PATH: process.env.PATH || '/usr/bin:/bin' },
    });
  }

  throw new Error('No isolation backend available. Set KURO_RUNNER_ALLOW_DIRECT=1 for dev mode.');
}

// ── Core job executor (exported for testing) ──────────────────────────────────
async function executeJob(jobId, db) {
  const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id = ?').get(jobId);
  if (!row) return;

  const budgets = { max_seconds: row.max_seconds || 30, max_memory_mb: 256, max_output_bytes: row.max_bytes || 524288 };

  const now = Date.now();
  updateStatus(db, jobId, 'running', null, now, null);

  let proc;
  try {
    proc = spawnProcess({
      jobId, lang: row.lang || 'python',
      entrypoint: row.cmd || 'main.py',
      workspacePath: path.join(JOB_DIR, jobId, 'workspace'),
      budgets,
    });
  } catch (err) {
    const msg = `[RUNNER] Spawn failed: ${err.message}\n`;
    appendLog(db, jobId, 'sys', msg);
    dispatch(jobId, { t: 'sys', ts: Date.now(), d: msg });
    dispatch(jobId, { t: 'status', ts: Date.now(), status: 'failed', exitCode: 1 });
    finishJob(db, jobId, 'failed', 1, row.user_id);
    return;
  }

  activeJobs.set(jobId, { userId: row.user_id, proc, listeners: new Set(), status: 'running' });
  dispatch(jobId, { t: 'sys', ts: Date.now(), d: `[RUNNER] Job started (${row.lang})\n` });

  let totalOut = 0;
  let truncated = false;

  const handleData = (stream) => (data) => {
    totalOut += data.length;
    if (totalOut > budgets.max_output_bytes) {
      if (!truncated) {
        truncated = true;
        const msg = `\n[RUNNER] Output truncated (max ${budgets.max_output_bytes} bytes)\n`;
        appendLog(db, jobId, 'sys', msg);
        dispatch(jobId, { t: 'sys', ts: Date.now(), d: msg });
      }
      return;
    }
    const chunk = data.toString('utf8');
    appendLog(db, jobId, stream, chunk);
    dispatch(jobId, { t: stream, ts: Date.now(), d: chunk });
  };

  proc.stdout.on('data', handleData('stdout'));
  proc.stderr.on('data', handleData('stderr'));

  const hardCap = Math.min(budgets.max_seconds, HARD_CAP_SECS);
  const timer = setTimeout(() => {
    if (!proc.killed) {
      proc.kill('SIGKILL');
      const msg = `[RUNNER] Killed: exceeded ${hardCap}s hard cap\n`;
      appendLog(db, jobId, 'sys', msg);
      dispatch(jobId, { t: 'sys', ts: Date.now(), d: msg });
      dispatch(jobId, { t: 'status', ts: Date.now(), status: 'timeout', exitCode: -1 });
      finishJob(db, jobId, 'timeout', -1, row.user_id);
    }
  }, (hardCap + 2) * 1000);

  proc.on('exit', () => clearTimeout(timer));

  proc.on('close', (code) => {
    clearTimeout(timer);
    if (db.prepare('SELECT status FROM runner_jobs WHERE job_id=?').get(jobId)?.status === 'running') {
      const status = code === 0 ? 'done' : 'failed';
      dispatch(jobId, { t: 'status', ts: Date.now(), status, exitCode: code });
      finishJob(db, jobId, status, code, row.user_id);
    }
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    const msg = `[RUNNER] Process error: ${err.message}\n`;
    appendLog(db, jobId, 'sys', msg);
    dispatch(jobId, { t: 'sys', ts: Date.now(), d: msg });
    dispatch(jobId, { t: 'status', ts: Date.now(), status: 'failed', exitCode: 1 });
    finishJob(db, jobId, 'failed', 1, row.user_id);
  });
}

// ── Route factory ─────────────────────────────────────────────────────────────
function mountRunnerRoutes(auth, { db }) {
  const router = express.Router();
  router.use(auth.required);

  const uid = (req) => req.user?.userId;
  const getBudgets = (tier) => BUDGETS[tier] || BUDGETS.pro;

  function requireRunnerTier(req, res, next) {
    const tier = req.user?.tier || 'free';
    if (tier === 'free') return res.status(403).json({ error: 'runner_disabled', message: 'Runner requires Pro or Sovereign tier' });
    req._budgets = getBudgets(tier);
    next();
  }

  // ── POST /spawn ─────────────────────────────────────────────────────────────
  router.post('/spawn', requireRunnerTier, async (req, res) => {
    const userId = uid(req);
    if (!userId || userId === 'anon') return res.status(401).json({ error: 'Auth required' });

    const budgets = req._budgets;
    const check = rateCheck(userId, budgets);
    if (!check.ok) return res.status(429).json({ error: check.reason });

    const { projectId, cmd, cwd, lang = 'python', snapshot = false, env: userEnv } = req.body || {};
    if (!cmd) return res.status(400).json({ error: 'cmd required' });

    // Validate lang
    const safeLang = LANG_CFG[lang] ? lang : 'python';

    const jobId = crypto.randomBytes(16).toString('hex');
    const workspaceDir = path.join(JOB_DIR, jobId, 'workspace');

    // Materialize snapshot or empty workspace
    try {
      if (snapshot && projectId && materializeSnapshot) {
        const { snapshotDir } = await materializeSnapshot(userId, projectId, jobId);
        if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      } else {
        fs.mkdirSync(workspaceDir, { recursive: true });
      }
    } catch (e) {
      fs.mkdirSync(workspaceDir, { recursive: true }); // fallback
    }

    rateRecord(userId);

    db.prepare(`INSERT INTO runner_jobs (job_id, user_id, project_id, cwd, cmd, lang, status, max_seconds, max_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .run(jobId, userId, projectId || null, cwd || null, cmd, safeLang, budgets.max_seconds, budgets.max_output_bytes, Date.now());

    // Mark queued in in-memory map (so SSE clients can attach before job starts)
    activeJobs.set(jobId, { userId, proc: null, listeners: new Set(), status: 'queued' });

    // Execute async
    setImmediate(() => executeJob(jobId, db));

    res.json({ jobId, status: 'queued' });
  });

  // ── GET /events/:jobId — SSE log stream ─────────────────────────────────────
  router.get('/events/:jobId', (req, res) => {
    const userId = uid(req);
    if (!userId || userId === 'anon') return res.status(401).end();

    const { jobId } = req.params;
    if (!/^[a-f0-9]{32}$/.test(jobId)) return res.status(400).end();

    const jobRow = db.prepare('SELECT * FROM runner_jobs WHERE job_id = ? AND user_id = ?').get(jobId, userId);
    if (!jobRow) return res.status(404).end();

    res.set({
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const sendEvent = (data) => {
      if (!res.writableEnded) res.write(data);
    };

    // Catch-up: replay existing logs from DB
    const pastLogs = db.prepare('SELECT * FROM runner_logs WHERE job_id = ? ORDER BY id ASC').all(jobId);
    for (const row of pastLogs) {
      sendEvent(`data: ${JSON.stringify({ t: row.stream, ts: row.ts, d: row.chunk })}\n\n`);
    }

    // If job already finished, send final status and close
    const currentStatus = db.prepare('SELECT status, exit_code FROM runner_jobs WHERE job_id=?').get(jobId);
    if (currentStatus && !['queued','running'].includes(currentStatus.status)) {
      sendEvent(`data: ${JSON.stringify({ t: 'status', ts: Date.now(), status: currentStatus.status, exitCode: currentStatus.exit_code })}\n\n`);
      res.end();
      return;
    }

    // Subscribe to live events
    const job = activeJobs.get(jobId);
    if (job) job.listeners.add(sendEvent);

    // Heartbeat to prevent proxy timeout
    const hb = setInterval(() => { if (!res.writableEnded) res.write(': hb\n\n'); }, 15000);

    // Hard SSE max-duration cutoff
    const maxTimer = setTimeout(() => {
      sendEvent(`data: ${JSON.stringify({ t: 'sys', ts: Date.now(), d: '[SSE] Max duration reached\n' })}\n\n`);
      cleanup();
    }, SSE_MAX_SECS * 1000);

    const cleanup = () => {
      clearInterval(hb);
      clearTimeout(maxTimer);
      const j = activeJobs.get(jobId);
      if (j) j.listeners.delete(sendEvent);
      if (!res.writableEnded) res.end();
    };

    // Auto-close: wrap sendEvent to detect final 'status' event
    const origSend = sendEvent;
    const wrappedSend = (data) => {
      origSend(data);
      if (data.includes('"t":"status"')) setTimeout(cleanup, 200);
    };
    if (job) {
      job.listeners.delete(sendEvent);
      job.listeners.add(wrappedSend);
    }

    req.on('close', cleanup);
  });

  // ── GET /status/:jobId ───────────────────────────────────────────────────────
  router.get('/status/:jobId', (req, res) => {
    const userId = uid(req);
    if (!userId || userId === 'anon') return res.status(401).json({ error: 'Auth required' });
    const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(req.params.jobId, userId);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    res.json({
      jobId: row.job_id, status: row.status, exitCode: row.exit_code,
      lang: row.lang, cmd: row.cmd, projectId: row.project_id,
      createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
    });
  });

  // ── POST /kill/:jobId ────────────────────────────────────────────────────────
  router.post('/kill/:jobId', (req, res) => {
    const userId = uid(req);
    if (!userId || userId === 'anon') return res.status(401).json({ error: 'Auth required' });
    const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(req.params.jobId, userId);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    if (!['queued', 'running'].includes(row.status)) {
      return res.status(409).json({ error: 'Job not running', status: row.status });
    }
    const job = activeJobs.get(req.params.jobId);
    if (job?.proc && !job.proc.killed) {
      job.proc.kill('SIGKILL');
      const msg = '[RUNNER] Killed by user\n';
      appendLog(db, req.params.jobId, 'sys', msg);
      dispatch(req.params.jobId, { t: 'sys', ts: Date.now(), d: msg });
      dispatch(req.params.jobId, { t: 'status', ts: Date.now(), status: 'killed', exitCode: -1 });
      finishJob(db, req.params.jobId, 'killed', -1, userId);
    }
    res.json({ ok: true, status: 'killed' });
  });

  // ── GET /artifacts/:jobId ────────────────────────────────────────────────────
  router.get('/artifacts/:jobId', (req, res) => {
    const userId = uid(req);
    if (!userId || userId === 'anon') return res.status(401).json({ error: 'Auth required' });
    const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(req.params.jobId, userId);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    const artifactDir = path.join(JOB_DIR, req.params.jobId, 'artifacts');
    if (!fs.existsSync(artifactDir)) return res.json({ artifacts: [] });
    const artifacts = [];
    const ALLOWED = new Set(['.txt','.md','.html','.csv','.json','.xml','.py','.js','.ts','.css','.svg','.png','.jpg','.jpeg','.gif','.webp','.pdf','.log']);
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name), rp = path.join(rel, e.name);
        if (e.isDirectory()) { walk(full, rp); continue; }
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED.has(ext)) continue;
        artifacts.push({ path: rp, size: fs.statSync(full).size, ext });
      }
    };
    walk(artifactDir, '');
    res.json({ artifacts });
  });

  return router;
}

// Export internals for testing
mountRunnerRoutes._executeJob = executeJob;
mountRunnerRoutes._activeJobs = activeJobs;
mountRunnerRoutes._appendLog  = appendLog;
mountRunnerRoutes._dispatch   = dispatch;

module.exports = mountRunnerRoutes;
