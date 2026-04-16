// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — System State S_t (§2)
// ═══════════════════════════════════════════════════════════════════════════
//
// S_t = (z_t, x_t, V_t, M_t, H_t)
//
//   z_t   latent belief embedding  (LatentState)
//   x_t   current best solution    (string)
//   V_t   multi-metric value score (number, clipped to [-3, 3])
//   M_t   constraints + memory     ({ constraints: [], memoryContext: [] })
//   H_t   trajectory history       ({ steps: [ { t, plan, V, ... } ] })
//
// This container is a thin dataclass. All mutation goes through explicit
// methods so the trajectory logger can tap the same edges deterministically.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

class SystemState {
  constructor({ goal = '', constraints = [] } = {}) {
    this.goal = goal;
    this.z = null;                       // LatentState.z (or null until first update)
    this.x = null;                       // current best solution string
    this.V = 0;                          // current value
    this.V_raw = null;                   // last raw metric object
    this.M = {
      constraints: constraints.slice(),
      memoryContext: []
    };
    this.H = {
      steps: [],
      bestV: -Infinity,
      bestX: null
    };
    this.t = 0;                          // step counter
    this.startedAt = Date.now();
  }

  // Called at the end of each engine step; appends to H_t.
  appendStep(step) {
    this.H.steps.push({ t: this.t, at: Date.now(), ...step });
    if (step.V > this.H.bestV) {
      this.H.bestV = step.V;
      this.H.bestX = step.x ?? this.x;
    }
    this.t += 1;
  }

  setSolution(x, V, V_raw) {
    this.x = x;
    this.V = V;
    this.V_raw = V_raw;
  }

  setLatent(z) { this.z = z; }

  setMemoryContext(memoryContext) {
    this.M.memoryContext = memoryContext || [];
  }

  summary() {
    return `t=${this.t} V=${this.V.toFixed(3)} bestV=${this.H.bestV.toFixed(3)} ` +
           `|x|=${this.x ? this.x.length : 0} constraints=${this.M.constraints.length}`;
  }

  toJSON() {
    return {
      goal: this.goal, t: this.t, startedAt: this.startedAt,
      V: this.V, V_raw: this.V_raw,
      x: this.x, bestV: this.H.bestV, bestX: this.H.bestX,
      constraints: this.M.constraints,
      memoryContext: this.M.memoryContext,
      steps: this.H.steps,
      hasZ: !!this.z, zDim: this.z ? this.z.length : 0
    };
  }
}

module.exports = { SystemState };
