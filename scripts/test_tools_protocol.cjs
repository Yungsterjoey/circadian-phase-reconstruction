/**
 * KURO Phase 3 — Tool Protocol Tests
 *
 * Scenarios:
 *  1. Schema validation rejects invalid args
 *  2. Policy enforcement: rate limit + byte cap
 *  3. Tool call recorded in tool_calls table
 *  4. Legacy XML converts to tool call + audited in tool_calls
 *  5. vfs.read/write via JSON tool call
 *  6. runner.spawn via JSON tool call
 *  7. KURO_JSON_TOOLS_ONLY=true blocks legacy XML execution
 *
 * Run: node scripts/test_tools_protocol.cjs
 * Expected output: all PASS lines, exit 0.
 */

'use strict';

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label, condition, info = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${info ? ' — ' + info : ''}`);
    failed++;
  }
}

// ─── Minimal in-memory SQLite DB (mirrors real schema) ───────────────────────
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE tool_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT,
    ts          INTEGER NOT NULL,
    tool        TEXT NOT NULL,
    input_json  TEXT,
    output_json TEXT,
    status      TEXT DEFAULT 'ok',
    ms          INTEGER
  );
  CREATE TABLE runner_jobs (
    job_id      TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    project_id  TEXT,
    cwd         TEXT,
    cmd         TEXT,
    lang        TEXT DEFAULT 'python',
    status      TEXT DEFAULT 'queued',
    exit_code   INTEGER,
    snapshot_id TEXT,
    max_seconds INTEGER DEFAULT 30,
    max_bytes   INTEGER DEFAULT 524288,
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER
  );
  CREATE TABLE runner_logs (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    ts     INTEGER NOT NULL,
    stream TEXT NOT NULL,
    chunk  TEXT NOT NULL
  );
  CREATE TABLE users (
    id   TEXT PRIMARY KEY,
    email TEXT,
    tier TEXT DEFAULT 'pro'
  );
  INSERT INTO users VALUES ('u1', 'test@example.com', 'pro');
`);

// ─── Module under test ────────────────────────────────────────────────────────
const executor   = require('../layers/tools/executor.cjs');
const { POLICIES, PolicyError } = require('../layers/tools/policies.cjs');
const { REGISTRY, SCHEMAS }     = require('../layers/tools/registry.cjs');
const { extractXmlBlocks, convertXmlToToolCall } = require('../layers/tools/xml_compat.cjs');

// ─── Patch registry VFS handlers (no real S3 in CI) ──────────────────────────
// We replace the VFS handlers with in-memory stubs for tests 5.
const _store = new Map(); // path → content

const _origVfsRead  = REGISTRY['vfs.read'].handler;
const _origVfsWrite = REGISTRY['vfs.write'].handler;
const _origVfsList  = REGISTRY['vfs.list'].handler;
const _origVfsMkdir = REGISTRY['vfs.mkdir'].handler;
const _origVfsRm    = REGISTRY['vfs.rm'].handler;
const _origVfsMv    = REGISTRY['vfs.mv'].handler;
const _origVfsStat  = REGISTRY['vfs.stat'].handler;

REGISTRY['vfs.read'].handler  = async ({ path }, userId) => {
  if (!_store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
  return { path, content: _store.get(path), mimeType: 'text/plain' };
};
REGISTRY['vfs.write'].handler = async ({ path, content }, userId) => {
  _store.set(path, content);
  return { ok: true, path, size: Buffer.byteLength(content, 'utf8') };
};
REGISTRY['vfs.list'].handler  = async ({ path = '' }, userId) => {
  const entries = [..._store.keys()].filter(k => k.startsWith(path || '/'));
  return { path: path || '/', entries };
};
REGISTRY['vfs.mkdir'].handler = async ({ path }, userId) => ({ ok: true, path });
REGISTRY['vfs.rm'].handler    = async ({ path }, userId) => { _store.delete(path); return { ok: true }; };
REGISTRY['vfs.mv'].handler    = async ({ src, dst }, userId) => {
  if (!_store.has(src)) throw new Error(`NOT_FOUND: ${src}`);
  _store.set(dst, _store.get(src)); _store.delete(src);
  return { ok: true, src, dst };
};
REGISTRY['vfs.stat'].handler  = async ({ path }, userId) => {
  if (!_store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
  return { path, size: Buffer.byteLength(_store.get(path), 'utf8'), mimeType: 'text/plain' };
};

// Runner handler stub
const _origRunnerSpawn  = REGISTRY['runner.spawn'].handler;
const _origRunnerStatus = REGISTRY['runner.status'].handler;
const _origRunnerKill   = REGISTRY['runner.kill'].handler;
const _origRunnerLogs   = REGISTRY['runner.logs'].handler;

let _spawnSeq = 0;
REGISTRY['runner.spawn'].handler = async ({ cmd, lang = 'python' }, userId, db) => {
  // Use monotonic counter to avoid jobId collisions when tests run concurrently
  const jobId = `test-job-${++_spawnSeq}`;
  db.prepare(`INSERT INTO runner_jobs (job_id, user_id, cmd, lang, status, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?)`).run(jobId, userId, cmd, lang, Date.now());
  return { jobId, status: 'queued', lang, cmd };
};
REGISTRY['runner.status'].handler = async ({ jobId }, userId, db) => {
  const row = db.prepare('SELECT * FROM runner_jobs WHERE job_id=? AND user_id=?').get(jobId, userId);
  if (!row) throw new Error(`Job not found: ${jobId}`);
  return { jobId: row.job_id, status: row.status };
};
REGISTRY['runner.kill'].handler = async ({ jobId }, userId, db) => ({ ok: true, status: 'killed' });
REGISTRY['runner.logs'].handler = async ({ jobId }, userId, db) => ({ jobId, logs: [] });


// ─── SCENARIO 1: Schema validation rejects invalid args ───────────────────────
console.log('\n[1] Schema validation');
(async () => {
  // vfs.read requires `path` — omit it
  const res = await executor.invoke(
    { kuro_tool_call: { id: 'test-1', name: 'vfs.read', args: {} } },
    'u1', db,
  );
  ok('rejects missing required path', res.kuro_tool_result.ok === false);
  ok('error mentions schema', res.kuro_tool_result.error.toLowerCase().includes('schema'));

  // runner.spawn with invalid lang enum
  const res2 = await executor.invoke(
    { kuro_tool_call: { id: 'test-1b', name: 'runner.spawn', args: { cmd: 'main.py', lang: 'ruby' } } },
    'u1', db,
  );
  ok('rejects invalid lang enum', res2.kuro_tool_result.ok === false);

  // unknown tool
  const res3 = await executor.invoke(
    { kuro_tool_call: { id: 'test-1c', name: 'nonexistent.tool', args: {} } },
    'u1', db,
  );
  ok('rejects unknown tool', res3.kuro_tool_result.ok === false);
  ok('error mentions UNKNOWN_TOOL', res3.kuro_tool_result.error.includes('UNKNOWN_TOOL'));
})();

// ─── SCENARIO 2: Policy enforcement ───────────────────────────────────────────
console.log('\n[2] Policy enforcement');
(async () => {
  // Byte cap: vfs.list max_bytes_in = 1024 — send > 1024 bytes of args
  const bigPath = 'a'.repeat(2000);
  const res = await executor.invoke(
    { kuro_tool_call: { id: 'test-2a', name: 'vfs.list', args: { path: bigPath } } },
    'u2', db,
  );
  // First check schema: path maxLength is 1024, so schema rejects first
  ok('byte cap or schema rejects oversized args', res.kuro_tool_result.ok === false);

  // Rate limit: runner.spawn allows 5/min — spam 6 times
  const spawnUser = 'rate-limit-test-user-' + Date.now();
  let blocked = false;
  for (let i = 0; i < 7; i++) {
    const r = await executor.invoke(
      { kuro_tool_call: { id: `rl-${i}`, name: 'runner.spawn', args: { cmd: 'main.py', lang: 'python' } } },
      spawnUser, db,
    );
    if (r.kuro_tool_result.ok === false &&
        r.kuro_tool_result.error &&
        r.kuro_tool_result.error.toLowerCase().includes('rate')) {
      blocked = true;
      break;
    }
  }
  ok('rate limit blocks after max_calls_per_minute', blocked);

  // runner.spawn cmd_pattern: must be .py or .js
  const res2 = await executor.invoke(
    { kuro_tool_call: { id: 'test-2b', name: 'runner.spawn', args: { cmd: '../../etc/passwd' } } },
    'u3', db,
  );
  ok('cmd_pattern blocks path traversal in cmd', res2.kuro_tool_result.ok === false);
  ok('error mentions CMD_NOT_ALLOWED',
    res2.kuro_tool_result.error.includes('CMD_NOT_ALLOWED') ||
    res2.kuro_tool_result.error.includes('cmd') ||
    res2.kuro_tool_result.error.toLowerCase().includes('schema')
  );

  // VFS path traversal
  const res3 = await executor.invoke(
    { kuro_tool_call: { id: 'test-2c', name: 'vfs.read', args: { path: '../../../etc/passwd' } } },
    'u4', db,
  );
  ok('path traversal denied by policy', res3.kuro_tool_result.ok === false);
})();

// ─── SCENARIO 3: Every tool call audited in tool_calls ────────────────────────
console.log('\n[3] Audit trail');
(async () => {
  const before = db.prepare('SELECT COUNT(*) as n FROM tool_calls').get().n;

  // Successful call
  await executor.invoke(
    { kuro_tool_call: { id: 'audit-1', name: 'vfs.write', args: { path: '/test.txt', content: 'hello' } } },
    'u1', db,
  );
  // Failed schema call
  await executor.invoke(
    { kuro_tool_call: { id: 'audit-2', name: 'vfs.read', args: {} } },
    'u1', db,
  );

  const after = db.prepare('SELECT COUNT(*) as n FROM tool_calls').get().n;
  ok('tool_calls rows created for each invocation', after >= before + 2);

  const rows = db.prepare("SELECT * FROM tool_calls ORDER BY id DESC LIMIT 5").all();
  const hasOk    = rows.some(r => r.status === 'ok');
  const hasError = rows.some(r => r.status !== 'ok');
  ok('both ok and error statuses recorded', hasOk && hasError);
  ok('tool name stored in tool column', rows.some(r => r.tool === 'vfs.write'));
})();

// ─── SCENARIO 4: Legacy XML converts and audits ───────────────────────────────
console.log('\n[4] Legacy XML compat');
(async () => {
  // <terminal>python main.py</terminal>
  const blocks1 = extractXmlBlocks('<terminal>python main.py</terminal>');
  ok('terminal tag produces 1 block', blocks1.length === 1);
  ok('terminal converts to runner.spawn', blocks1[0].callEnvelope?.kuro_tool_call?.name === 'runner.spawn');
  ok('terminal infers python lang', blocks1[0].callEnvelope?.kuro_tool_call?.args?.lang === 'python');
  ok('terminal extracts cmd', blocks1[0].callEnvelope?.kuro_tool_call?.args?.cmd === 'main.py');

  // <terminal>node index.js</terminal>
  const blocks2 = extractXmlBlocks('<terminal>node index.js</terminal>');
  ok('node terminal infers node lang', blocks2[0].callEnvelope?.kuro_tool_call?.args?.lang === 'node');

  // <file path="/docs/out.txt">hello world</file>
  const blocks3 = extractXmlBlocks('<file path="/docs/out.txt">hello world</file>');
  ok('file tag produces 1 block', blocks3.length === 1);
  ok('file converts to vfs.write', blocks3[0].callEnvelope?.kuro_tool_call?.name === 'vfs.write');
  ok('file captures path attr', blocks3[0].callEnvelope?.kuro_tool_call?.args?.path === '/docs/out.txt');
  ok('file captures content', blocks3[0].callEnvelope?.kuro_tool_call?.args?.content === 'hello world');

  // <plan> is pass-through (no execution)
  const blocks4 = extractXmlBlocks('<plan>Do X then Y</plan>');
  ok('plan is pass-through', blocks4[0].passThrough === true);
  ok('plan has no callEnvelope', blocks4[0].callEnvelope === null);

  // <think> is pass-through
  const blocks5 = extractXmlBlocks('<think>internal reasoning</think>');
  ok('think is pass-through', blocks5[0].passThrough === true);

  // Path traversal in file tag
  const blocks6 = extractXmlBlocks('<file path="../../etc/passwd">evil</file>');
  ok('file tag with .. path is rejected', blocks6[0].callEnvelope === null);

  // Audit via executor for an XML-converted call
  const envelope = blocks1[0].callEnvelope;
  if (envelope) {
    const before = db.prepare('SELECT COUNT(*) as n FROM tool_calls WHERE tool=?').get('runner.spawn').n;
    await executor.invoke(envelope, 'u1', db);
    const after  = db.prepare('SELECT COUNT(*) as n FROM tool_calls WHERE tool=?').get('runner.spawn').n;
    ok('XML-converted runner.spawn audited in tool_calls', after > before);
  }
})();

// ─── SCENARIO 5: vfs.read/write via JSON tool call ────────────────────────────
console.log('\n[5] vfs.read/write');
(async () => {
  // Write a file
  const w = await executor.invoke(
    { kuro_tool_call: { id: 'vfs-w', name: 'vfs.write', args: { path: '/hello.txt', content: 'world' } } },
    'u1', db,
  );
  ok('vfs.write returns ok=true', w.kuro_tool_result.ok === true);
  ok('vfs.write result has path', w.kuro_tool_result.result?.path === '/hello.txt');

  // Read it back
  const r = await executor.invoke(
    { kuro_tool_call: { id: 'vfs-r', name: 'vfs.read', args: { path: '/hello.txt' } } },
    'u1', db,
  );
  ok('vfs.read returns ok=true', r.kuro_tool_result.ok === true);
  ok('vfs.read returns correct content', r.kuro_tool_result.result?.content === 'world');
})();

// ─── SCENARIO 6: runner.spawn via JSON tool call ──────────────────────────────
console.log('\n[6] runner.spawn');
(async () => {
  const res = await executor.invoke(
    { kuro_tool_call: { id: 'run-1', name: 'runner.spawn', args: { cmd: 'main.py', lang: 'python' } } },
    'u1', db,
  );
  ok('runner.spawn returns ok=true', res.kuro_tool_result.ok === true);
  ok('runner.spawn result has jobId', typeof res.kuro_tool_result.result?.jobId === 'string');
  ok('runner.spawn result has status=queued', res.kuro_tool_result.result?.status === 'queued');

  // Verify audited
  const row = db.prepare("SELECT * FROM tool_calls WHERE tool='runner.spawn' ORDER BY id DESC LIMIT 1").get();
  ok('runner.spawn audited in tool_calls', !!row && row.tool === 'runner.spawn');
})();

// ─── SCENARIO 7: KURO_JSON_TOOLS_ONLY=true blocks legacy XML ─────────────────
console.log('\n[7] KURO_JSON_TOOLS_ONLY flag');
(async () => {
  // Set the env flag and reload the module
  const origEnv = process.env.KURO_JSON_TOOLS_ONLY;
  process.env.KURO_JSON_TOOLS_ONLY = 'true';

  // Invalidate module cache to reload with new env
  delete require.cache[require.resolve('../layers/tools/xml_compat.cjs')];
  const compatOnly = require('../layers/tools/xml_compat.cjs');

  ok('KURO_JSON_TOOLS_ONLY is true in reloaded module', compatOnly.JSON_TOOLS_ONLY === true);

  const blocks = compatOnly.extractXmlBlocks('<terminal>python main.py</terminal>');
  ok('terminal block is blocked when JSON_TOOLS_ONLY=true', blocks[0].blocked === true);
  ok('callEnvelope still present (parsed but blocked)', blocks[0].callEnvelope !== null);

  // Restore
  if (origEnv === undefined) delete process.env.KURO_JSON_TOOLS_ONLY;
  else process.env.KURO_JSON_TOOLS_ONLY = origEnv;
  delete require.cache[require.resolve('../layers/tools/xml_compat.cjs')];
})();

// ─── Summary ─────────────────────────────────────────────────────────────────
// Give async tests time to finish, then report and exit
setTimeout(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
    process.exit(0);
  }
}, 500);
