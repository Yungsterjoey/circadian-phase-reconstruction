// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Adaptive Compute Budget (§10)
// ═══════════════════════════════════════════════════════════════════════════
//
// b_t ∝ (1 − V_t)
//   - low-quality states  → large budget (more candidates, deeper search)
//   - high-quality states → small budget, early termination
//
// Budget units are dimensionless [0, 1]. The search layer maps them to:
//   - number of candidates to generate     (§11: 30–50 ceiling)
//   - max search depth                     (§11: 3–4)
//   - replan threshold τ_adaptive          (from calibration errors E_t)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { RunningStats } = require('./running_stats.cjs');
const { clip } = require('./running_stats.cjs');

const DEFAULTS = {
  minCandidates: 1,
  maxCandidates: 5,     // per-step candidate ceiling (search.js enforces 30-50 over full trajectory)
  minDepth: 1,
  maxDepth: 4,
  tauPercentile: 0.80,  // τ_adaptive = 80th percentile of rolling E_t
  terminateV: 2.5       // if normalised V ≥ this, stop early
};

class ComputeBudget {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.errorStats = new RunningStats({ window: 128, tag: 'E_t' });
  }

  // Convert V_t (in [-3, 3] from ValueFunction) into a 0..1 quality proxy
  // and invert to get allocation fraction.
  allocationFor(V_t) {
    const q = clip((V_t + 3) / 6, 0, 1);   // -3 → 0, +3 → 1
    const frac = clip(1 - q, 0.05, 1.0);   // never 0 — always at least token effort
    return frac;
  }

  // Candidate count scaled by allocation fraction.
  candidatesFor(V_t) {
    const frac = this.allocationFor(V_t);
    const c = this.cfg.minCandidates +
      Math.round(frac * (this.cfg.maxCandidates - this.cfg.minCandidates));
    return clip(c, this.cfg.minCandidates, this.cfg.maxCandidates);
  }

  // Depth similarly — good states shorten the search.
  depthFor(V_t) {
    const frac = this.allocationFor(V_t);
    const d = this.cfg.minDepth +
      Math.round(frac * (this.cfg.maxDepth - this.cfg.minDepth));
    return clip(d, this.cfg.minDepth, this.cfg.maxDepth);
  }

  // Early termination check.
  shouldTerminate(V_t) {
    return V_t >= this.cfg.terminateV;
  }

  // τ_adaptive = rolling p80 of calibration errors.
  // This is the §3 step-7 replan trigger. Using a percentile rather than a
  // fixed number keeps it relevant as the controller gets better at predicting.
  observeError(E_t) {
    if (Number.isFinite(E_t)) this.errorStats.update(E_t);
  }

  tauAdaptive() {
    const ring = this.errorStats.ring;
    if (ring.length < 8) return 0.30; // fallback — matches tau_E default
    const sorted = ring.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1,
      Math.floor(this.cfg.tauPercentile * sorted.length));
    return sorted[idx];
  }

  shouldReplan(E_t) {
    return E_t > this.tauAdaptive();
  }

  snapshot() {
    return {
      cfg: this.cfg,
      tauAdaptive: this.tauAdaptive(),
      errorStats: this.errorStats.snapshot()
    };
  }
}

module.exports = { ComputeBudget, DEFAULTS };
