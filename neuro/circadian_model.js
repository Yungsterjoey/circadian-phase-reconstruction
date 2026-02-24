/**
 * circadian_model.js — Probabilistic Circadian Phase Reconstruction Engine
 * NEURO-KURO Tier 0 | KURO OS v9
 *
 * Models the endogenous circadian oscillator as a continuous phase on [0, 2π).
 * Phase propagation uses a first-order ODE approximation (van Gelder & Buijs, 2011).
 * Bayesian correction uses a gain-weighted correction on S¹ with phase-wrapped innovation (Brown et al., 2003).
 * Confidence decay uses an exponential forgetting curve (Borbély & Achermann, 1999).
 * Light entrainment uses a first-order PRC approximation (Kronauer et al., 1999;
 * Jewett & Kronauer, 1998).
 *
 * All math is deterministic. No randomness.
 */

'use strict';

// ─── Parameter configuration ──────────────────────────────────────────────────
//
// All tunable biological parameters are consolidated here.
// Call setConfig(overrides) to adjust without breaking the public API.
// Call getConfig() to read current parameters.

let _config = {
  // τ: intrinsic free-running period (hours).
  // Empirical mean: Czeisler et al., 1999, Science 284:2177.
  tauHours: 24.2,

  // λ: confidence decay rate (h⁻¹).
  // C(t) = C₀ · e^(−λ · Δt). λ = 0.08 → half-confidence at ≈ 8.7 h.
  lambda: 0.08,

  // Bayesian correction gain (reliability weight) per entrainment signal class.
  // Higher K → stronger gain-weighted pull toward the observed phase.
  kalmanGain: {
    sleep:    0.9,  // Sleep onset/offset — dominant zeitgeber
    light:    0.6,  // Photic input via ipRGC / melanopsin pathway
    caffeine: 0.4,  // Adenosine antagonism; weaker phase-shifting effect
  },

  // Minimum illuminance (lux) to register as a photic zeitgeber.
  lightThresholdLux: 50,

  // Caffeine pharmacological half-life (hours).
  caffeineHalfLifeHours: 5,

  // Maximum phase shift magnitude from a single light pulse, expressed as
  // equivalent circadian hours (converted to radians internally).
  // Based on empirical PRC amplitude: ~2 h (Khalsa et al., 2003, J Physiol).
  prcMaxShiftHours: 2,

  // PRC zone boundaries in radians (see prcDelta() for derivation).
  // CT16 ≈ 4.189 rad: start of the delay zone.
  prcDelayZoneStart: (4 * Math.PI) / 3,
  // CT21 ≈ 5.497 rad: core body temperature minimum (CBT_min).
  // Transition from delay → advance zone.
  prcCbtMinPhase: (7 * Math.PI) / 4,
  // CT1 ≈ 0.524 rad: end of the advance zone (dead zone resumes).
  prcAdvanceZoneEnd: Math.PI / 6,
};

/**
 * Return a shallow copy of the current configuration.
 * kalmanGain sub-object is also cloned.
 * @returns {object}
 */
function getConfig() {
  return { ..._config, kalmanGain: { ..._config.kalmanGain } };
}

/**
 * Merge parameter overrides into the current configuration.
 * Only known keys are accepted; unknown keys are silently ignored to prevent
 * configuration drift from typos.
 *
 * @param {Partial<typeof _config>} overrides
 */
function setConfig(overrides) {
  const known = Object.keys(_config);
  for (const key of known) {
    if (!(key in overrides)) continue;
    if (key === 'kalmanGain') {
      // Deep merge the gain sub-object.
      _config.kalmanGain = { ..._config.kalmanGain, ...overrides.kalmanGain };
    } else {
      _config[key] = overrides[key];
    }
  }
}

// ─── Derived constants (computed from config at call time) ─────────────────
//
// ω = 2π / τ. Not a top-level const so it reflects config changes.

/** Angular velocity of the free-running oscillator (rad h⁻¹). */
function getOmega() { return (2 * Math.PI) / _config.tauHours; }

// ─── Phase labels ──────────────────────────────────────────────────────────
//
// Full cycle [0, 2π) partitioned into four equal quadrants.
// Labels are mapped to subjective biological day segments:
//   ACTIVATION  [0,    π/2)   — rising cortisol, core temperature climbing
//   BALANCE     [π/2,  π)     — peak cognitive performance window
//   BRAKE       [π,    3π/2)  — melatonin onset, core temperature falling
//   RESET       [3π/2, 2π)    — deep sleep consolidation, SWS dominant

const PHASE_LABELS = [
  { label: 'ACTIVATION', min: 0,                  max: Math.PI / 2       },
  { label: 'BALANCE',    min: Math.PI / 2,         max: Math.PI           },
  { label: 'BRAKE',      min: Math.PI,             max: (3 * Math.PI) / 2 },
  { label: 'RESET',      min: (3 * Math.PI) / 2,  max: 2 * Math.PI       },
];

// ─── State ────────────────────────────────────────────────────────────────

let _state = {
  phaseRadians:       0,          // φ₀ — reference phase (radians)
  confidence:         0.5,        // C₀ — initial confidence [0, 1]
  lastUpdateMs:       Date.now(), // timestamp of last state write (ms since epoch)
  referenceEpochMs:   null,       // wall-clock anchor (ms) — set by anchor()
  referenceClockHour: null,       // civil clock hour tied to phaseRadians — set by anchor()
};

// ─── Core math helpers ────────────────────────────────────────────────────

/**
 * Wrap an angle to [0, 2π).
 * JavaScript's % operator preserves sign for negative values; this corrects that.
 * @param {number} phi — angle in radians (any range)
 * @returns {number}
 */
function wrapPhase(phi) {
  return ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Shortest signed arc from 0 to x on S¹, mapping x to (−π, π].
 * The JS % operator truncates toward zero, so one if-guard per side suffices
 * after reducing to (−2π, 2π).  Convention: +π is returned at the boundary.
 * @param {number} x — raw angle difference (radians, any range)
 * @returns {number}
 */
function shortestArc(x) {
  let r = x % (2 * Math.PI);
  if (r >  Math.PI) r -= 2 * Math.PI;
  if (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/**
 * Derive the phase label string from a radian value.
 * @param {number} phi — phase (any range; internally wrapped)
 * @returns {string}
 */
function labelFromPhase(phi) {
  const w = wrapPhase(phi);
  for (const seg of PHASE_LABELS) {
    if (w >= seg.min && w < seg.max) return seg.label;
  }
  return 'ACTIVATION'; // edge: 2π collapses to 0
}

/**
 * Propagate phase forward by Δt hours under free-running dynamics.
 *   φ(t) = φ₀ + ω · Δt   (mod 2π)
 * where ω = 2π/τ.
 *
 * @param {number} phi0       — phase at reference time (radians)
 * @param {number} deltaHours — elapsed time (hours, may be fractional)
 * @returns {number} — propagated phase in [0, 2π)
 */
function propagatePhase(phi0, deltaHours) {
  // First-order integration: without zeitgebers, phase advances at ω.
  return wrapPhase(phi0 + getOmega() * deltaHours);
}

/**
 * Apply a gain-weighted Bayesian correction on S¹ with phase-wrapped innovation.
 *   φ_posterior = φ_prior + K · (φ_observed − φ_prior)
 *
 * The innovation is the shortest arc on the circle S¹ to handle the 0/2π wrap.
 *
 * @param {number} phiPrior    — prior phase (radians)
 * @param {number} phiObserved — phase implied by entrainment input (radians)
 * @param {number} K           — correction gain ∈ [0, 1]
 * @returns {number} — posterior phase in [0, 2π)
 */
function bayesianCorrect(phiPrior, phiObserved, K) {
  // Shortest-arc innovation via shortestArc() — algebraically equiv. to the
  // if-chain form; both produce the same result for all finite IEEE 754 inputs.
  const innovation = shortestArc(phiObserved - phiPrior);

  return wrapPhase(phiPrior + K * innovation);
}

/**
 * Compute decayed confidence.
 *   C(t) = C₀ · e^(−λ · Δt)
 *
 * @param {number} c0         — confidence at last update [0, 1]
 * @param {number} deltaHours — hours elapsed since last update
 * @returns {number} — decayed confidence [0, 1]
 */
function decayConfidence(c0, deltaHours) {
  return c0 * Math.exp(-_config.lambda * deltaHours);
}

// ─── Phase Response Curve (PRC) ───────────────────────────────────────────
//
// The PRC describes how a photic stimulus shifts the circadian phase depending
// on *when* in the cycle the stimulus occurs (Kronauer et al., 1999; Khalsa
// et al., 2003).
//
// Human type-1 PRC for bright light (simplified first-order approximation):
//
//   Zone 1 — DELAY (φ ∈ [CT16, CT21)):
//     Light during early-to-mid biological night delays the rhythm.
//     The pacemaker phase angle decreases (oscillator runs later).
//
//   Zone 2 — ADVANCE (φ ∈ [CT21, CT24) ∪ [CT0, CT1)):
//     Light during late biological night / around CBT_min advances the rhythm.
//     The pacemaker phase angle increases (oscillator runs earlier).
//
//   Zone 3 — DEAD ZONE (all other phases):
//     Photic input has negligible effect on the pacemaker.
//
// CBT_min (core body temperature minimum) is the zero-crossing of the PRC
// and occurs near CT21 (≈ 5.497 rad) (Czeisler & Khalsa, 2000).
//
// Magnitude: scales with illuminance via a saturating exponential.
//   sat(E) = 1 − e^(−E / 2000)
// Maximum shift: prcMaxShiftHours (default 2 h), expressed in radians as
//   maxΔφ = prcMaxShiftHours × ω.

/**
 * Compute the signed phase correction from a light pulse at circadian phase φ.
 *
 * @param {number} phi — current circadian phase (radians)
 * @param {number} lux — illuminance (lux)
 * @returns {{ deltaRad: number, direction: 'ADVANCE'|'DELAY'|'DEAD_ZONE' }}
 */
function prcDelta(phi, lux) {
  if (lux < _config.lightThresholdLux) {
    return { deltaRad: 0, direction: 'DEAD_ZONE' };
  }

  // Lux saturation: response approaches max asymptotically above ~2000 lux.
  const sat = 1 - Math.exp(-lux / 2000);

  // Maximum phase shift in radians.
  const maxDeltaRad = _config.prcMaxShiftHours * getOmega();

  const w = wrapPhase(phi);
  const { prcDelayZoneStart, prcCbtMinPhase, prcAdvanceZoneEnd } = _config;

  // DELAY zone: [CT16, CT21) → phase pulled backward (Δφ negative).
  if (w >= prcDelayZoneStart && w < prcCbtMinPhase) {
    return { deltaRad: -maxDeltaRad * sat, direction: 'DELAY' };
  }

  // ADVANCE zone: [CT21, 2π) ∪ [0, CT1) → wraps through 0.
  // Check: w >= CT21 OR w < CT1.
  if (w >= prcCbtMinPhase || w < prcAdvanceZoneEnd) {
    return { deltaRad: +maxDeltaRad * sat, direction: 'ADVANCE' };
  }

  // Dead zone: all other phases.
  return { deltaRad: 0, direction: 'DEAD_ZONE' };
}

// ─── Phase-dependent correction gain for light K(φ) ──────────────────────
//
// The correction gain for photic entrainment is a phase-dependent function
// that approximates the sinusoidal shape of the human PRC
// (Czeisler et al., 1989; Khalsa et al., 2003).
//
// Biological basis:
//   The human PRC for bright light is approximately sinusoidal with:
//   — a zero-crossing at the core body temperature minimum (CBT_min, ≈ 7π/4)
//   — maximum delay sensitivity in the early subjective night
//   — maximum advance sensitivity in the late subjective night / early morning
//
// Piecewise form (Option B fix — biologically defensible):
//
//   ADVANCE tail [0, prcAdvanceZoneEnd):
//     K(φ) = K_base · sin(prcAdvanceZoneEnd − φ)
//     Gain declines from sin(π/6) ≈ 0.5 at φ=0 toward 0 at the dead-zone
//     boundary (φ = π/6). This is a pragmatic smoothing to avoid the dead
//     ADVANCE region — it is NOT biologically anchored to CBT_min.
//
//   Night phase (π, 2π):
//     K(φ) = K_base · max(0, sin(φ − π))
//     Smooth sinusoidal envelope over the delay [4π/3, 7π/4) and the main
//     advance [7π/4, 2π) zones. Peaks at φ = 3π/2 (RESET midpoint).
//
//   All other phases [prcAdvanceZoneEnd, π] → K(φ) = 0 (dead zone, daytime).
//
// Continuity properties:
//   φ = π  → both sides give K = 0  (smooth, no cliff — T13 verified)
//   φ = 0 / 2π → deliberate gain gate: night-side formula gives K=0 at 2π
//                 while advance-tail formula gives K>0 at 0⁺.
//                 This models the abrupt gating at CBT_max and is documented in T13.
//
// Bounded by construction: |sin(·)| ≤ 1, K_base ≤ 1 → K(φ) ∈ [0, 1].

/**
 * Compute the phase-dependent correction gain for photic entrainment.
 *
 * Piecewise: advance tail [0, prcAdvanceZoneEnd) uses sin(prcAdvanceZoneEnd − φ);
 * night phase (π, 2π) uses max(0, sin(φ − π)).
 *
 * @param {number} phi   — current circadian phase (radians)
 * @param {number} kBase — baseline light gain from config (kalmanGain.light)
 * @returns {number} — effective gain in [0, kBase]
 */
function lightPhaseGain(phi, kBase) {
  const w = wrapPhase(phi);
  const { prcAdvanceZoneEnd } = _config; // π/6

  // ADVANCE tail [0, prcAdvanceZoneEnd): wrap-around ADVANCE tail — pragmatic
  // smoothing to avoid dead ADVANCE region, not biologically anchored to CBT_min.
  // Gain declines from ~0.5·kBase at φ=0 to 0 at the dead-zone boundary (π/6).
  // KNOWN_LIMITATION: deliberate wrap-gate discontinuity at the 2π/0 boundary
  // (cliff ≈ 0.30) may produce different correction magnitudes for numerically
  // equivalent phases near 0 and 2π — documented in T13 and VALIDATION_SUMMARY.
  if (w < prcAdvanceZoneEnd) {
    return kBase * Math.sin(prcAdvanceZoneEnd - w);
  }

  // Night phase (π, 2π): smooth sinusoidal envelope over delay and advance zones.
  // sin(φ − π) > 0 for φ ∈ (π, 2π); clamped to 0 for daytime/dead-zone phases.
  return kBase * Math.max(0, Math.sin(w - Math.PI));
}

// ─── Entrainment observation helpers ─────────────────────────────────────

/**
 * Derive an observed phase from sleep onset/offset timestamps.
 * Sleep onset anchors to CT21 (7π/4 ≈ 5.497 rad) — CBT_min / circadian nadir.
 * Empirical basis: DLMO occurs at CT14; sleep onset follows DLMO by ~7 h,
 * placing it at CT21 (Czeisler & Khalsa, 2000; Khalsa et al., 2003).
 * Duration modulates the anchor within ±π/8 around CT21.
 *
 * @param {number} onsetMs  — sleep onset (ms since epoch)
 * @param {number} offsetMs — sleep offset / wake time (ms since epoch)
 * @returns {number} — observed phase (radians)
 */
function sleepPhaseObservation(onsetMs, offsetMs) {
  const sleepDurationHours = (offsetMs - onsetMs) / 3600000;
  // Normalise around 7 h mean; ±π/8 adjustment over the normal 4–10 h range.
  const durationDeviation = (sleepDurationHours - 7.0) / 7.0;
  return wrapPhase((7 * Math.PI) / 4 + durationDeviation * (Math.PI / 8));
}

/**
 * Derive an observed phase and effective Kalman gain from caffeine intake.
 * Caffeine nudges the alertness anchor toward BALANCE (≈ 3π/4).
 * Effectiveness decays with caffeine pharmacological half-life.
 *
 * @param {number} caffeineMs — time of intake (ms since epoch)
 * @param {number} nowMs      — current evaluation time (ms since epoch)
 * @returns {{ phiObserved: number, effectiveK: number }}
 */
function caffeinePhaseObservation(caffeineMs, nowMs) {
  const hoursElapsed   = (nowMs - caffeineMs) / 3600000;
  // Exponential decay with configured half-life.
  const effectiveness  = Math.exp(-Math.LN2 * hoursElapsed / _config.caffeineHalfLifeHours);
  const target         = (3 * Math.PI) / 4; // BALANCE midpoint
  return { phiObserved: target, effectiveK: _config.kalmanGain.caffeine * effectiveness };
}

// ─── Clock–phase coordinate mapping ──────────────────────────────────────
//
// anchor() establishes a bijection between civil clock time and circadian phase.
// After calling anchor(), clockToPhase() and phaseToClockHour() convert between
// the two coordinate systems using the current ω.
//
// Biological basis: DLMO (CT14) and CBT_min (CT21) are the two population-mean
// anchors most suitable for tying endogenous phase to clock time.  Callers
// should pass the clinically appropriate phase for their anchor event.

/**
 * Tie internal circadian phase to civil clock time.
 * Sets state.phaseRadians, state.referenceClockHour, state.referenceEpochMs,
 * and state.lastUpdateMs to timestampMs.  Confidence is not changed.
 *
 * @param {number} phaseRadians  — circadian phase to assign (radians)
 * @param {number} clockHour     — civil clock hour for that phase (0–23.9…)
 * @param {number} timestampMs   — wall-clock time of the anchor (ms since epoch)
 */
function anchor(phaseRadians, clockHour, timestampMs) {
  _state = {
    ..._state,
    phaseRadians:       wrapPhase(phaseRadians),
    referenceClockHour: clockHour,
    referenceEpochMs:   timestampMs,
    lastUpdateMs:       timestampMs,
  };
}

/**
 * Convert a civil clock hour to circadian phase, relative to the established anchor.
 * Requires anchor() to have been called.
 *
 * @param {number} clockHour — civil time (hours; may be negative or > 24)
 * @returns {number} — phase in [0, 2π)
 */
function clockToPhase(clockHour) {
  return wrapPhase(_state.phaseRadians + getOmega() * (clockHour - _state.referenceClockHour));
}

/**
 * Convert a circadian phase to the corresponding civil clock hour.
 * Requires anchor() to have been called.
 *
 * @param {number} phi — circadian phase (radians, any range)
 * @returns {number} — civil clock hour (may be outside [0, 24); caller normalises)
 */
function phaseToClockHour(phi) {
  const deltaPhi = shortestArc(wrapPhase(phi) - _state.phaseRadians);
  return _state.referenceClockHour + deltaPhi / getOmega();
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get the current circadian phase by propagating from the last known state.
 * Includes predicted phase-boundary crossing times for the next 24 h.
 *
 * @param {number} [timestamp=Date.now()] — evaluation time (ms since epoch)
 * @returns {{ phaseRadians, phaseLabel, confidence, predictedTransitions }}
 */
function getCurrentPhase(timestamp = Date.now()) {
  const deltaHours  = (timestamp - _state.lastUpdateMs) / 3600000;
  const phaseRadians = propagatePhase(_state.phaseRadians, deltaHours);
  const confidence   = decayConfidence(_state.confidence, deltaHours);

  return {
    phaseRadians,
    phaseLabel: labelFromPhase(phaseRadians),
    confidence: Math.round(confidence * 1000) / 1000,
    predictedTransitions: _computeTransitions(phaseRadians, timestamp, 24),
  };
}

/**
 * Feed new entrainment inputs and apply Bayesian correction to model state.
 * Light correction uses the Phase Response Curve (see prcDelta()).
 *
 * @param {{
 *   sleepOnset?:        number,   — ms since epoch
 *   sleepOffset?:       number,   — ms since epoch
 *   lightLux?:          number,   — lux
 *   caffeineTimestamp?: number,   — ms since epoch
 *   timestamp?:         number    — override for 'now' (ms since epoch)
 * }} inputs
 * @returns {{ phaseRadians, confidence, correctionApplied }}
 */
function update(inputs = {}) {
  const nowMs      = inputs.timestamp || Date.now();
  const deltaHours = (nowMs - _state.lastUpdateMs) / 3600000;

  // Step 1: propagate prior state to current time.
  let phi  = propagatePhase(_state.phaseRadians, deltaHours);
  let conf = decayConfidence(_state.confidence, deltaHours);
  const correctionApplied = [];

  // Step 2: sleep entrainment (highest reliability).
  if (inputs.sleepOnset != null && inputs.sleepOffset != null) {
    const phiObs = sleepPhaseObservation(inputs.sleepOnset, inputs.sleepOffset);
    const K      = _config.kalmanGain.sleep;
    phi  = bayesianCorrect(phi, phiObs, K);
    conf = Math.min(1.0, conf + K * (1 - conf));
    correctionApplied.push({ source: 'sleep', K, phiObserved: phiObs });
  }

  // Step 3: photic entrainment via PRC with phase-dependent gain K(φ).
  // Direction (advance / delay / dead zone) is determined by prcDelta().
  // Magnitude is scaled by lightPhaseGain(φ), which follows a sinusoidal
  // approximation of the human PRC amplitude (Czeisler et al., 1989).
  if (inputs.lightLux != null) {
    const { deltaRad, direction } = prcDelta(phi, inputs.lightLux);
    if (direction !== 'DEAD_ZONE') {
      // Phase-dependent gain: see lightPhaseGain(). Positive in ADVANCE tail [0,π/6)
      // and night phase (π,2π); zero in dead zone [π/6,π].
      const K = lightPhaseGain(phi, _config.kalmanGain.light);
      if (K > 0) {
        phi  = wrapPhase(phi + K * deltaRad);
        conf = Math.min(1.0, conf + K * (1 - conf));
      }
      // Always log the attempt so callers can inspect K(φ) value.
      correctionApplied.push({ source: 'light_prc', direction, K, deltaRad });
    }
  }

  // Step 4: caffeine phase cue.
  if (inputs.caffeineTimestamp != null) {
    const { phiObserved, effectiveK } = caffeinePhaseObservation(inputs.caffeineTimestamp, nowMs);
    phi  = bayesianCorrect(phi, phiObserved, effectiveK);
    conf = Math.min(1.0, conf + effectiveK * (1 - conf));
    correctionApplied.push({ source: 'caffeine', K: effectiveK, phiObserved });
  }

  _state = { phaseRadians: phi, confidence: conf, lastUpdateMs: nowMs };

  return {
    phaseRadians: phi,
    confidence:   Math.round(conf * 1000) / 1000,
    correctionApplied,
  };
}

/**
 * Project the circadian phase trajectory forward in time.
 * One sample per hour over the requested window.
 *
 * @param {number} hoursAhead     — projection horizon (hours)
 * @param {number} [fromMs=Date.now()] — projection origin (ms since epoch)
 * @returns {Array<{ timestamp, phaseRadians, phaseLabel, confidence }>}
 */
function project(hoursAhead, fromMs = Date.now()) {
  const nowDelta = (fromMs - _state.lastUpdateMs) / 3600000;
  const phiNow   = propagatePhase(_state.phaseRadians, nowDelta);
  const confNow  = decayConfidence(_state.confidence, nowDelta);

  const results = [];
  for (let h = 0; h <= hoursAhead; h++) {
    results.push({
      timestamp:    fromMs + h * 3600000,
      phaseRadians: propagatePhase(phiNow, h),
      phaseLabel:   labelFromPhase(propagatePhase(phiNow, h)),
      confidence:   Math.round(decayConfidence(confNow, h) * 1000) / 1000,
    });
  }
  return results;
}

/**
 * Simulate a circadian shift (jet-lag, shift work, etc.).
 * Compares the baseline free-running trajectory to a shifted trajectory and
 * returns the residual phase offset at the end of the adaptation window.
 *
 * @param {{
 *   shiftHours?:  number,   — schedule shift (+advance, −delay)
 *   daysToAdapt?: number,   — evaluation window (default: 7 days)
 *   fromMs?:      number    — simulation start (ms since epoch)
 * }} params
 * @returns {{ baseline, shifted, deltaPhaseHours }}
 */
function simulateShift(params = {}) {
  const { shiftHours = 0, daysToAdapt = 7, fromMs = Date.now() } = params;
  const horizon  = daysToAdapt * 24;

  // Baseline: unperturbed free-running.
  const baseline = project(horizon, fromMs);

  // Shifted: phase immediately offset by shiftHours × ω.
  const nowDelta     = (fromMs - _state.lastUpdateMs) / 3600000;
  const shiftRadians = wrapPhase(getOmega() * shiftHours);
  const phiShifted   = wrapPhase(propagatePhase(_state.phaseRadians, nowDelta) + shiftRadians);
  const confNow      = decayConfidence(_state.confidence, nowDelta);

  const shifted = [];
  for (let h = 0; h <= horizon; h++) {
    const phi  = propagatePhase(phiShifted, h);
    const conf = decayConfidence(confNow, h);
    shifted.push({
      timestamp:    fromMs + h * 3600000,
      phaseRadians: phi,
      phaseLabel:   labelFromPhase(phi),
      confidence:   Math.round(conf * 1000) / 1000,
    });
  }

  // Residual delta at end of window (shortest arc, converted to hours).
  let finalDeltaRad = baseline[baseline.length - 1].phaseRadians
                    - shifted[shifted.length - 1].phaseRadians;
  if (finalDeltaRad >  Math.PI) finalDeltaRad -= 2 * Math.PI;
  if (finalDeltaRad < -Math.PI) finalDeltaRad += 2 * Math.PI;

  return {
    baseline,
    shifted,
    deltaPhaseHours: Math.round((finalDeltaRad / getOmega()) * 100) / 100,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Compute the next phase-boundary crossings within a look-ahead window.
 * @param {number} phi      — current phase (radians)
 * @param {number} nowMs    — current time (ms since epoch)
 * @param {number} horizonH — look-ahead window (hours)
 * @returns {Array<{ timestamp, phaseLabel, phaseRadians }>}
 */
function _computeTransitions(phi, nowMs, horizonH) {
  const transitions = [];
  for (const seg of PHASE_LABELS) {
    let deltaRad = seg.min - phi;
    if (deltaRad < 0) deltaRad += 2 * Math.PI;
    const hoursToNext = deltaRad / getOmega();
    if (hoursToNext <= horizonH) {
      transitions.push({
        timestamp:    nowMs + hoursToNext * 3600000,
        phaseLabel:   seg.label,
        phaseRadians: seg.min,
      });
    }
  }
  transitions.sort((a, b) => a.timestamp - b.timestamp);
  return transitions;
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  // Public API (stable interface — do not break).
  getCurrentPhase,
  update,
  project,
  simulateShift,
  // Clock–phase coordinate mapping.
  anchor,
  clockToPhase,
  phaseToClockHour,
  // Configuration API.
  getConfig,
  setConfig,
  // Expose PRC for external analysis / validation.
  computePRC: prcDelta,
  // Internal access for unit tests and validation module only.
  _internal: {
    propagatePhase,
    bayesianCorrect,
    decayConfidence,
    wrapPhase,
    shortestArc,
    labelFromPhase,
    prcDelta,
    lightPhaseGain,
    sleepPhaseObservation,
    caffeinePhaseObservation,
    anchor,
    clockToPhase,
    phaseToClockHour,
    // Getters so tests remain accurate even after setConfig() calls.
    get OMEGA()        { return getOmega(); },
    get LAMBDA()       { return _config.lambda; },
    get KALMAN_GAIN()  { return { ..._config.kalmanGain }; },
    getState:  ()  => ({ ..._state }),
    setState:  (s) => { _state = { ..._state, ...s }; },
  },
};
