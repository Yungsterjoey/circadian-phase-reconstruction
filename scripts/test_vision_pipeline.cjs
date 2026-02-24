/**
 * KURO Vision Pipeline Smoke Test
 *
 * Asserts:
 *   1. FLUX /health returns ok
 *   2. FLUX /generate returns a real JPG/PNG with filename
 *   3. File exists at VISION_DIR/<filename>
 *   4. /api/vision/image/<filename> returns 200
 *   5. extractVisionCall parses tool call JSON (no-regex path)
 *   6. Duplicate tool ID is ignored by dedup logic
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FLUX_URL   = process.env.FLUX_URL  || 'http://localhost:3200';
const KURO_URL   = process.env.KURO_URL  || 'http://localhost:3100';
const VISION_DIR = process.env.KURO_VISION_DIR || '/var/lib/kuro/vision';

let passed = 0, failed = 0;

function ok(label) { console.log(`  [PASS] ${label}`); passed++; }
function fail(label, reason) { console.error(`  [FAIL] ${label}: ${reason}`); failed++; }

function writeProbe(dir) {
  const fp = path.join(dir, `.kuro_write_probe_${process.pid}_${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, 'ok');
    fs.unlinkSync(fp);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── 1. extractVisionCall unit tests ─────────────────────────────────────────

function testExtractVisionCall() {
  console.log('\n[1] extractVisionCall unit tests');

  // Inline the function from server.cjs to test it independently
  function extractVisionCall(text) {
    const idx = text.indexOf('"kuro_tool_call"');
    if (idx === -1) return null;
    const start = text.lastIndexOf('{', idx);
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (inStr) { if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const raw = text.slice(start, i + 1);
            const p = JSON.parse(raw);
            if (p?.kuro_tool_call?.name === 'vision.generate') return { raw, args: p.kuro_tool_call.args || {} };
          } catch {}
          return null;
        }
      }
    }
    return null;
  }

  // Basic
  const basic = `{"kuro_tool_call":{"id":"vision-1","name":"vision.generate","args":{"prompt":"a red cat"}}}`;
  const r1 = extractVisionCall(basic);
  if (r1?.args?.prompt === 'a red cat') ok('basic JSON parses correctly');
  else fail('basic JSON', `got ${JSON.stringify(r1)}`);

  // With } inside prompt string
  const tricky = `{"kuro_tool_call":{"id":"vision-1","name":"vision.generate","args":{"prompt":"a bunch of {flowers} in a vase"}}}`;
  const r2 = extractVisionCall(tricky);
  if (r2?.args?.prompt === 'a bunch of {flowers} in a vase') ok('} inside prompt string handled');
  else fail('} inside prompt string', `got ${JSON.stringify(r2)}`);

  // With extra whitespace
  const spaced = `{ "kuro_tool_call" : { "id" : "vision-1" , "name" : "vision.generate" , "args" : { "prompt" : "a sunset" } } }`;
  const r3 = extractVisionCall(spaced);
  if (r3?.args?.prompt === 'a sunset') ok('extra whitespace handled');
  else fail('extra whitespace', `got ${JSON.stringify(r3)}`);

  // No tool call
  const empty = `Hello world, no tool call here.`;
  const r4 = extractVisionCall(empty);
  if (r4 === null) ok('no tool call returns null');
  else fail('no tool call', `got ${JSON.stringify(r4)}`);

  // Preceded by text
  const withText = `Sure! I'll generate that.\n{"kuro_tool_call":{"id":"vision-1","name":"vision.generate","args":{"prompt":"a mountain"}}}`;
  const r5 = extractVisionCall(withText);
  if (r5?.args?.prompt === 'a mountain') ok('text before tool call handled');
  else fail('text before tool call', `got ${JSON.stringify(r5)}`);

  // Strip: confirm raw removal leaves clean text
  if (r5) {
    const stripped = withText.replace(r5.raw, '').trim();
    if (!stripped.includes('kuro_tool_call')) ok('stripping raw removes tool call from history');
    else fail('strip', `still contains kuro_tool_call after strip`);
  }
}

// ─── 2. Vision dir write probe ───────────────────────────────────────────────

function testVisionDirWrite() {
  console.log('\n[2] Vision dir write probe');
  const r = writeProbe(VISION_DIR);
  if (r.ok) ok(`Writable: ${VISION_DIR}`);
  else fail('vision dir write probe', r.error);
}

// ─── 3. FLUX health ───────────────────────────────────────────────────────────

async function testFluxHealth() {
  console.log('\n[3] FLUX /health');
  try {
    const { status, body } = await get(`${FLUX_URL}/health`);
    const d = JSON.parse(body);
    if (d.ok) ok(`FLUX healthy (device=${d.device}, VRAM=${d.vram_free_mb}MB)`);
    else fail('FLUX health', `ok=false: ${body}`);
  } catch(e) { fail('FLUX health', e.message); }
}

// ─── 4. FLUX /reset (OOM recovery hook) ──────────────────────────────────────

async function testFluxReset() {
  console.log('\n[4] FLUX /reset');
  try {
    const { status, body } = await post(`${FLUX_URL}/reset`, { reason: 'test', warm: true });
    const d = JSON.parse(body);
    if (status === 200 && d.ok) ok(`FLUX reset ok (warmed=${d.warmed})`);
    else fail('FLUX reset', `HTTP ${status} ${body}`);
  } catch(e) { fail('FLUX reset', e.message); }
}

// ─── 5. FLUX /generate ────────────────────────────────────────────────────────

async function testFluxGenerate() {
  console.log('\n[5] FLUX /generate');
  try {
    const { status, body } = await post(`${FLUX_URL}/generate`, {
      prompt: 'a simple red circle on white background',
      steps: 4,
      width: 512,
      height: 512,
    });
    const d = JSON.parse(body);
    if (!d.success) { fail('FLUX generate', d.error || 'success=false'); return null; }
    if (!d.filename) { fail('FLUX generate', 'no filename in response'); return null; }
    ok(`FLUX generated: ${d.filename} (${d.elapsed}s, seed=${d.seed})`);
    return d.filename;
  } catch(e) { fail('FLUX generate', e.message); return null; }
}

// ─── 6. File exists ───────────────────────────────────────────────────────────

function testFileExists(filename) {
  console.log('\n[6] File exists on disk');
  if (!filename) { fail('file exists', 'no filename to check'); return; }
  const fp = path.join(VISION_DIR, filename);
  if (fs.existsSync(fp)) {
    const size = fs.statSync(fp).size;
    ok(`${fp} exists (${(size/1024).toFixed(1)} KB)`);
  } else {
    fail('file exists', `${fp} not found`);
  }
}

// ─── 7. Image URL reachable ───────────────────────────────────────────────────

async function testImageUrl(filename) {
  console.log('\n[7] /api/vision/image/:filename reachable');
  if (!filename) { fail('image URL', 'no filename to check'); return; }
  try {
    const { status } = await get(`${KURO_URL}/api/vision/image/${filename}`);
    if (status === 200) ok(`GET /api/vision/image/${filename} → 200`);
    else fail('image URL', `HTTP ${status}`);
  } catch(e) { fail('image URL', e.message); }
}

// ─── 8. Duplicate tool ID ignored ────────────────────────────────────────────

function testDedup() {
  console.log('\n[8] Duplicate tool ID dedup');

  // Simulate the executedToolIds Set logic from KuroChatApp.jsx
  const executedToolIds = new Set();
  let callCount = 0;

  function mockHandleCall(toolId) {
    if (executedToolIds.has(toolId)) {
      console.warn(`    [VISION_TOOL_LOOP_ABORT] toolId=${toolId} already executed — skipping`);
      return;
    }
    executedToolIds.add(toolId);
    callCount++;
  }

  mockHandleCall('vision-1');
  mockHandleCall('vision-1'); // duplicate
  mockHandleCall('vision-1'); // duplicate

  if (callCount === 1) ok('duplicate tool ID skipped (only 1 execution)');
  else fail('dedup', `expected 1 execution, got ${callCount}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== KURO Vision Pipeline Test ===\n');

  testExtractVisionCall();
  testVisionDirWrite();
  await testFluxHealth();
  await testFluxReset();
  const filename = await testFluxGenerate();
  testFileExists(filename);
  await testImageUrl(filename);
  testDedup();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Test runner error:', e.message); process.exit(1); });
