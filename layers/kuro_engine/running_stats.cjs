// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Running Statistics (Welford's Algorithm)
// ═══════════════════════════════════════════════════════════════════════════
//
// Stable, numerically accurate running mean / variance / stddev.
// Used by value_function (per-metric μ_k, σ_k) and advantage.Stage C (μ_A, σ_A).
//
// Supports:
//   - per-step update (Welford, O(1) memory)
//   - batch update (vectorised)
//   - checkpoint → serialise → restore (for cross-process persistence)
//   - periodic recompute from rolling window (red-team fix: prevents stat drift)
//
// Spec refs: §4 Normalization, §5 Stage C, Final Red Team micro-fix #1.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const EPS = 1e-6;

class RunningStats {
  constructor({ window = 1000, tag = null } = {}) {
    this.n = 0;
    this.mean = 0;
    this.M2 = 0;   // sum of squared deviations (Welford)
    this.min = Infinity;
    this.max = -Infinity;
    this.window = Math.max(1, window | 0);
    this.ring = [];        // rolling buffer for periodic recompute
    this.tag = tag;        // optional label for telemetry
    this.lastRecomputeAt = Date.now();
  }

  // Single-sample Welford update
  update(x) {
    if (!Number.isFinite(x)) return;
    this.n += 1;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;

    // Rolling ring for periodic recompute
    this.ring.push(x);
    if (this.ring.length > this.window) this.ring.shift();
  }

  updateBatch(arr) {
    for (let i = 0; i < arr.length; i++) this.update(arr[i]);
  }

  get variance() {
    return this.n > 1 ? this.M2 / (this.n - 1) : 0;
  }

  get std() {
    return Math.sqrt(Math.max(this.variance, 0));
  }

  // Normalise x to z-score: (x - μ) / (σ + ε)
  normalize(x) {
    if (this.n < 2) return 0;
    return (x - this.mean) / (this.std + EPS);
  }

  // Red-team micro-fix #1: periodically recompute stats from rolling window
  // so we don't accumulate stale mean/var across distribution shifts.
  recomputeFromWindow() {
    if (this.ring.length < 2) return;
    const n = this.ring.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += this.ring[i];
    mean /= n;
    let M2 = 0;
    for (let i = 0; i < n; i++) {
      const d = this.ring[i] - mean;
      M2 += d * d;
    }
    this.n = n;
    this.mean = mean;
    this.M2 = M2;
    this.lastRecomputeAt = Date.now();
  }

  snapshot() {
    return {
      tag: this.tag, n: this.n, mean: this.mean, M2: this.M2,
      min: this.min, max: this.max, window: this.window,
      ring: this.ring.slice(), lastRecomputeAt: this.lastRecomputeAt
    };
  }

  static fromSnapshot(s) {
    const r = new RunningStats({ window: s.window, tag: s.tag });
    r.n = s.n; r.mean = s.mean; r.M2 = s.M2;
    r.min = s.min; r.max = s.max;
    r.ring = (s.ring || []).slice();
    r.lastRecomputeAt = s.lastRecomputeAt || Date.now();
    return r;
  }
}

// Clip helper used across the pipeline
function clip(x, lo, hi) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(Math.max(x, lo), hi);
}

module.exports = { RunningStats, clip, EPS };
