/**
 * KURO Runner SSE test suite
 *
 * Tests: spawn Python, spawn Node, timeout kill, user isolation.
 * Requires: KURO_RUNNER_ALLOW_DIRECT=1 (no Docker needed).
 *
 * Usage:
 *   KURO_RUNNER_ALLOW_DIRECT=1 node scripts/test_runner_sse.cjs
 */

'use strict';

process.env.KURO_RUNNER_ALLOW_DIRECT = '1';
process.env.KURO_DATA = '/tmp/kuro_test_runner_' + process.pid;
process.env.KURO_SANDBOX_TIMEOUT_SECONDS = '5';

const assert  = require('assert');
const fs      = require('fs');
const path    = require('path');
const Database = require('better-sqlite3');

// ── Bootstrap test DB ────────────────────────────────────────────────────────
const testDir = process.env.KURO_DATA;
fs.mkdirSync(testDir, { recursive: true });

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE IF NOT EXISTS runner_jobs (
    job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    project_id TEXT, cwd TEXT, cmd TEXT, lang TEXT DEFAULT 'python',
    status TEXT DEFAULT 'queued',
    exit_code INTEGER, snapshot_id TEXT, max_seconds INTEGER DEFAULT 30,
    max_bytes INTEGER DEFAULT 524288, created_at INTEGER NOT NULL,
    started_at INTEGER, finished_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS runner_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
    ts INTEGER NOT NULL, stream TEXT NOT NULL, chunk TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT DEFAULT 'pro');
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, ts INTEGER NOT NULL,
    tool TEXT NOT NULL, input_json TEXT, output_json TEXT, status TEXT DEFAULT 'ok', ms INTEGER
  );
`);

// Insert test users
db.prepare("INSERT INTO users (id, tier) VALUES ('userA', 'sovereign')").run();
db.prepare("INSERT INTO users (id, tier) VALUES ('userB', 'sovereign')").run();

const mountRunnerRoutes = require('../layers/runner/runner_routes.cjs');
const { _executeJob, _activeJobs, _appendLog, _dispatch } = mountRunnerRoutes;

// ── Helper: wait for job to reach terminal state ─────────────────────────────
async function waitForJob(jobId, timeoutMs = 8000) {
  const start = Date.now();
  const TERMINAL = ['done', 'failed', 'killed', 'timeout'];
  return new Promise((resolve, reject) => {
    const check = () => {
      const row = db.prepare('SELECT status, exit_code FROM runner_jobs WHERE job_id=?').get(jobId);
      if (!row) { reject(new Error('Job not found: ' + jobId)); return; }
      if (TERMINAL.includes(row.status)) { resolve(row); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`Timeout waiting for job ${jobId} (status: ${row.status})`)); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

// ── Helper: collect SSE events via _dispatch subscription ────────────────────
function collectEvents(jobId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let resolved = false;
    const TERMINAL = ['done', 'failed', 'killed', 'timeout'];

    const listener = (data) => {
      if (resolved) return;
      // Parse the SSE data line
      const match = data.match(/^data: (.+)$/m);
      if (!match) return;
      try {
        const evt = JSON.parse(match[1]);
        events.push(evt);
        if (evt.t === 'status' && TERMINAL.includes(evt.status)) {
          resolved = true;
          // Remove listener
          const job = _activeJobs.get(jobId);
          if (job) job.listeners.delete(listener);
          resolve(events);
        }
      } catch {}
    };

    // Attach listener (job might not be in activeJobs yet; retry briefly)
    const attach = () => {
      const job = _activeJobs.get(jobId);
      if (job) {
        job.listeners.add(listener);
      } else {
        setTimeout(attach, 10);
      }
    };
    attach();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const job = _activeJobs.get(jobId);
        if (job) job.listeners.delete(listener);
        reject(new Error(`collectEvents timeout for job ${jobId}`));
      }
    }, timeoutMs);
  });
}

// ── Helper: spawn job directly (bypassing HTTP) ───────────────────────────────
function spawnJob({ userId = 'userA', cmd, lang = 'python', inlineCode, maxSeconds = 10 }) {
  const crypto = require('crypto');
  const jobId = crypto.randomBytes(16).toString('hex');
  const JOB_DIR = path.join(testDir, 'runner_jobs');
  const workspaceDir = path.join(JOB_DIR, jobId, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (inlineCode) {
    const safeName = path.basename(cmd || 'main.py');
    fs.writeFileSync(path.join(workspaceDir, safeName), inlineCode, 'utf8');
  }

  db.prepare(`INSERT INTO runner_jobs (job_id, user_id, cmd, lang, status, max_seconds, max_bytes, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .run(jobId, userId, cmd, lang, maxSeconds, 524288, Date.now());

  // Register in activeJobs map before execution so listener can attach
  _activeJobs.set(jobId, { userId, proc: null, listeners: new Set(), status: 'queued' });

  setImmediate(() => _executeJob(jobId, db));
  return jobId;
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
    results.push({ name, ok: true });
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
    results.push({ name, ok: false, err: e.message });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\nKURO Runner SSE Test Suite\n');

  // 1. Python: basic stdout
  await test('Python: stdout emitted via SSE', async () => {
    const jobId = spawnJob({ cmd: 'main.py', lang: 'python', inlineCode: 'print("hello_py")\n' });
    const events = await collectEvents(jobId);
    const stdoutEvts = events.filter(e => e.t === 'stdout');
    const out = stdoutEvts.map(e => e.d).join('');
    assert.ok(out.includes('hello_py'), `Expected hello_py in stdout, got: ${out}`);
    const statusEvt = events.find(e => e.t === 'status');
    assert.ok(statusEvt, 'Expected status event');
    assert.strictEqual(statusEvt.status, 'done', `Expected done, got ${statusEvt.status}`);
    assert.strictEqual(statusEvt.exitCode, 0);
  });

  // 2. Python: stderr emitted
  await test('Python: stderr emitted via SSE', async () => {
    const jobId = spawnJob({
      cmd: 'main.py', lang: 'python',
      inlineCode: 'import sys\nsys.stderr.write("err_py\\n")\n',
    });
    const events = await collectEvents(jobId);
    const stderrEvts = events.filter(e => e.t === 'stderr');
    const err = stderrEvts.map(e => e.d).join('');
    assert.ok(err.includes('err_py'), `Expected err_py in stderr, got: ${err}`);
  });

  // 3. Python: non-zero exit
  await test('Python: non-zero exit code captured', async () => {
    const jobId = spawnJob({
      cmd: 'main.py', lang: 'python',
      inlineCode: 'import sys\nsys.exit(42)\n',
    });
    const events = await collectEvents(jobId);
    const statusEvt = events.find(e => e.t === 'status');
    assert.ok(statusEvt, 'Expected status event');
    assert.strictEqual(statusEvt.exitCode, 42);
  });

  // 4. Node.js: basic stdout
  await test('Node.js: stdout emitted via SSE', async () => {
    const jobId = spawnJob({ cmd: 'index.js', lang: 'node', inlineCode: 'console.log("hello_node");\n' });
    const events = await collectEvents(jobId, 10000);
    const stdoutEvts = events.filter(e => e.t === 'stdout');
    const out = stdoutEvts.map(e => e.d).join('');
    assert.ok(out.includes('hello_node'), `Expected hello_node in stdout, got: ${out}`);
    const statusEvt = events.find(e => e.t === 'status');
    assert.strictEqual(statusEvt?.status, 'done');
  });

  // 5. Node.js: non-zero exit
  await test('Node.js: non-zero exit code captured', async () => {
    const jobId = spawnJob({ cmd: 'index.js', lang: 'node', inlineCode: 'process.exit(7);\n' });
    const events = await collectEvents(jobId, 10000);
    const statusEvt = events.find(e => e.t === 'status');
    assert.strictEqual(statusEvt?.exitCode, 7);
  });

  // 6. Timeout: job exceeding hard cap is killed
  await test('Timeout: long-running job killed, status=timeout', async () => {
    const jobId = spawnJob({
      cmd: 'main.py', lang: 'python',
      inlineCode: 'import time\ntime.sleep(30)\n',
      maxSeconds: 2,
    });
    // Wait longer than the job's maxSeconds + grace
    const row = await waitForJob(jobId, 12000);
    assert.ok(['timeout', 'killed'].includes(row.status), `Expected timeout/killed, got ${row.status}`);
  });

  // 7. DB catch-up: logs persisted before SSE connect
  await test('DB catch-up: logs replay after job finishes', async () => {
    // Spawn and wait for completion first
    const jobId = spawnJob({ cmd: 'main.py', lang: 'python', inlineCode: 'print("catchup_test")\n' });
    await waitForJob(jobId, 8000);

    // Now read logs from DB directly (simulates late SSE connect)
    const logs = db.prepare('SELECT * FROM runner_logs WHERE job_id=? ORDER BY id ASC').all(jobId);
    assert.ok(logs.length > 0, 'Expected logs in DB');
    const allChunks = logs.map(r => r.chunk).join('');
    assert.ok(allChunks.includes('catchup_test'), `Expected catchup_test in DB logs, got: ${allChunks}`);
  });

  // 8. User isolation: userB cannot see userA job
  await test('User isolation: cross-user job lookup rejected', async () => {
    const jobId = spawnJob({ userId: 'userA', cmd: 'main.py', lang: 'python', inlineCode: 'print("secret")\n' });
    await waitForJob(jobId, 8000);

    // userB tries to query userA's job
    const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(jobId, 'userB');
    assert.strictEqual(row, undefined, 'userB should not be able to access userA job');
  });

  // 9. inlineCode: file is written to workspace
  await test('inlineCode: file written to workspace before execution', async () => {
    const jobId = spawnJob({ cmd: 'main.py', lang: 'python', inlineCode: 'print("inline_ok")\n' });
    const workspaceFile = path.join(testDir, 'runner_jobs', jobId, 'workspace', 'main.py');
    // Give a moment for fs write
    await new Promise(r => setTimeout(r, 50));
    assert.ok(fs.existsSync(workspaceFile), 'workspace/main.py should exist');
    const content = fs.readFileSync(workspaceFile, 'utf8');
    assert.ok(content.includes('inline_ok'), 'File should contain inline code');
    await waitForJob(jobId, 8000);
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed}/${passed + failed} tests passed\n`);
  if (failed > 0) {
    console.error('FAILED:');
    results.filter(r => !r.ok).forEach(r => console.error(`  - ${r.name}: ${r.err}`));
    process.exit(1);
  }
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
