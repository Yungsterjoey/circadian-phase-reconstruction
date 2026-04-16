// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Value Function (§4)
// ═══════════════════════════════════════════════════════════════════════════
//
// V_t = mean(normalise([v_logic, v_syntax, v_efficiency, v_constraints]))
// V_t = clip(V_t, -3, 3)
//
// RED-TEAM NOTE: The spec's FINAL TRUTH states "performance is determined by
// quality of ΔV". Bad metrics → total collapse. This module therefore:
//   - bounds every metric BEFORE normalisation (prevents a single judge
//     outlier from poisoning μ/σ forever)
//   - uses RunningStats with windowed recompute
//   - exposes per-metric inspection for telemetry
//
// Dependencies
//   - layers/voter_layer.js   — judge model calls (v_logic)
//   - internal syntax/efficiency/constraint graders (pure JS, no LLM)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { RunningStats, clip } = require('./running_stats.cjs');

const METRIC_KEYS = ['v_logic', 'v_syntax', 'v_efficiency', 'v_constraints'];

// Per-metric input clip before normalisation. Keeps Welford stable.
const METRIC_RAW_BOUNDS = {
  v_logic:       [0, 10],
  v_syntax:      [0, 1],
  v_efficiency:  [0, 1],
  v_constraints: [0, 1]
};

// ── Syntax grader ───────────────────────────────────────────────────────────
// Cheap, deterministic: does output parse as declared format?
// For code tasks we try JSON parse + brace-balance; for prose we check minimal
// coherence (non-empty, no runaway repetition).
function gradeSyntax(output, { format = 'auto' } = {}) {
  if (!output || typeof output !== 'string') return 0;
  const s = output.trim();
  if (!s.length) return 0;

  // Cheap repetition penalty — a frozen LLM failure mode
  const tokens = s.slice(0, 4000).split(/\s+/);
  const uniq = new Set(tokens).size / Math.max(tokens.length, 1);
  if (uniq < 0.25) return 0.2;

  if (format === 'json' || (format === 'auto' && /^[\s]*[{[]/.test(s))) {
    try { JSON.parse(s); return 1.0; } catch { return 0.3; }
  }

  // Brace / bracket / paren balance
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const stack = [];
  for (const c of s) {
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ']' || c === ')') {
      if (stack.pop() !== c) return 0.4;
    }
  }
  return stack.length === 0 ? 0.9 : 0.5;
}

// ── Efficiency grader ───────────────────────────────────────────────────────
// Inverse token cost: short, complete answers rank higher than verbose ones.
// Normalised against an expected-length heuristic derived from task type.
function gradeEfficiency(output, { expectedLen = 400 } = {}) {
  if (!output) return 0;
  const len = output.length;
  if (len === 0) return 0;
  if (len <= expectedLen) return 1.0;
  // Gentle decay beyond expected length; 5× expected → ~0.3
  const ratio = expectedLen / len;
  return clip(0.3 + 0.7 * ratio, 0, 1);
}

// ── Constraint grader ───────────────────────────────────────────────────────
// Returns fraction of constraints satisfied. Constraints are declared by the
// caller (M_t) as an array of {check: (output) => boolean, weight?: number}.
function gradeConstraints(output, constraints = []) {
  if (!constraints.length) return 1.0;
  let total = 0, satisfied = 0;
  for (const c of constraints) {
    const w = c.weight || 1;
    total += w;
    try { if (c.check(output)) satisfied += w; } catch { /* fail open */ }
  }
  return total > 0 ? satisfied / total : 1.0;
}

// ── Per-metric running statistics ───────────────────────────────────────────
class ValueFunction {
  constructor({ window = 1000, judgeFn = null } = {}) {
    this.stats = Object.fromEntries(
      METRIC_KEYS.map(k => [k, new RunningStats({ window, tag: k })])
    );
    this.judgeFn = judgeFn; // async (prompt, output) => logicScore 0..10
    this.clipBound = 3;
    this.clipHistory = [];  // for telemetry — tracks how often we saturate
  }

  // Score raw metrics. logicScore is optional; if absent, judgeFn is invoked.
  async scoreRaw(output, ctx = {}) {
    const { logicScore = null, prompt = '', constraints = [],
            format = 'auto', expectedLen = 400 } = ctx;

    let vLogic = logicScore;
    if (vLogic == null && this.judgeFn) {
      try { vLogic = await this.judgeFn(prompt, output); }
      catch { vLogic = null; }
    }
    if (vLogic == null) vLogic = 5.0; // neutral if no judge available

    const raw = {
      v_logic:       vLogic,
      v_syntax:      gradeSyntax(output, { format }),
      v_efficiency:  gradeEfficiency(output, { expectedLen }),
      v_constraints: gradeConstraints(output, constraints)
    };

    // Clip raw to bounds — prevents outliers from poisoning stats
    for (const k of METRIC_KEYS) {
      const [lo, hi] = METRIC_RAW_BOUNDS[k];
      raw[k] = clip(raw[k], lo, hi);
    }
    return raw;
  }

  // Update running stats and compute V_t = mean(normalised)
  evaluate(raw) {
    const normalised = {};
    for (const k of METRIC_KEYS) {
      this.stats[k].update(raw[k]);
      normalised[k] = this.stats[k].normalize(raw[k]);
    }
    let V = 0;
    for (const k of METRIC_KEYS) V += normalised[k];
    V = V / METRIC_KEYS.length;

    const clipped = clip(V, -this.clipBound, this.clipBound);
    if (clipped !== V) this.clipHistory.push({ t: Date.now(), V, clipped });
    return { V: clipped, raw, normalised };
  }

  async score(output, ctx = {}) {
    const raw = await this.scoreRaw(output, ctx);
    return this.evaluate(raw);
  }

  // Periodic stat recompute (Final Red Team micro-fix #1).
  // Call every epoch / every N trajectories to drop stale mean/var.
  recomputeStats() {
    for (const k of METRIC_KEYS) this.stats[k].recomputeFromWindow();
  }

  snapshot() {
    return {
      clipBound: this.clipBound,
      stats: Object.fromEntries(
        METRIC_KEYS.map(k => [k, this.stats[k].snapshot()])
      ),
      clipHistory: this.clipHistory.slice(-100)
    };
  }
}

module.exports = {
  ValueFunction,
  METRIC_KEYS,
  gradeSyntax,
  gradeEfficiency,
  gradeConstraints
};
