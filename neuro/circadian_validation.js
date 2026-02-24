/**
 * circadian_validation.js — Deterministic Validation Scenarios
 * NEURO-KURO Tier 0 | KURO OS v9
 *
 * Provides five canonical test scenarios for validating and academically
 * characterising the circadian_model.js Phase Reconstruction Engine.
 *
 * Each scenario:
 *   1. Saves the current model state.
 *   2. Resets the model to a known initial condition.
 *   3. Runs the scenario deterministically (no Date.now() calls).
 *   4. Collects the output envelope.
 *   5. Restores the original model state.
 *
 * All timestamps are pinned to a fixed epoch (T0) for reproducibility.
 * Output is deterministic across runs.
 *
 * Usage:
 *   const { runAllScenarios } = require('./circadian_validation');
 *   const results = runAllScenarios();
 */

'use strict';

const model     = require('./circadian_model.js');
const { _internal } = model;

// ─── Fixed epoch ─────────────────────────────────────────────────────────────
//
// All scenarios begin at T0. Using a pinned timestamp makes output reproducible
// regardless of when the module is loaded.
//
// T0 = 2024-01-15T06:00:00.000Z (arbitrary; chosen to be a Monday 06:00 UTC).
// Subjective interpretation: participant wakes at T0, φ₀ = 0 (ACTIVATION start).

const T0 = 1705298400000; // 2024-01-15T06:00:00.000Z
const ONE_HOUR = 3600000;

// ─── State isolation helpers ──────────────────────────────────────────────────

/** Save current model state and config, return a restore function. */
function saveAndReset(phaseRadians, confidence, lastUpdateMs) {
  const savedState  = _internal.getState();
  const savedConfig = model.getConfig();

  _internal.setState({ phaseRadians, confidence, lastUpdateMs });

  return function restore() {
    _internal.setState(savedState);
    model.setConfig(savedConfig);
  };
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Build a confidence trajectory: hourly samples over the given window.
 * Does not mutate model state (reads via getCurrentPhase with explicit timestamps).
 *
 * @param {number} originMs   — trajectory start (ms since epoch)
 * @param {number} horizonH   — number of hours to sample
 * @returns {Array<{ hour, phaseRadians, phaseLabel, confidence }>}
 */
function buildTrajectory(originMs, horizonH) {
  const traj = [];
  for (let h = 0; h <= horizonH; h++) {
    const ts = originMs + h * ONE_HOUR;
    const pt = model.getCurrentPhase(ts);
    traj.push({
      hour:         h,
      phaseRadians: pt.phaseRadians,
      phaseLabel:   pt.phaseLabel,
      confidence:   pt.confidence,
    });
  }
  return traj;
}

/**
 * Compute the net phase deviation between two phase values (shortest arc),
 * expressed in equivalent circadian hours.
 *
 * @param {number} phiPerturbed  — final phase under intervention (radians)
 * @param {number} phiBaseline   — final phase without intervention (radians)
 * @returns {number} — signed delta in hours (+advance, −delay)
 */
function phaseDeltaHours(phiPerturbed, phiBaseline) {
  const omega = _internal.OMEGA;
  let diff = phiPerturbed - phiBaseline;
  if (diff >  Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return diff / omega;
}

// ─── Scenario definitions ─────────────────────────────────────────────────────

/**
 * SCENARIO 1 — Baseline stable oscillation over 7 days (168 hours).
 *
 * Purpose: Verify that the free-running oscillator advances at exactly ω = 2π/τ
 * with no entrainment artefacts when no inputs are provided.
 *
 * Expected outcome:
 *   - Phase at t+168h = wrapPhase(0 + ω × 168)
 *   - No correction events in correctionApplied
 *   - Confidence decays monotonically: C(168) = e^(−0.08 × 168) ≈ 6.6 × 10⁻⁷
 *   - deltaHours ≈ 0 (no deviation from pure propagation)
 */
function scenario_baseline_oscillation() {
  const restore = saveAndReset(0, 1.0, T0);

  const baselinePhase = model.getCurrentPhase(T0).phaseRadians; // φ = 0

  // Sample hourly trajectory over 168 h without applying any inputs.
  const confidenceTrajectory = buildTrajectory(T0, 168);

  // Final phase: pure free-run propagation.
  const finalPhase = model.getCurrentPhase(T0 + 168 * ONE_HOUR).phaseRadians;

  // Expected: wrapPhase(0 + OMEGA * 168). Delta from baseline should be 0.
  const expectedFinalPhase = _internal.propagatePhase(0, 168);
  const dH = phaseDeltaHours(finalPhase, expectedFinalPhase);

  restore();

  return {
    scenarioName:          'baseline_stable_oscillation_7d',
    description:           'Free-running oscillator with no entrainment inputs over 7 days.',
    baselinePhase,
    finalPhase,
    deltaHours:            Math.round(dH * 1000) / 1000,
    confidenceTrajectory,  // 169 hourly samples
    notes: [
      `ω = ${_internal.OMEGA.toFixed(6)} rad h⁻¹ (τ = 24.2 h)`,
      `Periods elapsed: ${(168 / 24.2).toFixed(3)}`,
      `Expected final φ: ${expectedFinalPhase.toFixed(6)} rad`,
      `Confidence at t=168h: ${confidenceTrajectory[168].confidence}`,
    ],
  };
}

/**
 * SCENARIO 2 — 2-hour sleep delay shift (jet-lag simulation).
 *
 * Purpose: Confirm that feeding a delayed sleep onset anchor shifts the
 * reconstructed phase in the delay direction (negative deltaHours from baseline).
 *
 * Protocol:
 *   - Baseline: sleep onset at T0 + 16h (φ at CT16), offset at T0 + 23h.
 *   - Intervention: same schedule but sleep onset shifted +2h → T0 + 18h,
 *     offset T0 + 25h.
 *   - One-shot update; compare final phase after 24h against unperturbed baseline.
 *
 * Expected outcome:
 *   - finalPhase lags behind baselinePhase → deltaHours < 0.
 */
function scenario_sleep_delay_shift() {
  const omega = _internal.OMEGA;

  // ── Baseline run (no sleep shift) ──
  const restoreBase = saveAndReset(0, 1.0, T0);

  // Normal sleep: onset T0+16h, offset T0+23h.
  model.update({
    sleepOnset:  T0 + 16 * ONE_HOUR,
    sleepOffset: T0 + 23 * ONE_HOUR,
    timestamp:   T0 + 23 * ONE_HOUR,
  });
  const baselinePhase     = model.getCurrentPhase(T0 + 24 * ONE_HOUR).phaseRadians;
  const baselineConf      = model.getCurrentPhase(T0 + 24 * ONE_HOUR).confidence;
  restoreBase();

  // ── Perturbed run (sleep delayed by +2h) ──
  const restoreShift = saveAndReset(0, 1.0, T0);

  // Delayed sleep: onset T0+18h, offset T0+25h.
  model.update({
    sleepOnset:  T0 + 18 * ONE_HOUR,
    sleepOffset: T0 + 25 * ONE_HOUR,
    timestamp:   T0 + 25 * ONE_HOUR,
  });

  const finalState  = model.getCurrentPhase(T0 + 26 * ONE_HOUR);
  const finalPhase  = finalState.phaseRadians;
  const confidenceTrajectory = buildTrajectory(T0, 26);

  restoreShift();

  const dH = phaseDeltaHours(finalPhase, baselinePhase);

  return {
    scenarioName:          'sleep_delay_shift_2h',
    description:           'Sleep onset delayed by +2h relative to habitual schedule; 1-day evaluation window.',
    baselinePhase,
    finalPhase,
    deltaHours:            Math.round(dH * 1000) / 1000,
    confidenceTrajectory,
    notes: [
      'Positive deltaHours = phase advance; negative = phase delay.',
      `K_sleep = ${_internal.KALMAN_GAIN.sleep} (Bayesian gain for sleep anchor)`,
      `Baseline final confidence: ${baselineConf}`,
    ],
  };
}

/**
 * SCENARIO 3 — Early morning light pulse: phase advance via PRC.
 *
 * Purpose: Verify that bright light applied in the PRC advance zone
 * (φ ≥ φ_CBT_min, circadian late night) produces a positive phase advance.
 *
 * Protocol:
 *   - Initial state: φ = 7π/4 (CT21, CBT_min — start of advance zone).
 *   - Apply 5000 lux light pulse at T0.
 *   - Compare final phase at T0+1h against unperturbed baseline.
 *
 * Expected outcome:
 *   - PRC direction = ADVANCE.
 *   - finalPhase > baselinePhase (positive deltaHours).
 *   - deltaRad ≈ K_light × maxΔφ × sat(5000 lux).
 */
function scenario_light_pulse_advance() {
  const phiAdvance = _internal.wrapPhase((7 * Math.PI) / 4 + 0.01);
  // Start just inside the advance zone (past CBT_min).

  // ── Baseline: no light, advance zone entry ──
  const restoreBase = saveAndReset(phiAdvance, 0.9, T0);
  const baselinePhase = model.getCurrentPhase(T0 + ONE_HOUR).phaseRadians;
  restoreBase();

  // ── Perturbed: 5000 lux applied at T0 ──
  const restoreLight = saveAndReset(phiAdvance, 0.9, T0);

  const updateResult = model.update({ lightLux: 5000, timestamp: T0 });
  const finalPhase   = model.getCurrentPhase(T0 + ONE_HOUR).phaseRadians;
  const confidenceTrajectory = buildTrajectory(T0, 24);

  // Verify PRC direction for audit.
  const prc = model.computePRC(phiAdvance, 5000);

  restoreLight();

  const dH = phaseDeltaHours(finalPhase, baselinePhase);

  return {
    scenarioName:          'light_pulse_phase_advance',
    description:           'Bright light (5000 lux) applied at CBT_min entry (φ = 7π/4 + ε); expect phase advance.',
    baselinePhase,
    finalPhase,
    deltaHours:            Math.round(dH * 1000) / 1000,
    confidenceTrajectory,
    prcAudit: {
      inputPhaseRad:  phiAdvance,
      luxApplied:     5000,
      direction:      prc.direction,
      deltaRad:       Math.round(prc.deltaRad * 1e6) / 1e6,
    },
    correctionApplied: updateResult.correctionApplied,
    notes: [
      'PRC advance zone: φ ∈ [7π/4, 2π) ∪ [0, π/6) — light after CBT_min.',
      'Positive deltaHours confirms advance direction.',
    ],
  };
}

/**
 * SCENARIO 4 — Late-night caffeine: phase delay effect via PRC + caffeine cue.
 *
 * Purpose: Verify that caffeine administered in the biological evening
 * produces a measurable phase delay consistent with the caffeine phase
 * observation model (BALANCE-anchor pull).
 *
 * Protocol:
 *   - Initial state: φ = π (CT12, BRAKE start — late subjective afternoon).
 *   - Caffeine at T0.
 *   - Compare 1-day final phase against baseline.
 *
 * Expected outcome:
 *   - finalPhase ≠ baselinePhase (correction applied).
 *   - caffeinePhaseObservation pulls toward 3π/4 (BALANCE midpoint).
 *   - BRAKE-zone φ is past BALANCE → correction is a small delay (negative delta)
 *     or negligible depending on half-life at evaluation time.
 */
function scenario_late_caffeine_delay() {
  const phiBrake = Math.PI; // BRAKE start (CT12 equivalent)

  // ── Baseline ──
  const restoreBase = saveAndReset(phiBrake, 0.9, T0);
  const baselinePhase = model.getCurrentPhase(T0 + 24 * ONE_HOUR).phaseRadians;
  restoreBase();

  // ── Perturbed: caffeine at T0 ──
  const restoreCaff = saveAndReset(phiBrake, 0.9, T0);

  const updateResult = model.update({ caffeineTimestamp: T0, timestamp: T0 });
  const finalPhase   = model.getCurrentPhase(T0 + 24 * ONE_HOUR).phaseRadians;
  const confidenceTrajectory = buildTrajectory(T0, 24);

  restoreCaff();

  const dH = phaseDeltaHours(finalPhase, baselinePhase);

  return {
    scenarioName:          'late_caffeine_phase_delay',
    description:           'Caffeine administered at BRAKE phase (φ = π); evaluate 24h phase deviation.',
    baselinePhase,
    finalPhase,
    deltaHours:            Math.round(dH * 1000) / 1000,
    confidenceTrajectory,
    correctionApplied: updateResult.correctionApplied,
    notes: [
      'Caffeine anchor: 3π/4 (BALANCE midpoint). At BRAKE, pull is backward → delay.',
      `Effective K at intake: ${(updateResult.correctionApplied[0] || {}).K}`,
      'Half-life 5h: by t+24h effect has negligible residual on absolute phase.',
    ],
  };
}

/**
 * SCENARIO 5 — No-input confidence decay over 48 hours.
 *
 * Purpose: Verify that the exponential forgetting model correctly reduces
 * confidence without altering phase in the absence of entrainment inputs.
 *
 * Expected outcome:
 *   - Phase at t+48h = propagatePhase(φ₀, 48) — no correction.
 *   - Confidence at t+48h = C₀ · e^(−λ × 48) = 1.0 × e^(−3.84) ≈ 0.0214.
 *   - deltaHours = 0 (phase unchanged by absence of inputs).
 */
function scenario_confidence_decay_48h() {
  const restore = saveAndReset(0, 1.0, T0);

  const baselinePhase = model.getCurrentPhase(T0).phaseRadians; // φ = 0

  // Sample hourly — no update() calls.
  const confidenceTrajectory = buildTrajectory(T0, 48);

  const t48 = model.getCurrentPhase(T0 + 48 * ONE_HOUR);

  // Expected confidence from decay formula.
  const lambdaVal = _internal.LAMBDA;
  const expectedConf = Math.exp(-lambdaVal * 48);
  // Expected phase: pure propagation.
  const expectedPhase = _internal.propagatePhase(0, 48);

  restore();

  const dH = phaseDeltaHours(t48.phaseRadians, expectedPhase);

  return {
    scenarioName:          'no_input_confidence_decay_48h',
    description:           'No entrainment inputs for 48h; verify exponential confidence decay with no phase perturbation.',
    baselinePhase,
    finalPhase:            t48.phaseRadians,
    deltaHours:            Math.round(dH * 1000) / 1000,
    confidenceTrajectory,
    decayAudit: {
      lambda:              lambdaVal,
      expectedConfAt48h:   Math.round(expectedConf * 1e6) / 1e6,
      actualConfAt48h:     t48.confidence,
      relativeError:       Math.abs(t48.confidence - Math.round(expectedConf * 1000) / 1000),
    },
    notes: [
      `C(48) = e^(−${lambdaVal} × 48) = e^(−${lambdaVal * 48}) ≈ ${expectedConf.toFixed(6)}`,
      'Phase unchanged — confirms no spurious drift from decay mechanism.',
    ],
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Execute all five validation scenarios sequentially.
 * Model state is fully restored to its pre-call value after each scenario.
 *
 * @returns {object[]} — array of 5 scenario result objects
 */
function runAllScenarios() {
  return [
    scenario_baseline_oscillation(),
    scenario_sleep_delay_shift(),
    scenario_light_pulse_advance(),
    scenario_late_caffeine_delay(),
    scenario_confidence_decay_48h(),
  ];
}

// ─── CLI runner ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const results = runAllScenarios();

  for (const r of results) {
    const traj  = r.confidenceTrajectory;
    const first = traj[0];
    const last  = traj[traj.length - 1];

    console.log('\n' + '─'.repeat(60));
    console.log(`Scenario : ${r.scenarioName}`);
    console.log(`Desc     : ${r.description}`);
    console.log(`Baseline φ  : ${r.baselinePhase.toFixed(6)} rad  (${labelFor(r.baselinePhase)})`);
    console.log(`Final φ     : ${r.finalPhase.toFixed(6)} rad  (${labelFor(r.finalPhase)})`);
    console.log(`ΔHours      : ${r.deltaHours}`);
    console.log(`Conf h=0    : ${first.confidence}`);
    console.log(`Conf h=${(traj.length - 1).toString().padEnd(3)}: ${last.confidence}`);
    if (r.prcAudit) {
      console.log(`PRC dir     : ${r.prcAudit.direction}  (Δφ = ${r.prcAudit.deltaRad} rad)`);
    }
    if (r.decayAudit) {
      console.log(`Expected C  : ${r.decayAudit.expectedConfAt48h}`);
      console.log(`Actual C    : ${r.decayAudit.actualConfAt48h}`);
    }
    if (r.notes) {
      for (const n of r.notes) console.log(`  • ${n}`);
    }
  }
  console.log('\n' + '─'.repeat(60));
  console.log(`\n${results.length} scenarios complete.\n`);
}

function labelFor(phi) {
  const { labelFromPhase } = _internal;
  return labelFromPhase(phi);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  runAllScenarios,
  // Individual scenarios exported for selective testing.
  scenario_baseline_oscillation,
  scenario_sleep_delay_shift,
  scenario_light_pulse_advance,
  scenario_late_caffeine_delay,
  scenario_confidence_decay_48h,
};
