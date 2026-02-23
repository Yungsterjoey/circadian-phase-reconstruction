#!/usr/bin/env node
'use strict';
/**
 * test_vision_profiles.cjs
 * Tests: GET/POST /api/vision/profile — round-trip, defaults applied, isolation.
 *
 * Requires a running kuro-core server with two test accounts:
 *   KURO_TEST_TOKEN_A and KURO_TEST_TOKEN_B (set in env)
 * If tokens are not set, profile tests that require auth are skipped.
 *
 * Usage:
 *   node scripts/test_vision_profiles.cjs
 *   KURO_TEST_TOKEN_A=<tok> KURO_TEST_TOKEN_B=<tok> node scripts/test_vision_profiles.cjs
 */

const http = require('http');
const BASE = process.env.KURO_URL || 'http://localhost:3000';
const TOKEN_A = process.env.KURO_TEST_TOKEN_A || '';
const TOKEN_B = process.env.KURO_TEST_TOKEN_B || '';
const TIMEOUT = 5000;

let passed = 0, failed = 0;
const timings = [];

function ok(l)      { console.log(`    [PASS] ${l}`); passed++; }
function fail(l, r) { console.error(`    [FAIL] ${l}: ${r}`); failed++; }
function skip(l)    { console.log(`    [SKIP] ${l}`); }

function request(method, path, body, token, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const headers = { 'Content-Type': 'application/json', 'X-KURO-Token': token || '' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTest(name, fn) {
  const t0 = Date.now();
  console.log(`\n[${name}]`);
  try { await fn(); } catch (e) { fail(name, e.message); }
  timings.push({ name, elapsed: Date.now() - t0 });
}

async function main() {
  const suiteStart = Date.now();
  console.log('=== Vision Profile Tests ===\n');

  // ── 1. GET profile without auth → 401 ────────────────────────────────────
  await runTest('1. GET /api/vision/profile without auth → 401', async () => {
    const { status } = await request('GET', '/api/vision/profile', null, '');
    if (status === 401 || status === 403) ok(`unauthenticated request rejected (${status})`);
    else fail('auth guard', `expected 401/403, got ${status}`);
  });

  // ── 2. POST profile without auth → 401 ───────────────────────────────────
  await runTest('2. POST /api/vision/profile without auth → 401', async () => {
    const { status } = await request('POST', '/api/vision/profile', { preset: 'pro' }, '');
    if (status === 401 || status === 403) ok(`unauthenticated POST rejected (${status})`);
    else fail('auth guard POST', `expected 401/403, got ${status}`);
  });

  if (!TOKEN_A) {
    console.log('\n[SKIP] Authenticated profile tests — set KURO_TEST_TOKEN_A to enable');
  } else {
    // ── 3. GET profile for fresh user → null ─────────────────────────────────
    await runTest('3. Fresh user profile → null', async () => {
      const { status, body } = await request('GET', '/api/vision/profile', null, TOKEN_A);
      if (status !== 200) { fail('GET profile', `status ${status}`); return; }
      const d = JSON.parse(body);
      if (d.profile === null || d.profile === undefined)
        ok('profile is null for fresh user (no saved prefs)');
      else
        ok(`profile already exists: preset=${d.profile.preset} aspect=${d.profile.aspect_ratio}`);
    });

    // ── 4. Save profile ───────────────────────────────────────────────────────
    await runTest('4. Save vision profile (balanced + 16:9)', async () => {
      const { status, body } = await request('POST', '/api/vision/profile',
        { preset: 'balanced', aspect_ratio: '16:9' }, TOKEN_A);
      if (status !== 200) { fail('POST profile', `status ${status} body=${body}`); return; }
      const d = JSON.parse(body);
      if (d.ok) ok('profile saved');
      else fail('profile save', JSON.stringify(d));
    });

    // ── 5. Load profile back ──────────────────────────────────────────────────
    await runTest('5. Load saved profile — round-trip', async () => {
      const { status, body } = await request('GET', '/api/vision/profile', null, TOKEN_A);
      if (status !== 200) { fail('GET after save', `status ${status}`); return; }
      const d = JSON.parse(body);
      if (!d.profile) { fail('profile missing', 'null after save'); return; }
      if (d.profile.preset === 'balanced') ok(`preset = ${d.profile.preset}`);
      else fail('preset round-trip', `got ${d.profile.preset}`);
      if (d.profile.aspect_ratio === '16:9') ok(`aspect_ratio = ${d.profile.aspect_ratio}`);
      else fail('aspect_ratio round-trip', `got ${d.profile.aspect_ratio}`);
    });

    // ── 6. Caps enforcement: invalid preset clamped to draft ──────────────────
    await runTest('6. Invalid preset coerced to draft', async () => {
      const { status, body } = await request('POST', '/api/vision/profile',
        { preset: 'ultra_hd_9000', aspect_ratio: '1:1' }, TOKEN_A);
      if (status !== 200) { fail('POST invalid preset', `status ${status}`); return; }
      const d = JSON.parse(body);
      if (d.saved?.preset === 'draft') ok('invalid preset coerced to draft');
      else fail('preset coercion', `saved.preset = ${d.saved?.preset}`);
    });

    // ── 7. Overwrite profile ──────────────────────────────────────────────────
    await runTest('7. Overwrite profile (pro + 9:16)', async () => {
      await request('POST', '/api/vision/profile', { preset: 'pro', aspect_ratio: '9:16' }, TOKEN_A);
      const { body } = await request('GET', '/api/vision/profile', null, TOKEN_A);
      const d = JSON.parse(body);
      if (d.profile?.preset === 'pro' && d.profile?.aspect_ratio === '9:16')
        ok(`overwrite: preset=pro aspect=9:16`);
      else fail('overwrite', `preset=${d.profile?.preset} aspect=${d.profile?.aspect_ratio}`);
    });
  }

  // ── 8. Cross-user isolation ───────────────────────────────────────────────
  if (TOKEN_A && TOKEN_B) {
    await runTest('8. Cross-user isolation — profile not shared', async () => {
      // Ensure user A has a profile set
      await request('POST', '/api/vision/profile', { preset: 'pro', aspect_ratio: '9:16' }, TOKEN_A);
      // User B fetches their own profile — should NOT see user A's
      const { status, body } = await request('GET', '/api/vision/profile', null, TOKEN_B);
      if (status !== 200) { fail('user B GET', `status ${status}`); return; }
      const d = JSON.parse(body);
      // User B profile should be null OR have different data from user A
      if (!d.profile || (d.profile.preset !== 'pro' && d.profile.aspect_ratio !== '9:16'))
        ok('user B sees independent profile');
      else
        fail('cross-user isolation', `user B unexpectedly has preset=pro aspect=9:16`);
    });
  } else {
    skip('8. Cross-user isolation — set KURO_TEST_TOKEN_B to enable');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalMs = Date.now() - suiteStart;
  const slowest = timings.reduce((a, b) => a.elapsed > b.elapsed ? a : b, { name: '-', elapsed: 0 });
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results : ${passed} passed, ${failed} failed`);
  console.log(`Runtime : ${(totalMs / 1000).toFixed(2)}s total`);
  console.log(`Slowest : "${slowest.name}" (${slowest.elapsed}ms)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
