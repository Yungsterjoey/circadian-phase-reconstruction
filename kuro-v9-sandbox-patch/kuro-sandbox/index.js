/**
 * KURO::SANDBOX RUNNER v1.0
 * Sidecar service for isolated code execution.
 *
 * Interface:
 *   POST /run   { workspacePath, entrypoint, budgets }  → { runId }
 *   GET  /run/:id → { status, exitCode, stdout, stderr, artifacts }
 *
 * Isolation: Docker container (--network=none, --read-only rootfs, tmpfs /tmp).
 * Fallback: firejail if Docker unavailable.
 *
 * Listens on SANDBOX_PORT (default 3101), ONLY on 127.0.0.1.
 * Must NOT be exposed to the internet.
 */

const http = require('http');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.SANDBOX_PORT || '3101', 10);
const RUNNER_IMAGE = process.env.SANDBOX_IMAGE || 'kuro-sandbox-runner:latest';
const MAX_CONCURRENT = parseInt(process.env.SANDBOX_MAX_CONCURRENT || '4', 10);

// In-memory job store (ephemeral — survives only for this process lifetime)
const jobs = new Map();
let activeCount = 0;

// ─── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_BUDGETS = {
  max_runtime_seconds: 30,
  max_memory_mb: 256,
  max_output_bytes: 1048576,       // 1 MB
  max_workspace_bytes: 52428800,   // 50 MB
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function genRunId() { return crypto.randomBytes(12).toString('hex'); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new Error('Body too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ─── Check Docker availability ──────────────────────────────────────────────
let useDocker = false;
try {
  const { execSync } = require('child_process');
  execSync('docker info', { stdio: 'ignore', timeout: 5000 });
  useDocker = true;
  console.log('[SANDBOX] Docker available — using container isolation');
} catch {
  console.warn('[SANDBOX] Docker unavailable — falling back to firejail (ensure installed)');
}

// ─── Scan artifacts after run ───────────────────────────────────────────────
function scanArtifacts(artifactDir) {
  const results = [];
  if (!fs.existsSync(artifactDir)) return results;
  const ALLOWED_EXT = new Set([
    '.txt', '.md', '.html', '.htm', '.csv', '.json', '.xml',
    '.py', '.js', '.ts', '.css', '.svg',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.pdf', '.log',
  ]);
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rp = path.join(rel, entry.name);
      if (entry.isDirectory()) { walk(full, rp); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      const stat = fs.statSync(full);
      results.push({ path: rp, size: stat.size, ext });
    }
  };
  walk(artifactDir, '');
  return results;
}

// ─── Docker runner ──────────────────────────────────────────────────────────
function runDocker(job) {
  const { workspacePath, entrypoint, budgets, runDir } = job;
  const memLimit = `${budgets.max_memory_mb}m`;
  const timeout = budgets.max_runtime_seconds;

  // The workspace is mounted read-write at /workspace inside container.
  // Artifacts dir is mounted at /artifacts.
  const artifactDir = path.join(runDir, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  const args = [
    'run', '--rm',
    '--network=none',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--memory', memLimit,
    '--memory-swap', memLimit,
    '--cpus', '1',
    '--pids-limit', '64',
    '--ulimit', `nofile=256:256`,
    '--security-opt', 'no-new-privileges',
    '-v', `${workspacePath}:/workspace:ro`,
    '-v', `${artifactDir}:/artifacts:rw`,
    '-w', '/workspace',
    '-e', `TIMEOUT=${timeout}`,
    RUNNER_IMAGE,
    'python3', '-u', entrypoint || 'main.py',
  ];

  return new Promise(resolve => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let totalOut = 0;

    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      stderrChunks.push(Buffer.from('\n[SANDBOX] Killed: exceeded max_runtime_seconds\n'));
    }, (timeout + 5) * 1000);

    proc.stdout.on('data', d => {
      totalOut += d.length;
      if (totalOut <= budgets.max_output_bytes) stdoutChunks.push(d);
    });
    proc.stderr.on('data', d => {
      totalOut += d.length;
      if (totalOut <= budgets.max_output_bytes) stderrChunks.push(d);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').slice(0, budgets.max_output_bytes),
        stderr: Buffer.concat(stderrChunks).toString('utf8').slice(0, budgets.max_output_bytes),
        artifacts: scanArtifacts(artifactDir),
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: `[SANDBOX] spawn error: ${err.message}`, artifacts: [] });
    });
  });
}

// ─── Firejail fallback ──────────────────────────────────────────────────────
function runFirejail(job) {
  const { workspacePath, entrypoint, budgets, runDir } = job;
  const timeout = budgets.max_runtime_seconds;
  const artifactDir = path.join(runDir, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });

  // Minimal firejail sandbox — no network, limited filesystem
  const args = [
    '--noprofile',
    '--net=none',
    '--noroot',
    '--rlimit-as=' + (budgets.max_memory_mb * 1024 * 1024),
    '--timeout=' + (timeout + 2) + ':00:00',
    '--read-only=' + workspacePath,
    '--whitelist=' + artifactDir,
    '--',
    'python3', '-u', path.join(workspacePath, entrypoint || 'main.py'),
  ];

  return new Promise(resolve => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let totalOut = 0;

    const proc = spawn('firejail', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { HOME: '/tmp', PYTHONDONTWRITEBYTECODE: '1', ARTIFACT_DIR: artifactDir },
      cwd: workspacePath,
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      stderrChunks.push(Buffer.from('\n[SANDBOX] Killed: exceeded max_runtime_seconds\n'));
    }, (timeout + 5) * 1000);

    proc.stdout.on('data', d => { totalOut += d.length; if (totalOut <= budgets.max_output_bytes) stdoutChunks.push(d); });
    proc.stderr.on('data', d => { totalOut += d.length; if (totalOut <= budgets.max_output_bytes) stderrChunks.push(d); });

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').slice(0, budgets.max_output_bytes),
        stderr: Buffer.concat(stderrChunks).toString('utf8').slice(0, budgets.max_output_bytes),
        artifacts: scanArtifacts(artifactDir),
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: `[SANDBOX] firejail error: ${err.message}`, artifacts: [] });
    });
  });
}

// ─── Execute a job ──────────────────────────────────────────────────────────
async function executeJob(job) {
  job.status = 'running';
  job.startedAt = Date.now();
  activeCount++;

  try {
    const result = useDocker ? await runDocker(job) : await runFirejail(job);
    job.exitCode = result.exitCode;
    job.stdout = result.stdout;
    job.stderr = result.stderr;
    job.artifacts = result.artifacts;
    job.status = 'done';
  } catch (err) {
    job.exitCode = 1;
    job.stdout = '';
    job.stderr = `[SANDBOX] Internal error: ${err.message}`;
    job.artifacts = [];
    job.status = 'error';
  }

  job.finishedAt = Date.now();
  activeCount--;

  // Persist logs to runDir
  try {
    fs.writeFileSync(path.join(job.runDir, 'stdout.log'), job.stdout);
    fs.writeFileSync(path.join(job.runDir, 'stderr.log'), job.stderr);
    fs.writeFileSync(path.join(job.runDir, 'meta.json'), JSON.stringify({
      runId: job.runId, status: job.status, exitCode: job.exitCode,
      startedAt: job.startedAt, finishedAt: job.finishedAt,
      artifacts: job.artifacts, budgets: job.budgets,
    }, null, 2));
  } catch (e) {
    console.error('[SANDBOX] Failed to persist logs:', e.message);
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // POST /run
  if (req.method === 'POST' && url.pathname === '/run') {
    try {
      const body = await parseBody(req);
      const { workspacePath, entrypoint, budgets: userBudgets, runDir } = body;

      if (!workspacePath || !runDir) return respond(res, 400, { error: 'workspacePath and runDir required' });
      if (!fs.existsSync(workspacePath)) return respond(res, 400, { error: 'workspacePath does not exist' });

      if (activeCount >= MAX_CONCURRENT) return respond(res, 429, { error: 'Too many concurrent runs' });

      const budgets = { ...DEFAULT_BUDGETS, ...userBudgets };
      const runId = genRunId();
      fs.mkdirSync(runDir, { recursive: true });

      const job = {
        runId, workspacePath, entrypoint: entrypoint || 'main.py',
        budgets, runDir,
        status: 'queued', exitCode: null,
        stdout: '', stderr: '', artifacts: [],
        createdAt: Date.now(), startedAt: null, finishedAt: null,
      };
      jobs.set(runId, job);

      // Fire and forget — client polls GET /run/:id
      setImmediate(() => executeJob(job));

      return respond(res, 200, { runId, status: 'queued' });
    } catch (e) {
      return respond(res, 400, { error: e.message });
    }
  }

  // GET /run/:id
  const runMatch = url.pathname.match(/^\/run\/([a-f0-9]{24})$/);
  if (req.method === 'GET' && runMatch) {
    const job = jobs.get(runMatch[1]);
    if (!job) return respond(res, 404, { error: 'Run not found' });
    return respond(res, 200, {
      runId: job.runId, status: job.status, exitCode: job.exitCode,
      stdout: job.stdout, stderr: job.stderr, artifacts: job.artifacts,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    });
  }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    return respond(res, 200, { status: 'ok', docker: useDocker, active: activeCount, maxConcurrent: MAX_CONCURRENT });
  }

  respond(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[SANDBOX] Runner listening on 127.0.0.1:${PORT} (docker=${useDocker})`);
});

// Cleanup stale jobs every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000);
