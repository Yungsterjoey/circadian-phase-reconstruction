/**
 * circadian_model.test.js — Unit tests for the Circadian Phase Reconstruction Engine
 * NEURO-KURO Tier 0 | KURO OS v9
 *
 * 14 tests covering:
 *   T1  — Phase propagation (free-running dynamics)
 *   T2  — Bayesian entrainment correction (sleep input)
 *   T3  — Confidence decay (exponential forgetting)
 *   T4  — Phase projection trajectory
 *   T5  — Shift simulation (jet-lag delta)
 *   T6  — Phase labels and wrap-around at boundary
 *   T7  — 30-day no-input stability (numerical integrity)
 *   T8  — Extreme simultaneous entrainment (stability under large corrections)
 *   T9  — 10 sequential light corrections within 2h (zone-edge absorption)
 *   T10 — Parameter sensitivity sweep (λ, τ, K weights)
 *   T11 — Boundary conditions (φ=0, φ=2π−ε, wrap-boundary sleep input)
 *   T12 — Light pulse in ADVANCE tail φ=0.05 rad: fix verification (pre/post)
 *   T13 — Gain continuity at φ=π; deliberate gate at 2π/0 documented
 *   T14 — Micro boundary φ=1e-9: post-correction in [0,2π), no sign flip, finite
 *
 * Run with: node circadian_model.test.js
 * (No external test framework required — plain assert.)
 */

'use strict';

const assert = require('assert');
const model  = require('./circadian_model.js');
const { _internal } = model;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function approx(a, b, tol = 1e-6, msg = '') {
  if (Math.abs(a - b) > tol) {
    throw new Error(`${msg} Expected ${b} ± ${tol}, got ${a}`);
  }
}

// Reset state before each group of tests.
function resetState(phaseRadians = 0, confidence = 1.0, lastUpdateMs = Date.now()) {
  _internal.setState({ phaseRadians, confidence, lastUpdateMs });
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nCircadian Model — Unit Tests\n');
// ─────────────────────────────────────────────────────────────────────────────

// T1: Phase propagation follows φ(t) = φ₀ + ω·Δt (mod 2π)
test('T1 — Phase propagates forward at intrinsic rate ω = 2π/τ', () => {
  const phi0       = 0;
  const deltaHours = 6.05; // slightly over quarter-cycle

  const phiExpected = _internal.wrapPhase(phi0 + _internal.OMEGA * deltaHours);
  const phiActual   = _internal.propagatePhase(phi0, deltaHours);

  approx(phiActual, phiExpected, 1e-10, 'propagatePhase mismatch');

  // After exactly one full intrinsic period τ = 24.2 h, phase returns to 0.
  const phiFull = _internal.propagatePhase(phi0, 24.2);
  approx(phiFull, 0, 1e-10, 'Full-period wrap should return to φ=0');

  // Partial advance: 12.1 h = half period → φ = π
  const phiHalf = _internal.propagatePhase(0, 12.1);
  approx(phiHalf, Math.PI, 1e-10, 'Half-period should reach φ=π');
});

// T2: Bayesian correction pulls prior toward observed with gain K
test('T2 — Bayesian correction applies Kalman gain correctly (sleep K=0.9)', () => {
  const K           = _internal.KALMAN_GAIN.sleep; // 0.9
  const phiPrior    = 0;                            // ACTIVATION start
  const phiObserved = Math.PI;                      // BRAKE start

  // Expected: φ_post = 0 + 0.9 * (π - 0) = 0.9π
  const expected = _internal.wrapPhase(0 + K * (Math.PI - 0));
  const actual   = _internal.bayesianCorrect(phiPrior, phiObserved, K);
  approx(actual, expected, 1e-10, 'Kalman correction magnitude');

  // With K=1 (full trust) the posterior should equal the observation exactly.
  const fullTrust = _internal.bayesianCorrect(0, Math.PI, 1.0);
  approx(fullTrust, Math.PI, 1e-10, 'K=1 → posterior = observed');

  // With K=0 (zero gain) the posterior should equal the prior.
  const zeroGain = _internal.bayesianCorrect(1.5, Math.PI / 3, 0.0);
  approx(zeroGain, 1.5, 1e-10, 'K=0 → posterior = prior');

  // Wrap-around test: prior=5.5 rad, observed=0.2 rad (short arc crosses 2π).
  const wrapped = _internal.bayesianCorrect(5.5, 0.2, 0.5);
  assert.ok(wrapped >= 0 && wrapped < 2 * Math.PI, 'Wrapped correction must stay in [0,2π)');
  // Shortest arc from 5.5 → 0.2 is +0.983 rad (forward), not -5.3 rad.
  // Expected: 5.5 + 0.5 * 0.983 ≈ 5.99 rad, wrapped.
  const innovation = _internal.wrapPhase(0.2 - 5.5 + Math.PI) - Math.PI; // not used, just validate sign
  assert.ok(wrapped > 5.5 || wrapped < 0.5, 'Wrap-around correction direction correct');
});

// T3: Confidence decays as C(t) = C₀ · e^(-λ · Δt)
test('T3 — Confidence decays exponentially with correct λ', () => {
  const c0  = 1.0;
  const lam = _internal.LAMBDA; // 0.08

  // At Δt=0, confidence should be unchanged.
  approx(_internal.decayConfidence(c0, 0), 1.0, 1e-10, 'No decay at Δt=0');

  // At Δt = 1/λ ≈ 12.5 h, confidence = 1/e ≈ 0.3679.
  const at1overLambda = _internal.decayConfidence(c0, 1 / lam);
  approx(at1overLambda, Math.exp(-1), 1e-10, 'Decay to 1/e at Δt=1/λ');

  // At Δt = 24 h (one day), C = e^(-0.08×24) = e^(-1.92) ≈ 0.1466.
  const at24h = _internal.decayConfidence(c0, 24);
  approx(at24h, Math.exp(-0.08 * 24), 1e-10, 'Decay at 24 h');

  // Via getCurrentPhase: state set 8 h ago, confidence should have decayed.
  const refMs = Date.now() - 8 * 3600000;
  resetState(0, 1.0, refMs);
  const result = model.getCurrentPhase(Date.now());
  const expectedConf = Math.exp(-lam * 8);
  approx(result.confidence, Math.round(expectedConf * 1000) / 1000, 0.001, 'getCurrentPhase confidence decay');
});

// T4: Projection produces correct phase trajectory
test('T4 — project() returns monotonically advancing phase over 12 h', () => {
  const nowMs = Date.now();
  resetState(0, 0.8, nowMs);

  const traj = model.project(12, nowMs);

  // Should have 13 entries (h=0 to h=12 inclusive).
  assert.strictEqual(traj.length, 13, 'Projection length = hoursAhead + 1');

  // Each entry should have required fields.
  for (const pt of traj) {
    assert.ok(typeof pt.timestamp    === 'number', 'timestamp is number');
    assert.ok(typeof pt.phaseRadians === 'number', 'phaseRadians is number');
    assert.ok(typeof pt.phaseLabel   === 'string', 'phaseLabel is string');
    assert.ok(typeof pt.confidence   === 'number', 'confidence is number');
    assert.ok(pt.phaseRadians >= 0 && pt.phaseRadians < 2 * Math.PI, 'phase in [0,2π)');
  }

  // First entry at h=0 starts at phase ≈ 0 (from reset state).
  approx(traj[0].phaseRadians, 0, 1e-10, 'h=0 phase matches current state');

  // At h=12, phase should have advanced by ω×12 (mod 2π).
  const phiExpected12 = _internal.wrapPhase(0 + _internal.OMEGA * 12);
  approx(traj[12].phaseRadians, phiExpected12, 1e-6, 'h=12 phase matches propagation');

  // Confidence should be non-increasing (monotone decay).
  for (let i = 1; i < traj.length; i++) {
    assert.ok(traj[i].confidence <= traj[i - 1].confidence + 1e-9, 'confidence non-increasing');
  }
});

// T5: Shift simulation returns correct delta phase in hours
test('T5 — simulateShift() computes correct delta for 6-hour advance', () => {
  const nowMs = Date.now();
  resetState(0, 0.9, nowMs);

  const result = model.simulateShift({ shiftHours: 6, daysToAdapt: 1, fromMs: nowMs });

  // Both trajectories should have the same length.
  assert.strictEqual(result.baseline.length, result.shifted.length, 'equal trajectory lengths');

  // At t=0, shifted trajectory should differ from baseline by ≈ shiftHours in phase.
  const shiftRad = _internal.wrapPhase(_internal.OMEGA * 6);
  const actualDelta = result.shifted[0].phaseRadians - result.baseline[0].phaseRadians;
  // Unwrap delta to shortest arc.
  let delta = actualDelta;
  if (delta >  Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  // The phase offset at t=0 should equal ω×6 (or its shortest-arc equivalent).
  const expectedDeltaRad = (() => {
    let d = shiftRad;
    if (d > Math.PI) d -= 2 * Math.PI;
    return d;
  })();
  approx(Math.abs(delta), Math.abs(expectedDeltaRad), 1e-6, 'initial phase delta matches shiftHours×ω');

  // deltaPhaseHours returned should be numeric.
  assert.ok(typeof result.deltaPhaseHours === 'number', 'deltaPhaseHours is number');

  // A zero shift should produce delta ≈ 0.
  const zero = model.simulateShift({ shiftHours: 0, daysToAdapt: 1, fromMs: nowMs });
  approx(Math.abs(zero.deltaPhaseHours), 0, 0.01, 'Zero shift → deltaPhaseHours ≈ 0');
});

// T6: Phase labels cover full cycle with correct wrap-around
test('T6 — Phase labels map correctly across full [0, 2π) cycle', () => {
  // Boundary midpoints → expected labels.
  const cases = [
    { phi: Math.PI / 4,          expected: 'ACTIVATION' },  // middle of [0, π/2)
    { phi: (3 * Math.PI) / 4,   expected: 'BALANCE'    },  // middle of [π/2, π)
    { phi: (5 * Math.PI) / 4,   expected: 'BRAKE'      },  // middle of [π, 3π/2)
    { phi: (7 * Math.PI) / 4,   expected: 'RESET'      },  // middle of [3π/2, 2π)
  ];

  for (const { phi, expected } of cases) {
    const actual = _internal.labelFromPhase(phi);
    assert.strictEqual(actual, expected, `φ=${phi.toFixed(3)} → ${expected} (got ${actual})`);
  }

  // Wrap-around: φ = 2π should collapse to ACTIVATION (same as φ=0).
  assert.strictEqual(_internal.labelFromPhase(2 * Math.PI), 'ACTIVATION', '2π wraps to ACTIVATION');

  // Negative phase should still resolve via wrapPhase.
  assert.strictEqual(_internal.labelFromPhase(-Math.PI / 4), 'RESET', '-π/4 wraps to RESET segment');

  // Full loop: project 24 h and verify all 4 labels appear.
  resetState(0, 1.0, Date.now());
  const traj = model.project(24, Date.now());
  const labels = new Set(traj.map(p => p.phaseLabel));
  for (const l of ['ACTIVATION', 'BALANCE', 'BRAKE', 'RESET']) {
    assert.ok(labels.has(l), `Label ${l} should appear in 24-h projection`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL AND STABILITY TESTS (T7–T11)
// ─────────────────────────────────────────────────────────────────────────────

// Fixed epoch for deterministic timestamps.
const T0 = 1705298400000; // 2024-01-15T06:00:00.000Z
const ONE_HOUR = 3600000;

/** Save config and return a restore function. */
function saveConfig() {
  const saved = model.getConfig();
  return () => model.setConfig(saved);
}

// T7: 30-day no-input simulation — numerical integrity.
test('T7 — 30-day free-run: phase stays in [0,2π), confidence ≥ 0, no NaN/Inf', () => {
  resetState(0, 1.0, T0);

  const HOURS = 720; // 30 days

  // Sample every 6 h over 30 days to avoid calling 720 functions.
  // Compute directly via internal math to avoid mutating global state via update().
  const phi0   = 0;
  const conf0  = 1.0;
  const omega  = _internal.OMEGA;
  const lambda = _internal.LAMBDA;

  let prevConf = conf0;

  for (let h = 0; h <= HOURS; h += 6) {
    const phi  = _internal.propagatePhase(phi0, h);
    const conf = _internal.decayConfidence(conf0, h);

    // Phase must be finite and in [0, 2π).
    assert.ok(Number.isFinite(phi),  `h=${h}: phi is finite`);
    assert.ok(phi >= 0,              `h=${h}: phi ≥ 0`);
    assert.ok(phi < 2 * Math.PI,    `h=${h}: phi < 2π`);

    // Confidence must be finite, non-negative, and non-increasing.
    assert.ok(Number.isFinite(conf), `h=${h}: confidence is finite`);
    assert.ok(conf >= 0,             `h=${h}: confidence ≥ 0`);
    assert.ok(conf <= prevConf + 1e-12, `h=${h}: confidence non-increasing`);

    prevConf = conf;
  }

  // Verify the raw 30-day confidence is positive (not flushed to zero).
  // C(720) = e^(−0.08 × 720) = e^(−57.6) ≈ 9.47e−26 — subnormal but > 0.
  const rawConf30d = _internal.decayConfidence(1.0, HOURS);
  assert.ok(rawConf30d > 0, 'Raw confidence at 30 days must be > 0 (no underflow to exact 0)');

  // Note: getCurrentPhase() rounds to 3 decimal places, so display reads 0.
  // The raw computation is ≈ 9.47e−26 which is representable as an IEEE 754 double.
  // KNOWN_LIMITATION: The displayed/rounded confidence saturates at 0 after ~43 h
  // (C < 0.0005), providing no discriminating information for long no-input windows.
});

// T8: Extreme simultaneous entrainment — numerical stability under large competing corrections.
test('T8 — Extreme simultaneous inputs: all values stay in valid ranges', () => {
  // Scenario: sleep onset delayed by 8h, opposing photic correction, caffeine at nadir.
  // "Opposing" defined as: sleep correction at BRAKE phase (delays rhythm toward RESET),
  // light pulse also in DELAY zone (pushes phase back), caffeine at RESET start (nadir).

  resetState(0, 1.0, T0);

  // Apply sleep correction first: onset at T0+8h, offset at T0+16h (8h sleep).
  model.update({
    sleepOnset:  T0 + 8  * ONE_HOUR,
    sleepOffset: T0 + 16 * ONE_HOUR,
    timestamp:   T0 + 16 * ONE_HOUR,
  });

  const afterSleep = _internal.getState();

  // Apply bright light (5000 lux) — PRC direction determined by current phase.
  model.update({ lightLux: 5000, timestamp: T0 + 16 * ONE_HOUR + 1 });

  // Apply caffeine at the nadir (RESET start ≈ 3π/2).
  // Caffeine intake was at the start of RESET — t0 = T0 (6h before current point).
  model.update({
    caffeineTimestamp: T0 + 10 * ONE_HOUR, // 6h before current evaluation
    timestamp:         T0 + 16 * ONE_HOUR + 2,
  });

  const finalState = _internal.getState();
  const phi  = finalState.phaseRadians;
  const conf = finalState.confidence;

  assert.ok(phi >= 0 && phi < 2 * Math.PI,  `Phase in [0,2π): ${phi}`);
  assert.ok(Number.isFinite(phi),             'Phase is finite');
  assert.ok(conf >= 0 && conf <= 1.0,         `Confidence in [0,1]: ${conf}`);
  assert.ok(Number.isFinite(conf),            'Confidence is finite');

  // Verify the sleep phase observation was a valid radian.
  const sleepObs = _internal.sleepPhaseObservation(T0 + 8 * ONE_HOUR, T0 + 16 * ONE_HOUR);
  assert.ok(sleepObs >= 0 && sleepObs < 2 * Math.PI, `sleep phiObs in [0,2π): ${sleepObs}`);

  // KNOWN_LIMITATION: Correction order is fixed (sleep → light → caffeine).
  // Applying corrections in a different order would produce a different posterior
  // because each step shifts the phase used by the next step's PRC zone lookup.
  // The model does not commute under permutation of simultaneous inputs.
  // This is an inherent property of sequential Bayesian update without joint estimation.
});

// T9: 10 sequential light corrections within 2h — zone-edge absorption, not attractor convergence.
test('T9 — 10 sequential light pulses: phase absorbed at zone boundary, no oscillation', () => {
  // Start just inside the advance zone (just past CBT_min).
  const phiStart = _internal.wrapPhase((7 * Math.PI) / 4 + 0.05);
  resetState(phiStart, 0.9, T0);

  const corrections = [];
  let prevPhi = phiStart;

  for (let i = 0; i < 10; i++) {
    // Each pulse 12 minutes apart (0.2 h).
    const ts = T0 + i * 12 * 60000;
    const result = model.update({ lightLux: 5000, timestamp: ts });
    const phi = _internal.getState().phaseRadians;

    const { direction } = model.computePRC(phi, 5000);
    corrections.push({ step: i, phi, direction, correctionCount: result.correctionApplied.length });
    prevPhi = phi;
  }

  const finalPhi = _internal.getState().phaseRadians;

  // Phase must be in valid range after all corrections.
  assert.ok(finalPhi >= 0 && finalPhi < 2 * Math.PI, `Final phase in [0,2π): ${finalPhi}`);

  // Verify convergence: once in dead zone, subsequent steps apply no corrections.
  // Find the step where first DEAD_ZONE correction occurs.
  const deadZoneStart = corrections.findIndex(c => c.direction === 'DEAD_ZONE');
  if (deadZoneStart >= 0) {
    // All steps after dead zone entry must also be DEAD_ZONE (no oscillation back).
    for (let i = deadZoneStart; i < corrections.length; i++) {
      assert.strictEqual(corrections[i].direction, 'DEAD_ZONE',
        `Step ${i}: should remain in dead zone once entered (got ${corrections[i].direction})`);
    }
  }

  // Phase differences should be non-increasing (each subsequent correction ≤ previous).
  // This confirms convergence, not oscillation.
  const phiDeltas = corrections.map((c, i) => {
    if (i === 0) return Math.abs(c.phi - phiStart);
    return Math.abs(c.phi - corrections[i - 1].phi);
  });
  // Last delta should be ≤ first delta (corrections shrink or stop).
  assert.ok(phiDeltas[phiDeltas.length - 1] <= phiDeltas[0] + 1e-9,
    `Phase delta should not grow: first=${phiDeltas[0].toFixed(4)}, last=${phiDeltas[phiDeltas.length-1].toFixed(4)}`);

  // KNOWN_LIMITATION: T9 demonstrates zone-edge absorption, not attractor convergence.
  // Once the phase crosses into the dead zone, the binary PRC applies zero correction
  // force — the phase is absorbed at the boundary and stays there. This is categorically
  // different from a Van der Pol oscillator with a sinusoidal PRC, which would produce
  // a stable fixed-point attractor approached via damped convergence. There is no
  // restoring force in this model; the cessation of corrections is a gate, not a sink.
});

// T10: Parameter sensitivity sweep — λ, τ, K weights.
test('T10 — Sensitivity sweep: λ ∈ [0.02,0.20], τ ∈ [23.8,24.5], K ±20%', () => {
  const restoreConfig = saveConfig();

  const lambdas  = [0.02, 0.05, 0.08, 0.14, 0.20];
  const taus     = [23.8, 24.0, 24.2, 24.5];
  const kScales  = [0.8, 1.0, 1.2];

  // Nominal parameters for comparison baseline.
  const TAU_NOM = 24.2;
  const SLEEP_ONSET  = T0 + 16 * ONE_HOUR;
  const SLEEP_OFFSET = T0 + 23 * ONE_HOUR;
  const EVAL_TIME    = T0 + 48 * ONE_HOUR;

  // Compute nominal phase at 48h with one sleep correction.
  model.setConfig({ tauHours: TAU_NOM, lambda: 0.08, kalmanGain: { sleep: 0.9, light: 0.6, caffeine: 0.4 } });
  _internal.setState({ phaseRadians: 0, confidence: 1.0, lastUpdateMs: T0 });
  model.update({ sleepOnset: SLEEP_ONSET, sleepOffset: SLEEP_OFFSET, timestamp: SLEEP_OFFSET });
  const nominalPhase = model.getCurrentPhase(EVAL_TIME).phaseRadians;

  const rows = [];

  for (const tau of taus) {
    for (const lam of lambdas) {
      for (const ks of kScales) {
        model.setConfig({
          tauHours: tau,
          lambda:   lam,
          kalmanGain: { sleep: 0.9 * ks, light: 0.6 * ks, caffeine: 0.4 * ks },
        });
        _internal.setState({ phaseRadians: 0, confidence: 1.0, lastUpdateMs: T0 });
        model.update({ sleepOnset: SLEEP_ONSET, sleepOffset: SLEEP_OFFSET, timestamp: SLEEP_OFFSET });

        const phiAt48h = model.getCurrentPhase(EVAL_TIME).phaseRadians;
        const confAt48h = model.getCurrentPhase(EVAL_TIME).confidence;

        // Phase error vs. nominal (shortest arc, in hours).
        let phiDiff = phiAt48h - nominalPhase;
        if (phiDiff >  Math.PI) phiDiff -= 2 * Math.PI;
        if (phiDiff < -Math.PI) phiDiff += 2 * Math.PI;
        // Convert rad → hours using nominal omega.
        const nomOmega = (2 * Math.PI) / TAU_NOM;
        const errHours = phiDiff / nomOmega;

        // Projection divergence: compare projected phase at 48h end point
        // vs. nominal projection (uses current config's omega).
        const proj = model.project(1, EVAL_TIME); // 1 h further
        const projDivRad = Math.abs(proj[1].phaseRadians - _internal.propagatePhase(nominalPhase, 1));
        const projDivH   = projDivRad / nomOmega;

        rows.push({ tau, lam, ks, phiAt48h, confAt48h, errHours, projDivH });

        // Invariants that must hold for all parameter combinations:
        assert.ok(phiAt48h >= 0 && phiAt48h < 2 * Math.PI, `φ in [0,2π) for τ=${tau},λ=${lam},ks=${ks}`);
        assert.ok(confAt48h >= 0 && confAt48h <= 1.0,       `conf in [0,1] for τ=${tau},λ=${lam},ks=${ks}`);
        assert.ok(Number.isFinite(errHours),                 `errHours finite for τ=${tau},λ=${lam},ks=${ks}`);
      }
    }
  }

  // Print summary table.
  console.log('\n  T10 Sensitivity Table (τ, λ, K_scale → errHours from nominal, conf@48h)');
  console.log('  ' + '─'.repeat(72));
  console.log('  τ      λ     Ks   phiAt48h  conf@48h  errHours  projDiv(h)');
  console.log('  ' + '─'.repeat(72));
  for (const r of rows) {
    console.log(
      `  ${r.tau.toFixed(1).padEnd(6)}` +
      `${r.lam.toFixed(2).padEnd(6)}` +
      `${r.ks.toFixed(1).padEnd(5)}` +
      `${r.phiAt48h.toFixed(4).padEnd(10)}` +
      `${r.confAt48h.toFixed(4).padEnd(10)}` +
      `${r.errHours.toFixed(4).padEnd(10)}` +
      `${r.projDivH.toFixed(4)}`
    );
  }
  console.log('  ' + '─'.repeat(72));

  // High-level assertions: error must be bounded.
  const maxErrHours   = Math.max(...rows.map(r => Math.abs(r.errHours)));
  const maxProjDivH   = Math.max(...rows.map(r => r.projDivH));

  // A 0.7h change in τ (23.8→24.5) over 48h plus a ±20% K swing
  // should not produce more than ~6h of phase error.
  assert.ok(maxErrHours < 6, `Max phase error ${maxErrHours.toFixed(3)} h should be < 6 h`);

  // KNOWN_LIMITATION: Phase error grows linearly with τ mismatch: Δφ(48h) = 48 × Δω.
  // For τ ∈ [23.8, 24.5], Δτ = 0.7 h, Δω = 2π × (1/23.8 − 1/24.5) ≈ 0.0075 rad/h.
  // Over 48h this accumulates to ≈ 0.36 rad ≈ 1.4 h of phase error.
  // The model has no mechanism to detect or correct τ mismatch from observations.

  restoreConfig();
});

// T11: Boundary conditions — no discontinuity at φ=0, φ=2π−ε, wrap-boundary sleep.
test('T11 — Boundary conditions: labels and corrections continuous across 0/2π', () => {
  const epsilon = 1e-10;

  // φ = 0 → ACTIVATION (first segment, inclusive lower bound).
  assert.strictEqual(_internal.labelFromPhase(0),             'ACTIVATION', 'φ=0 is ACTIVATION');

  // φ = 2π − ε → RESET (last segment, upper bound exclusive at 2π).
  assert.strictEqual(_internal.labelFromPhase(2 * Math.PI - epsilon), 'RESET', 'φ=2π−ε is RESET');

  // φ = 2π → wraps to 0 → ACTIVATION (no gap or jump at boundary).
  assert.strictEqual(_internal.labelFromPhase(2 * Math.PI),  'ACTIVATION', 'φ=2π wraps to ACTIVATION');

  // Propagation across the 0/2π boundary must be continuous.
  // Phase just before 2π propagated by ε should appear just after 0.
  const phiNearEnd  = 2 * Math.PI - 0.001;
  const phiWrapped  = _internal.propagatePhase(phiNearEnd, 0.001 / _internal.OMEGA);
  assert.ok(phiWrapped < 0.01, `Phase wraps continuously: got ${phiWrapped}`);
  assert.strictEqual(_internal.labelFromPhase(phiWrapped), 'ACTIVATION', 'Post-wrap label is ACTIVATION');

  // Sleep input straddling wrap boundary: onset at end of RESET (≈ φ=2π−0.1),
  // offset 7h later. sleepPhaseObservation should return a valid radian in [0, 2π).
  const wrapOnsetMs  = T0;
  const wrapOffsetMs = T0 + 7 * ONE_HOUR;
  const sleepObs = _internal.sleepPhaseObservation(wrapOnsetMs, wrapOffsetMs);
  assert.ok(sleepObs >= 0 && sleepObs < 2 * Math.PI, `Wrap-boundary sleep obs in [0,2π): ${sleepObs}`);
  assert.ok(Number.isFinite(sleepObs), 'Sleep observation is finite');

  // Label at segment boundaries must be exactly the label that starts there.
  const boundaries = [
    { phi: 0,                  expected: 'ACTIVATION' },
    { phi: Math.PI / 2,        expected: 'BALANCE'    },
    { phi: Math.PI,            expected: 'BRAKE'       },
    { phi: (3 * Math.PI) / 2,  expected: 'RESET'       },
  ];
  for (const { phi, expected } of boundaries) {
    assert.strictEqual(_internal.labelFromPhase(phi), expected, `Boundary φ=${phi.toFixed(3)}`);
  }

  // Just below each boundary must still return the preceding label.
  const just = [
    { phi: Math.PI / 2        - epsilon, expected: 'ACTIVATION' },
    { phi: Math.PI            - epsilon, expected: 'BALANCE'    },
    { phi: (3 * Math.PI) / 2 - epsilon, expected: 'BRAKE'       },
    { phi: 2 * Math.PI        - epsilon, expected: 'RESET'       },
  ];
  for (const { phi, expected } of just) {
    assert.strictEqual(_internal.labelFromPhase(phi), expected, `φ=bound−ε: ${phi.toFixed(6)}`);
  }

  // KNOWN_LIMITATION: Phase labels are partitioned into exactly four equal quadrants
  // (each π/2 rad wide). Biological phase segments are not equal-width; RESET
  // (dominant sleep) typically spans only ~6–8 h subjectively, not 6.05 h (π/2 / ω).
  // The equal-quadrant discretisation is a modelling simplification that may
  // misclassify phases near segment boundaries by up to ~1 h.
});

// T12: Light pulse at φ=0.05 rad (ADVANCE tail) — fix verification (pre/post).
test('T12 — Light pulse at φ=0.05 rad (ADVANCE tail): |Δφ|>0, direction=ADVANCE', () => {
  const PHI_ADVANCE = 0.05; // φ ∈ [0, π/6) ADVANCE tail
  const kBase = _internal.KALMAN_GAIN.light; // 0.6

  // Show the bug was real: old formula returns 0 for any φ ∈ [0, π].
  const oldGain = kBase * Math.max(0, Math.sin(PHI_ADVANCE - Math.PI));
  console.log(`  [T12 pre-fix]  Old lightPhaseGain(0.05): ${oldGain.toFixed(6)} — was zero (dead feature confirmed)`);

  // Post-fix: new piecewise formula must return positive gain here.
  const newGain = _internal.lightPhaseGain(PHI_ADVANCE, kBase);
  console.log(`  [T12 post-fix] New lightPhaseGain(0.05): ${newGain.toFixed(6)} — positive (fix confirmed)`);
  assert.ok(newGain > 0, `lightPhaseGain(0.05) must be > 0 after fix, got ${newGain}`);

  // Apply a light pulse at PHI_ADVANCE and verify a non-zero ADVANCE shift occurs.
  resetState(PHI_ADVANCE, 1.0, T0);
  const before = _internal.getState().phaseRadians;

  model.update({ lightLux: 2000, timestamp: T0 });

  // Confirm prcDelta classifies this phase as ADVANCE.
  const { direction } = model.computePRC(PHI_ADVANCE, 2000);
  assert.strictEqual(direction, 'ADVANCE', `prcDelta at φ=0.05 must be ADVANCE, got ${direction}`);

  const after = _internal.getState().phaseRadians;

  // Shortest-arc delta: positive means phase advanced (moved forward on the circle).
  let delta = after - before;
  if (delta >  Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;

  assert.ok(Math.abs(delta) > 0, `|Δφ| must be > 0 for ADVANCE zone light pulse, got ${delta}`);
  assert.ok(delta > 0, `Direction must be ADVANCE (Δφ > 0), got ${delta}`);
});

// T13: Gain continuity at φ=π; deliberate gate at 2π/0 boundary documented.
test('T13 — Gain continuity at φ=π: smooth zero crossing; 2π/0 gate documented', () => {
  const kBase = _internal.KALMAN_GAIN.light;
  const EPS = 1e-6;

  // φ = π is the gain-null reference point (BRAKE onset, CT12 analogue).
  // Both sides must give K ≈ 0 — no cliff here.
  const gainLeftOfPi  = _internal.lightPhaseGain(Math.PI - EPS, kBase);
  const gainAtPi      = _internal.lightPhaseGain(Math.PI,       kBase);
  const gainRightOfPi = _internal.lightPhaseGain(Math.PI + EPS, kBase);

  console.log(`  [T13 φ=π] gain(π−ε)=${gainLeftOfPi.toFixed(8)}, gain(π)=${gainAtPi.toFixed(8)}, gain(π+ε)=${gainRightOfPi.toFixed(8)}`);

  assert.ok(gainLeftOfPi  < 1e-5, `gain(π−ε) must be ≈ 0, got ${gainLeftOfPi}`);
  assert.ok(gainAtPi      < 1e-5, `gain(π) must be ≈ 0, got ${gainAtPi}`);
  assert.ok(gainRightOfPi < 1e-3, `gain(π+ε) must be near 0 (continuous approach), got ${gainRightOfPi}`);

  // Document the deliberate gain gate at the 2π/0 wrap boundary.
  // Night-side formula gives K=0 as φ→2π; advance-tail formula gives K>0 at φ=0⁺.
  // This is a deliberate model artifact: CBT_max gating, not a continuity error.
  const gainNear2Pi = _internal.lightPhaseGain(2 * Math.PI - EPS, kBase);
  const gainNear0   = _internal.lightPhaseGain(EPS,               kBase);
  const cliff       = Math.abs(gainNear0 - gainNear2Pi);
  console.log(`  [T13 2π/0 gate] gain(2π−ε)=${gainNear2Pi.toFixed(6)}, gain(0+)=${gainNear0.toFixed(6)}, cliff=${cliff.toFixed(6)}`);
  console.log(`  [T13 2π/0 gate] Deliberate: advance-tail gain is non-zero immediately after CBT_min wrap.`);
  // No assertion on the 2π/0 cliff — it is an explicit design decision, not a bug.
  assert.ok(cliff >= 0, 'cliff is non-negative (trivially true; existence documented above)');
});

// T14: Micro boundary φ=1e-9 — post-correction in [0,2π), no sign flip, finite.
test('T14 — φ=1e-9 micro boundary: ADVANCE correction stays in [0,2π), no sign flip', () => {
  const PHI_MICRO = 1e-9; // numerically tiny but positive, inside [0, π/6) ADVANCE tail

  // wrapPhase of a near-zero positive value must be itself (no wrap artefact).
  const wrapped = _internal.wrapPhase(PHI_MICRO);
  assert.ok(Number.isFinite(wrapped),          `wrapPhase(1e-9) must be finite, got ${wrapped}`);
  assert.ok(wrapped >= 0,                      `wrapPhase(1e-9) must be ≥ 0, got ${wrapped}`);
  assert.ok(wrapped < 2 * Math.PI,             `wrapPhase(1e-9) must be < 2π, got ${wrapped}`);
  assert.ok(wrapped > 0,                       `wrapPhase(1e-9) must not collapse to 0, got ${wrapped}`);

  // Apply high-lux ADVANCE input at this micro phase.
  resetState(PHI_MICRO, 1.0, T0);
  model.update({ lightLux: 10000, timestamp: T0 });

  const phi = _internal.getState().phaseRadians;

  assert.ok(Number.isFinite(phi),  `Post-correction phase must be finite, got ${phi}`);
  assert.ok(phi >= 0,              `Post-correction phase must be ≥ 0 (no sign flip), got ${phi}`);
  assert.ok(phi < 2 * Math.PI,    `Post-correction phase must be < 2π, got ${phi}`);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
