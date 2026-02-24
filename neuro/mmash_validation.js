/**
 * mmash_validation.js — Physiological Validation of circadian_model.js
 * NEURO-KURO Tier 0 | KURO OS v9
 *
 * Validates the circadian phase engine against the MMASH dataset
 * (Multi-Scale Affect and Sleep History; PhysioNet 1.0.0).
 *
 * Pipeline:
 *   STEP 1 — Replay all sleep rows per subject with default τ=24.2 h
 *   STEP 2 — Anchor CT21 to each subject's final sleep onset clock time
 *   STEP 3 — Compute DLMO error: model phase at DLMO vs anchored reference
 *   STEP 4 — Per-subject τ grid search [23.5, 24.7] step 0.1
 *   STEP 5 — Aggregate MAE, mean signed error, median |err|, min, max
 *   STEP 6 — Run T1–T14 (unit tests) + T15 (MAE threshold); print full table
 *
 * Biological anchor:
 *   model.anchor(7π/4, sleepOnsetHour, sleepOnsetMs) ties CT21 to civil time.
 *   DLMO is estimated as sleepOnsetHour − 2 h (population mean: DLMO ≈ CT14,
 *   CBT_min ≈ CT21, sleep onset ≈ CT21; DLMO precedes sleep onset by ~2 h).
 *   Error = shortestArc(phi_model_at_DLMO − phi_bio_at_DLMO) / 2π × 24.
 *
 * No external libraries. fs, assert, child_process only. Fully deterministic.
 */

'use strict';

const fs          = require('fs');
const assert      = require('assert');
const path        = require('path');
const { execSync } = require('child_process');

const model       = require('./circadian_model.js');
const { _internal } = model;

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA_ROOT   = path.join(__dirname,
  'data/mmash/physionet.org/files/mmash/1.0.0/DataPaper');

const TWO_PI      = 2 * Math.PI;

// Fixed epoch shared with circadian_validation.js for reproducibility.
// 2024-01-15T06:00:00.000Z — arbitrary Monday 06:00 UTC.
const T0          = 1705298400000;

const DEFAULT_TAU = 24.2;                   // h — Czeisler et al., 1999
const TAU_STEP    = 0.1;
const TAU_MIN     = 23.5;
const TAU_MAX     = 24.7;

// Build tau grid with stable rounding to avoid floating-point drift.
const TAU_GRID = [];
for (let i = 0; i <= Math.round((TAU_MAX - TAU_MIN) / TAU_STEP); i++) {
  TAU_GRID.push(Math.round((TAU_MIN + i * TAU_STEP) * 10) / 10);
}

const USER_COUNT  = 22;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY  = 24 * MS_PER_HOUR;

// CT21 in radians — CBT_min / sleep onset anchor.
const CT21 = (7 * Math.PI) / 4;

// DLMO offset from sleep onset (h).  Population mean: DLMO precedes sleep ~2 h.
const DLMO_OFFSET_H = 2;

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into an array of plain objects keyed by header names.
 * Trims whitespace from keys and values. Handles the leading index column.
 */
function parseCSV(text) {
  const lines   = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows    = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const row  = {};
    headers.forEach((h, j) => { row[h] = (vals[j] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

/** "HH:MM" → decimal hours (e.g. "03:30" → 3.5). */
function toDecimalHours(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h + m / 60;
}

/**
 * Build an absolute ms timestamp from a relative day number (1-based, relative
 * to T0) and a "HH:MM" clock string.
 *   ms = T0 + (dayNum − 1) × 24 h + clockHours × 1 h
 */
function buildMs(dayNum, timeStr) {
  return T0 + (dayNum - 1) * MS_PER_DAY + toDecimalHours(timeStr) * MS_PER_HOUR;
}

// ─── Phase arithmetic ─────────────────────────────────────────────────────────

/**
 * Shortest signed arc on S¹: maps x to (−π, π].
 * Uses the same if-chain convention as circadian_model.js shortestArc().
 */
function shortestArc(x) {
  let r = x % TWO_PI;
  if (r >  Math.PI) r -= TWO_PI;
  if (r < -Math.PI) r += TWO_PI;
  return r;
}

/** Array median (non-mutating). */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── Model state helpers ──────────────────────────────────────────────────────

/**
 * Reset model to a canonical initial state and apply τ override.
 * φ₀ = 0 (ACTIVATION), C₀ = 0.5, t₀ = T0.
 * Anchor fields are cleared so they cannot pollute cross-user comparisons.
 */
function resetModel(tau) {
  model.setConfig({ tauHours: tau });
  _internal.setState({
    phaseRadians:       0,
    confidence:         0.5,
    lastUpdateMs:       T0,
    referenceClockHour: null,
    referenceEpochMs:   null,
  });
}

// ─── Core replay + DLMO error ─────────────────────────────────────────────────

/**
 * Reset model, replay all sleep rows sequentially, then:
 *   1. Capture phi_model at DLMO time (before anchor rewrites state).
 *   2. Anchor CT21 to the final sleep onset clock hour.
 *   3. Compute phi_bio = clockToPhase(DLMO_hour).
 *   4. Return signed error in hours.
 *
 * Midnight rollover: if Out Bed ≤ Onset (same date column despite crossing
 * midnight), 24 h is added to Out Bed.
 *
 * @param {object[]} sleepRows   — parsed sleep.csv rows (already filtered)
 * @param {number}   tau         — intrinsic period (hours)
 * @param {number}   finalOnsetMs — ms timestamp of the final sleep onset
 * @param {number}   onsetHours  — clock hour of the final sleep onset
 * @returns {{ phi_model, phi_bio, error_h, confidence }}
 */
function replayForTau(sleepRows, tau, finalOnsetMs, onsetHours) {
  resetModel(tau);

  for (const row of sleepRows) {
    const onsetMs  = buildMs(parseInt(row['Onset Date'],   10), row['Onset Time']);
    let   outBedMs = buildMs(parseInt(row['Out Bed Date'], 10), row['Out Bed Time']);
    if (outBedMs <= onsetMs) outBedMs += MS_PER_DAY;

    model.update({
      sleepOnset:  onsetMs,
      sleepOffset: outBedMs,
      timestamp:   onsetMs,
    });
  }

  // Capture phi_model at DLMO time BEFORE anchor() overwrites state.
  // State has lastUpdateMs = finalOnsetMs, so Δt = −DLMO_OFFSET_H (back-propagation).
  const DLMOms    = finalOnsetMs - DLMO_OFFSET_H * MS_PER_HOUR;
  const phi_model = model.getCurrentPhase(DLMOms).phaseRadians;
  const confidence = model.getCurrentPhase(finalOnsetMs).confidence;

  // Anchor: tie CT21 to subject's actual sleep onset clock time.
  model.anchor(CT21, onsetHours, finalOnsetMs);

  // Biological reference phase at DLMO.
  const DLMO_hour = onsetHours - DLMO_OFFSET_H;
  const phi_bio   = model.clockToPhase(DLMO_hour);

  const error_rad = shortestArc(phi_model - phi_bio);
  const error_h   = error_rad / TWO_PI * 24;

  return { phi_model, phi_bio, error_h, confidence };
}

// ─── Per-user processing ──────────────────────────────────────────────────────

/**
 * Load, validate and process one user directory.
 * Returns null if the directory, saliva.csv, or sleep.csv is absent / empty.
 *
 * @param {string} userId — e.g. "user_3"
 * @returns {object|null}
 */
function processUser(userId) {
  const dir = path.join(DATA_ROOT, userId);
  if (!fs.existsSync(dir)) return null;

  const salivaPath = path.join(dir, 'saliva.csv');
  const sleepPath  = path.join(dir,  'sleep.csv');
  if (!fs.existsSync(salivaPath) || !fs.existsSync(sleepPath)) return null;

  const salivaRows = parseCSV(fs.readFileSync(salivaPath, 'utf8'));
  const sleepRows  = parseCSV(fs.readFileSync(sleepPath,  'utf8'));

  // Require at least one saliva entry ('before sleep') and one sleep row.
  if (!salivaRows.find(r => r['SAMPLES'] === 'before sleep')) return null;

  const validSleep = sleepRows.filter(r => r['Onset Time'] && r['Out Bed Time']);
  if (validSleep.length === 0) return null;

  const finalSleep   = validSleep[validSleep.length - 1];
  const onsetHours   = toDecimalHours(finalSleep['Onset Time']);
  const finalOnsetMs = buildMs(parseInt(finalSleep['Onset Date'], 10), finalSleep['Onset Time']);

  // STEP 1+2+3 — replay default τ, anchor CT21, compute DLMO error.
  const { phi_model, phi_bio, error_h, confidence } =
    replayForTau(validSleep, DEFAULT_TAU, finalOnsetMs, onsetHours);

  // STEP 4 — τ grid search.
  // Initialise from default result; any grid improvement overwrites.
  let optimalTau    = DEFAULT_TAU;
  let optimalErrorH = error_h;

  for (const tau of TAU_GRID) {
    const r = replayForTau(validSleep, tau, finalOnsetMs, onsetHours);
    if (Math.abs(r.error_h) < Math.abs(optimalErrorH)) {
      optimalErrorH = r.error_h;
      optimalTau    = tau;
    }
  }

  return {
    user:              userId,
    phi_model,
    phi_bio,
    error_h,
    abs_error_h:       Math.abs(error_h),
    optimal_tau:       optimalTau,
    optimised_error_h: optimalErrorH,
    confidence,
  };
}

// ─── Unit test runner (T1–T14) ────────────────────────────────────────────────

/**
 * Run circadian_model.test.js in a child process and parse pass/fail lines.
 * Returns an array of { name, pass } in test order.
 */
function runUnitTests() {
  const testPath = path.join(__dirname, 'circadian_model.test.js');
  let rawOut = '';
  try {
    rawOut = execSync(`node "${testPath}" 2>&1`, { encoding: 'utf8' });
  } catch (e) {
    // Non-zero exit = some tests failed; stdout/stderr still have the output.
    rawOut = (e.stdout || '') + (e.stderr || '');
  }

  const results = [];
  for (const line of rawOut.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('✓')) {
      results.push({ name: trimmed.slice(1).trim(), pass: true });
    } else if (trimmed.startsWith('✗')) {
      results.push({ name: trimmed.slice(1).trim(), pass: false });
    }
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Save global model state so this script is side-effect free when require()'d.
const _savedState  = _internal.getState();
const _savedConfig = model.getConfig();

const results = [];
for (let i = 1; i <= USER_COUNT; i++) {
  const uid = `user_${i}`;
  const r   = processUser(uid);
  if (r) results.push(r);
  // Restore tau between users; grid search leaves config at last-searched value.
  model.setConfig({ tauHours: DEFAULT_TAU });
}

// Restore original model state and config.
_internal.setState(_savedState);
model.setConfig(_savedConfig);

if (results.length === 0) {
  console.error('ERROR: no users processed — check DATA_ROOT path');
  process.exit(1);
}

// ─── STEP 5 — Aggregate metrics ───────────────────────────────────────────────

const absErrors      = results.map(r => r.abs_error_h);
const signedErrors   = results.map(r => r.error_h);

const mae_default    = absErrors.reduce((s, v) => s + v, 0) / results.length;
const mae_optimal    = results.reduce((s, r) => s + Math.abs(r.optimised_error_h), 0) / results.length;
const delta_mae      = mae_default - mae_optimal;
const mean_signed    = signedErrors.reduce((s, v) => s + v, 0) / results.length;
const median_abs     = median(absErrors);
const min_abs        = Math.min(...absErrors);
const max_abs        = Math.max(...absErrors);

// ─── Per-user results table ───────────────────────────────────────────────────

const COL = (s, n, right = false) => {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
};
const F4 = n => (typeof n === 'number' ? n.toFixed(4) : String(n));
const F3 = n => (typeof n === 'number' ? n.toFixed(3) : String(n));
const F1 = n => (typeof n === 'number' ? n.toFixed(1) : String(n));

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log('  MMASH CIRCADIAN PHASE VALIDATION — circadian_model.js vs MMASH v1.0.0');
console.log('════════════════════════════════════════════════════════════════════════════\n');
console.log('  Proxy  : CT21 anchored to sleep onset; DLMO estimated as onset − 2 h');
console.log('  Error  : shortestArc(phi_model_DLMO − phi_bio_DLMO) / 2π × 24 h\n');

const HDR =
  COL('user',      9)  +
  COL('φ_model',  10, true) +
  COL('φ_bio',    10, true) +
  COL('err_h',    10, true) +
  COL('|err_h|',  10, true) +
  COL('opt_τ',     8, true) +
  COL('opt_err_h', 11, true) +
  COL('conf',      7, true);

console.log(HDR);
console.log('─'.repeat(75));

for (const r of results) {
  console.log(
    COL(r.user,                    9)  +
    COL(F4(r.phi_model),          10, true) +
    COL(F4(r.phi_bio),            10, true) +
    COL(F4(r.error_h),            10, true) +
    COL(F4(r.abs_error_h),        10, true) +
    COL(F1(r.optimal_tau),         8, true) +
    COL(F4(r.optimised_error_h),  11, true) +
    COL(F3(r.confidence),          7, true)
  );
}

// ─── STEP 5 — Aggregate output ────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log('  AGGREGATE METRICS');
console.log('════════════════════════════════════════════════════════════════════════════\n');
console.log(`  Users processed      : ${results.length}`);
console.log(`  TAU grid             : [${TAU_MIN}, ${TAU_MAX}] step ${TAU_STEP} (${TAU_GRID.length} values)`);
console.log(`  MAE_default_tau      : ${mae_default.toFixed(4)} h  (τ = ${DEFAULT_TAU})`);
console.log(`  MAE_optimal_tau      : ${mae_optimal.toFixed(4)} h  (per-user best τ)`);
console.log(`  ΔMAE                 : ${delta_mae.toFixed(4)} h  (default − optimal)`);
console.log(`  Mean signed error    : ${mean_signed.toFixed(4)} h  (bias; + = model leads)`);
console.log(`  Median |error|       : ${median_abs.toFixed(4)} h`);
console.log(`  Min |error|          : ${min_abs.toFixed(4)} h`);
console.log(`  Max |error|          : ${max_abs.toFixed(4)} h`);

// ─── STEP 6 — Test table T1–T15 ───────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log('  TESTS  T1–T15');
console.log('════════════════════════════════════════════════════════════════════════════\n');

// Run T1–T14 from the unit test file.
const unitResults = runUnitTests();

// Print T1–T14.
for (const t of unitResults) {
  const label  = (t.name.match(/^(T\d+)/)?.[1] ?? '?').padEnd(5);
  const status = t.pass ? 'PASS' : 'FAIL';
  const desc   = t.name.replace(/^T\d+\s*[—–-]*\s*/, '');
  console.log(`  ${label}  ${status}  ${desc}`);
}

// T15: MAE_default_tau < 2.0 h
// Threshold: 2 h is the minimum resolution required for phase-timed clinical
// interventions (light therapy, melatonin).  DLMO assay precision is ±15–30 min;
// a model exceeding 2 h is outside the therapeutic window.
let t15pass = false;
try {
  assert.ok(mae_default < 2.0,
    `T15 FAIL — MAE_default_tau = ${mae_default.toFixed(4)} h (threshold 2.0 h)`);
  console.log(`  T15    PASS  MAE_default_tau = ${mae_default.toFixed(4)} h < 2.0 h (clinical threshold)`);
  t15pass = true;
} catch (_) {
  console.log(`  T15    FAIL  MAE_default_tau = ${mae_default.toFixed(4)} h ≥ 2.0 h` +
              ` — KNOWN_LIMITATION: anchor bias from sleepPhaseObservation()` +
              ` anchoring to 3π/2 rather than 7π/4 introduces ~3 h systematic offset.`);
}

const allUnitPass = unitResults.every(t => t.pass);
const allPass     = allUnitPass && t15pass;
const unitCount   = unitResults.length;
const unitPassed  = unitResults.filter(t => t.pass).length;

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log(`  Unit tests : ${unitPassed}/${unitCount} passed`);
console.log(`  T15        : ${t15pass ? 'PASS' : 'FAIL'}`);
console.log(`  Overall    : ${allPass ? 'PASS — all T1–T15 green' : 'FAIL — see table above'}`);
console.log('════════════════════════════════════════════════════════════════════════════\n');
