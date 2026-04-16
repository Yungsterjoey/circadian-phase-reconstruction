// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Search Constraints & Weighted Merging (§11)
// ═══════════════════════════════════════════════════════════════════════════
//
// Spec §11 caps:
//   - max total nodes evaluated per query: 30–50
//   - max depth: 3–4
//   - weighted candidate merging (no hard argmax only)
//
// This module enforces the caps and provides the merging primitives. The
// actual tree walk lives in engine.cjs.
//
// "Weighted candidate merging" means the top-k candidates contribute to the
// latent state z_t in proportion to their softmax(V), AND when collapsing a
// tie-level the caller may either (a) synthesise a merged solution or (b)
// carry multiple survivors forward. Hard argmax is explicitly forbidden by
// the spec — discards useful variance.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { softmax } = require('./latent_state.cjs');

const DEFAULTS = {
  maxNodes: 40,       // within §11 range
  maxDepth: 4,
  topKSurvivors: 3,   // candidates carried forward per level
  mergeTemp: 1.0      // softmax temperature for weighted merge
};

class SearchBudget {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.nodesEvaluated = 0;
    this.maxDepthSeen = 0;
  }
  canExpand(depth) {
    return this.nodesEvaluated < this.cfg.maxNodes && depth <= this.cfg.maxDepth;
  }
  record(depth, count = 1) {
    this.nodesEvaluated += count;
    if (depth > this.maxDepthSeen) this.maxDepthSeen = depth;
  }
  remaining() {
    return Math.max(0, this.cfg.maxNodes - this.nodesEvaluated);
  }
  snapshot() {
    return {
      cfg: this.cfg,
      nodesEvaluated: this.nodesEvaluated,
      maxDepthSeen: this.maxDepthSeen,
      remaining: this.remaining()
    };
  }
}

// ── Weighted picks ──────────────────────────────────────────────────────────
// Return the top-k candidates with normalised weights. Callers use these to
// either (a) carry forward survivors, or (b) blend embeddings into z_t.
function weightedTopK(candidates, k = 3, temp = 1.0) {
  if (!candidates.length) return [];
  const withV = candidates
    .filter(c => Number.isFinite(c.V))
    .sort((a, b) => b.V - a.V);
  const top = withV.slice(0, Math.min(k, withV.length));
  if (!top.length) return [];
  const scores = top.map(c => c.V / Math.max(temp, 1e-6));
  const weights = softmax(scores);
  return top.map((c, i) => ({ ...c, weight: weights[i] }));
}

// Given scored candidates, return the single "representative" index under
// weighted sampling semantics. Used when a tool requires committing to one.
function weightedPick(candidates, temp = 1.0) {
  if (!candidates.length) return null;
  const scored = candidates.filter(c => Number.isFinite(c.V));
  if (!scored.length) return null;
  const scores = scored.map(c => c.V / Math.max(temp, 1e-6));
  const weights = softmax(scores);
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < weights.length; i++) {
    cum += weights[i];
    if (r <= cum) return scored[i];
  }
  return scored[scored.length - 1];
}

// Deterministic weighted pick — breaks ties by position rather than rng
function weightedArgmaxSoft(candidates, temp = 1.0) {
  const tk = weightedTopK(candidates, 1, temp);
  return tk[0] || null;
}

module.exports = {
  SearchBudget,
  weightedTopK,
  weightedPick,
  weightedArgmaxSoft,
  DEFAULTS
};
