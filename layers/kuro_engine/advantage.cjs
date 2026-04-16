// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Advantage Pipeline (§5, Stages A → G)
// ═══════════════════════════════════════════════════════════════════════════
//
// Seven-stage signal sanitiser. Every trajectory step that survives becomes a
// training sample. Every stage has a specific failure mode it prevents.
//
//   A — Delta              raw improvement in V, tanh-squashed
//   B — Short-Horizon      A_t = ΔV_t + γΔV_{t+1}
//   C — Batch Normalisation z-score over batch
//   D — Dynamic Rescaling  A_t / (max|A| + ε)        (red-team: drift guard)
//   E — Pareto Retention   keep if |A|≥τ_A OR any metric improved
//   F — Calibration Gate   drop if |ΔV_pred − ΔV_actual| > τ_E
//   G — Final Weight       w = softplus(α(A − b)) · c*
//
// The pipeline is PURE — same inputs produce same outputs. All stateful parts
// (running μ_Δ, running μ_A) are injected by the caller so unit tests stay
// deterministic.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { RunningStats, clip, EPS } = require('./running_stats.cjs');

const DEFAULTS = {
  gamma: 0.5,
  alpha: 2.0,        // softplus sharpness in Stage G
  tau_A: 0.10,       // advantage retention threshold
  tau_E: 0.30,       // calibration error threshold
  clip_A: 1.0,
  metric_improve_eps: 0.05, // "significant" per-metric improvement for Pareto
  conf_lo: 0.6,
  conf_hi: 1.0
};

// ── Stage A — Delta ─────────────────────────────────────────────────────────
function stageA_delta(V_curr, V_next, deltaStats) {
  const raw = V_next - V_curr;
  deltaStats.update(raw);
  const sigma = Math.max(deltaStats.std, EPS);
  return Math.tanh(raw / (2 * sigma));
}

// ── Stage B — Short-Horizon Advantage ───────────────────────────────────────
// A_t = ΔV_t + γ · ΔV_{t+1}     (terminal step: next = 0)
function stageB_shortHorizon(deltas, gamma = DEFAULTS.gamma) {
  const A = new Array(deltas.length);
  for (let t = 0; t < deltas.length; t++) {
    const next = t + 1 < deltas.length ? deltas[t + 1] : 0;
    A[t] = deltas[t] + gamma * next;
  }
  return A;
}

// ── Stage C — Batch Normalisation ───────────────────────────────────────────
function stageC_batchNorm(A, cfg = {}) {
  const clipA = cfg.clip_A ?? DEFAULTS.clip_A;
  if (A.length === 0) return A.slice();
  let mean = 0;
  for (let i = 0; i < A.length; i++) mean += A[i];
  mean /= A.length;
  let varSum = 0;
  for (let i = 0; i < A.length; i++) {
    const d = A[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / Math.max(A.length - 1, 1));
  const normed = A.map(a => clip((a - mean) / (std + EPS), -clipA, clipA));
  return normed;
}

// ── Stage D — Dynamic Rescaling ─────────────────────────────────────────────
// Red-team fix #2: prevents advantage-signal shrinkage across epochs. By
// rescaling to max|A|=1, we keep gradient magnitude stable even if batch
// variance decays.
function stageD_dynamicRescale(A) {
  let maxAbs = 0;
  for (let i = 0; i < A.length; i++) {
    const v = Math.abs(A[i]);
    if (v > maxAbs) maxAbs = v;
  }
  const denom = maxAbs + EPS;
  return A.map(a => a / denom);
}

// ── Stage E — Pareto Retention ──────────────────────────────────────────────
// Keep the sample if it carries useful signal: either strong advantage OR a
// metric improved noticeably in its own right. This catches "quiet wins" —
// steps that don't shift the aggregate V but unblock a constraint.
function stageE_pareto(sample, A_t, cfg = {}) {
  const tauA = cfg.tau_A ?? DEFAULTS.tau_A;
  const eps = cfg.metric_improve_eps ?? DEFAULTS.metric_improve_eps;
  if (Math.abs(A_t) >= tauA) return true;

  const curr = sample.v_raw || {};
  const next = sample.v_next_raw || {};
  for (const k of Object.keys(curr)) {
    if ((next[k] ?? 0) - (curr[k] ?? 0) >= eps) return true;
  }
  return false;
}

// ── Stage F — Calibration Gate ──────────────────────────────────────────────
// Drops trajectories where the controller's ΔV prediction was miscalibrated.
// Noisy predictions poison the Huber auxiliary loss.
function stageF_calibrationGate(sample, cfg = {}) {
  const tauE = cfg.tau_E ?? DEFAULTS.tau_E;
  const dPred = sample.delta_pred;
  const dAct  = sample.delta_actual;
  if (!Number.isFinite(dPred) || !Number.isFinite(dAct)) return true; // fail-open
  return Math.abs(dPred - dAct) <= tauE;
}

// ── Stage G — Final Weight ──────────────────────────────────────────────────
// w_t = softplus(α(A_t − b)) · c*
// where b = mean(A_batch) and c* is the controller's detached, clamped confidence.
// Softplus keeps weights strictly positive — no negative gradient surprises in
// the CE objective.
function stageG_weight(A_batch, confidences, cfg = {}) {
  const alpha = cfg.alpha ?? DEFAULTS.alpha;
  const confLo = cfg.conf_lo ?? DEFAULTS.conf_lo;
  const confHi = cfg.conf_hi ?? DEFAULTS.conf_hi;
  const n = A_batch.length;
  if (n === 0) return [];

  let b = 0;
  for (let i = 0; i < n; i++) b += A_batch[i];
  b /= n;

  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = alpha * (A_batch[i] - b);
    // Numerically stable softplus: log(1+exp(x)) = max(x,0) + log(1+exp(-|x|))
    const softplus = Math.max(s, 0) + Math.log1p(Math.exp(-Math.abs(s)));
    const c = clip(confidences[i] ?? confLo, confLo, confHi);
    w[i] = softplus * c;
  }
  return w;
}

// ── Pipeline composition ────────────────────────────────────────────────────
// Input:  trajectory = ordered steps, each step = {
//           V, V_next, v_raw, v_next_raw, delta_pred, delta_actual, confidence
//         }
// Output: { samples, weights, kept, dropped, stats }
//
// The caller owns the RunningStats for ΔV so it persists across trajectories.
function runPipeline(trajectory, deltaStats, cfg = {}) {
  const C = { ...DEFAULTS, ...cfg };
  const n = trajectory.length;
  if (n === 0) return { samples: [], weights: [], kept: 0, dropped: 0, stats: {} };

  // A — Delta (stateful, consumes deltaStats)
  const deltas = new Array(n);
  for (let t = 0; t < n; t++) {
    deltas[t] = stageA_delta(trajectory[t].V, trajectory[t].V_next, deltaStats);
  }

  // B — Short-horizon
  let A = stageB_shortHorizon(deltas, C.gamma);

  // C — Batch normalise
  A = stageC_batchNorm(A, C);

  // D — Dynamic rescale
  A = stageD_dynamicRescale(A);

  // E + F — Retention filters
  const keptIdx = [];
  let droppedPareto = 0, droppedCal = 0;
  for (let t = 0; t < n; t++) {
    if (!stageE_pareto(trajectory[t], A[t], C)) { droppedPareto++; continue; }
    if (!stageF_calibrationGate(trajectory[t], C)) { droppedCal++; continue; }
    keptIdx.push(t);
  }

  const keptA = keptIdx.map(i => A[i]);
  const keptConf = keptIdx.map(i => trajectory[i].confidence);
  const keptSamples = keptIdx.map(i => ({
    ...trajectory[i], advantage: A[i], delta_norm: deltas[i]
  }));

  // G — Final weight over SURVIVING batch
  const weights = stageG_weight(keptA, keptConf, C);

  return {
    samples: keptSamples,
    weights,
    kept: keptIdx.length,
    dropped: { pareto: droppedPareto, calibration: droppedCal },
    stats: {
      A_mean: keptA.reduce((a, b) => a + b, 0) / Math.max(keptA.length, 1),
      A_abs_max: keptA.reduce((a, b) => Math.max(a, Math.abs(b)), 0),
      delta_sigma: deltaStats.std
    }
  };
}

module.exports = {
  DEFAULTS,
  RunningStats,
  stageA_delta,
  stageB_shortHorizon,
  stageC_batchNorm,
  stageD_dynamicRescale,
  stageE_pareto,
  stageF_calibrationGate,
  stageG_weight,
  runPipeline
};
