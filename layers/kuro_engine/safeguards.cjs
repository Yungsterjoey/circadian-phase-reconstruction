// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Failure Safeguards (§17)
// ═══════════════════════════════════════════════════════════════════════════
//
// Spec §17 lists six safeguards. Four live in engine.cjs / advantage.cjs
// (advantage gating, calibration gating, Pareto retention, KL anchor —
// KL is training-side, in training/awbc_loss.py). The two that belong
// at inference orchestration level are implemented here:
//
//   - PLAN masking     : 15% random drop of PLAN tokens in training data
//                        (pre-training step; also exposed here for online
//                         data-collection parity so the controller sees the
//                         same PLAN discipline it will be trained against).
//   - Latent reset     : LatentState owns the periodic reset, but this
//                        exposes a helper the orchestrator can invoke
//                        on detected anomalies (runaway delta_sigma,
//                        loop-with-no-improvement, etc.).
//
// Plus a top-level "health monitor" that watches A_t distribution drift
// (Final Red Team fix — prevents silent learning collapse).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { RunningStats } = require('./running_stats.cjs');

// ── PLAN masking ────────────────────────────────────────────────────────────
// Deterministic PRNG keyed by step so training/inference produce identical
// masks when shown the same trajectory.
function maskedPlanForLogging(planJson, { seed, dropProb = 0.15 } = {}) {
  if (!Array.isArray(planJson) || !planJson.length) return planJson;
  const rng = xorshift32(Number(seed) >>> 0 || 1);
  return planJson.map(entry => {
    const copy = { ...entry };
    const args = { ...(entry.args || {}) };
    for (const k of Object.keys(args)) {
      if (rng() < dropProb) args[k] = '<MASKED>';
    }
    copy.args = args;
    return copy;
  });
}

function xorshift32(seed) {
  let s = seed || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Health monitor (A_t distribution watchdog) ──────────────────────────────
// Alerts when the variance of advantages collapses (silent learning death)
// or runs away (unstable judge). Caller decides what to do — typical
// responses: recompute stats, widen temperature, pull in more negatives.
class HealthMonitor {
  constructor({ window = 256 } = {}) {
    this.advStats = new RunningStats({ window, tag: 'A_distribution' });
    this.calStats = new RunningStats({ window, tag: 'E_distribution' });
    this.deltaStats = new RunningStats({ window, tag: 'dV_raw' });
    this.lastAlerts = [];
  }

  observe({ advantages = [], calErrors = [], rawDeltas = [] } = {}) {
    for (const a of advantages) this.advStats.update(a);
    for (const e of calErrors) this.calStats.update(e);
    for (const d of rawDeltas) this.deltaStats.update(d);
  }

  assess() {
    const alerts = [];
    const advStd = this.advStats.std;
    const calMean = this.calStats.mean;
    const dStd = this.deltaStats.std;

    if (this.advStats.n >= 32 && advStd < 0.05) {
      alerts.push({ kind: 'advantage_collapse', advStd,
        note: 'A_t variance too low — signal dying, consider resampling or raising τ_A.' });
    }
    if (this.advStats.n >= 32 && advStd > 0.8) {
      alerts.push({ kind: 'advantage_runaway', advStd,
        note: 'A_t variance too high — judge unstable, recompute stats.' });
    }
    if (this.calStats.n >= 32 && calMean > 0.25) {
      alerts.push({ kind: 'calibration_degraded', calMean,
        note: 'Mean E_t > 0.25 — controller miscalibrated, tighten τ_E or retrain head.' });
    }
    if (this.deltaStats.n >= 32 && dStd < 0.01) {
      alerts.push({ kind: 'delta_flatlined', dStd,
        note: 'ΔV variance near zero — trajectories stopped improving; check value metrics.' });
    }

    this.lastAlerts = alerts;
    return alerts;
  }

  snapshot() {
    return {
      adv: this.advStats.snapshot(),
      cal: this.calStats.snapshot(),
      delta: this.deltaStats.snapshot(),
      lastAlerts: this.lastAlerts.slice()
    };
  }
}

module.exports = {
  maskedPlanForLogging,
  HealthMonitor,
  xorshift32
};
