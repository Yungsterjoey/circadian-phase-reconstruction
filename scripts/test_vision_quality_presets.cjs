#!/usr/bin/env node
'use strict';
/**
 * test_vision_quality_presets.cjs
 *
 * Default: all tests use dry_run=true — completes in <10s, zero GPU usage.
 * Smoke test (real diffusion) is opt-in:
 *
 *   node scripts/test_vision_quality_presets.cjs                # dry-run only
 *   KURO_VISION_SMOKE_TESTS=1 node scripts/test_vision_quality_presets.cjs
 *
 * Before running smoke test, ensure services are ready:
 *   sudo systemctl restart kuro-flux
 *   sudo systemctl restart kuro-core
 *
 * Do NOT auto-restart services inside this script.
 */

const http = require('http');
const FLUX  = process.env.FLUX_URL || 'http://localhost:3200';
const SMOKE = process.env.KURO_VISION_SMOKE_TESTS === '1';

const DRY_TIMEOUT   = 5000;
const SMOKE_TIMEOUT = 180000;

let passed = 0, failed = 0;
const timings = [];

function ok(l)      { console.log(`    [PASS] ${l}`); passed++; }
function fail(l, r) { console.error(`    [FAIL] ${l}: ${r}`); failed++; }

function post(url, body, timeoutMs = DRY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms — phase stalled`)));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function get(url, timeoutMs = DRY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms — phase stalled`)));
    req.on('error', reject);
  });
}

async function runTest(name, fn) {
  const t0 = Date.now();
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (e) {
    fail(name, e.message);
  }
  const elapsed = Date.now() - t0;
  timings.push({ name, elapsed });
}

async function main() {
  const suiteStart = Date.now();
  console.log('=== Vision Quality Presets Test ===');
  console.log(`Mode: ${SMOKE ? 'dry-run + smoke' : 'dry-run only (set KURO_VISION_SMOKE_TESTS=1 for real generation)'}\n`);

  // ── 1. Health reports presets + caps ──────────────────────────────────────
  await runTest('1. Health exposes presets + caps', async () => {
    const { body } = await get(`${FLUX}/health`);
    const d = JSON.parse(body);
    if (Array.isArray(d.presets) && d.presets.includes('draft') && d.presets.includes('pro'))
      ok(`health.presets = ${JSON.stringify(d.presets)}`);
    else fail('health presets', JSON.stringify(d.presets));
    if (d.max_steps >= 40) ok(`health.max_steps = ${d.max_steps}`);
    else fail('max_steps', d.max_steps);
    if (d.max_size >= 1024) ok(`health.max_size = ${d.max_size}`);
    else fail('max_size', d.max_size);
  });

  // ── 2. Draft preset — negative_prompt + preset echo (dry_run) ────────────
  await runTest('2. Draft preset — negative_prompt + preset echo (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'green circle on white background', preset: 'draft', dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('draft dry_run', d.error); return; }
    if (d.dry_run !== true) { fail('dry_run flag', d.dry_run); return; }
    ok(`dry_run acknowledged`);
    if (d.resolved.preset === 'draft') ok('preset echoed = draft');
    else fail('preset echo', d.resolved.preset);
    if (d.resolved.negative_prompt && d.resolved.negative_prompt.length > 0)
      ok(`negative_prompt: "${d.resolved.negative_prompt.slice(0, 60)}…"`);
    else fail('negative_prompt', 'empty or missing');
    if (d.resolved.steps === 4) ok(`steps = ${d.resolved.steps} (draft)`);
    else fail('draft steps', d.resolved.steps);
  });

  // ── 3. Seed resolution — explicit seed passed through (dry_run) ───────────
  await runTest('3. Seed resolution — explicit seed (dry_run)', async () => {
    const r1 = await post(`${FLUX}/generate`,
      { prompt: 'blue square', preset: 'draft', seed: 42, dry_run: true });
    const d1 = JSON.parse(r1.body);
    const r2 = await post(`${FLUX}/generate`,
      { prompt: 'blue square', preset: 'draft', seed: 42, dry_run: true });
    const d2 = JSON.parse(r2.body);
    if (d1.success && d2.success && d1.resolved.seed === 42 && d2.resolved.seed === 42)
      ok(`seed=42 resolved correctly in both calls`);
    else fail('seed resolution', `d1.seed=${d1.resolved?.seed} d2.seed=${d2.resolved?.seed}`);
  });

  // ── 4. Aspect ratio 16:9 → width > height (dry_run) ──────────────────────
  await runTest('4. Aspect ratio 16:9 → width > height (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'mountain landscape', preset: 'draft', aspect_ratio: '16:9', dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('aspect 16:9', d.error); return; }
    const { width, height } = d.dimensions;
    if (width > height) ok(`16:9 → ${width}×${height}`);
    else fail('16:9 dims', `${width}×${height} — expected width > height`);
  });

  // ── 5. Aspect ratio 9:16 → height > width (dry_run) ──────────────────────
  await runTest('5. Aspect ratio 9:16 → height > width (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'tall tree', preset: 'draft', aspect_ratio: '9:16', dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('aspect 9:16', d.error); return; }
    const { width, height } = d.dimensions;
    if (height > width) ok(`9:16 → ${width}×${height}`);
    else fail('9:16 dims', `${width}×${height}`);
  });

  // ── 6. n=2 resolved correctly (dry_run) ───────────────────────────────────
  await runTest('6. n=2 resolved (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'small red dot', preset: 'draft', n: 2, dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('n=2', d.error); return; }
    if (d.resolved.n === 2) ok(`n=2 resolved correctly`);
    else fail('n=2 resolved', `got ${d.resolved.n}`);
  });

  // ── 7. n cap: n=99 clamped to MAX_N (dry_run) ─────────────────────────────
  await runTest('7. n cap — n=99 clamped to max (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'tiny dot', preset: 'draft', n: 99, dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('n cap', d.error); return; }
    if (d.resolved.n <= 4) ok(`n=99 clamped to ${d.resolved.n}`);
    else fail('n cap', `resolved ${d.resolved.n} — expected ≤ 4`);
  });

  // ── 8. Pro preset — steps + guidance_scale (dry_run) ─────────────────────
  await runTest('8. Pro preset — steps + guidance_scale (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'detailed artwork', preset: 'pro', dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('pro preset', d.error); return; }
    if (d.resolved.steps === 28) ok(`pro steps = ${d.resolved.steps}`);
    else fail('pro steps', d.resolved.steps);
    if (d.resolved.guidance_scale === 5.5) ok(`pro guidance = ${d.resolved.guidance_scale}`);
    else fail('pro guidance', d.resolved.guidance_scale);
  });

  // ── 9. Balanced preset (dry_run) ──────────────────────────────────────────
  await runTest('9. Balanced preset (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'city skyline', preset: 'balanced', dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('balanced preset', d.error); return; }
    if (d.resolved.steps === 14) ok(`balanced steps = ${d.resolved.steps}`);
    else fail('balanced steps', d.resolved.steps);
    if (d.resolved.guidance_scale === 4.5) ok(`balanced guidance = ${d.resolved.guidance_scale}`);
    else fail('balanced guidance', d.resolved.guidance_scale);
  });

  // ── 10. Steps cap: steps=999 clamped (dry_run) ────────────────────────────
  await runTest('10. Steps cap — steps=999 clamped (dry_run)', async () => {
    const { body } = await post(`${FLUX}/generate`,
      { prompt: 'test', steps: 999, dry_run: true });
    const d = JSON.parse(body);
    if (!d.success) { fail('steps cap', d.error); return; }
    if (d.resolved.steps <= 40) ok(`steps=999 clamped to ${d.resolved.steps}`);
    else fail('steps cap', `resolved ${d.resolved.steps} — expected ≤ 40`);
  });

  // ── SMOKE: One real generation — opt-in only ───────────────────────────────
  if (SMOKE) {
    await runTest('SMOKE. Real generation — draft preset (live GPU)', async () => {
      console.log('    [INFO] Running real generation — this may take 30-120s');
      const { body } = await post(
        `${FLUX}/generate`,
        { prompt: 'a small green circle on a white background', preset: 'draft', seed: 1 },
        SMOKE_TIMEOUT
      );
      const d = JSON.parse(body);
      if (!d.success) { fail('smoke generation', d.error); return; }
      ok(`smoke: elapsed=${d.elapsed}s hash=${d.hash} seed=${d.seed}`);
      if (d.base64 && d.base64.length > 100) ok('base64 image data present');
      else fail('smoke base64', 'missing or too short');
      if (d.negative_prompt) ok('negative_prompt present');
      else fail('smoke negative_prompt', 'missing');
    });
  } else {
    console.log('\n[SMOKE] Skipped — real generation disabled by default.');
    console.log('        To enable: KURO_VISION_SMOKE_TESTS=1 node scripts/test_vision_quality_presets.cjs');
    console.log('        Before running: sudo systemctl restart kuro-flux && sudo systemctl restart kuro-core');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalMs = Date.now() - suiteStart;
  const slowest = timings.reduce((a, b) => a.elapsed > b.elapsed ? a : b, { name: '-', elapsed: 0 });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results : ${passed} passed, ${failed} failed`);
  console.log(`Runtime : ${(totalMs / 1000).toFixed(2)}s total`);
  console.log(`Slowest : "${slowest.name}" (${slowest.elapsed}ms)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
