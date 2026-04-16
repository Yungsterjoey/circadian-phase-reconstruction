// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Core Inference Loop (§3)
// ═══════════════════════════════════════════════════════════════════════════
//
// The conductor. Composes every module in this directory to implement:
//
//   1. Observe S_t
//   2. Controller predicts <STATE><REASONING><PLAN><DELTA><NEXT_STATE>
//   3. Execute PLAN via tools.dispatch
//   4. Evaluate V_{t+1} and ΔV_actual
//   5. Compute calibration error E_t = |ΔV_pred − ΔV_actual|
//   6. Update latent z_{t+1}
//   7. Replan if E_t > τ_adaptive
//   8. Append to H_t, commit memory, log trajectory
//
// This module is CJS and lives in the runtime (not training). All LLM/IO
// is accessed through an injected `deps` object so the whole loop runs under
// unit tests with mocks:
//
//   deps = {
//     ollama:     { chat({ messages, temperature }) => string }
//     embedder:   (text) => Promise<number[]>                      // optional
//     judge:      (prompt, output) => Promise<number>              // optional; 0..10
//     synthesizer:(prompt, { candidates, temperatures }) => {...}  // optional
//     webSearch:  (query, topK) => Promise<results[]>              // optional
//     logger:     (level, msg, meta) => void                       // optional
//   }
//
// The engine NEVER touches process.env, never imports from layers/ directly —
// every external system is injected. This keeps it independent of the Express
// server and safe to import from training/data-collection scripts.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { SystemState }        = require('./state_machine.cjs');
const { ValueFunction }      = require('./value_function.cjs');
const { LatentState }        = require('./latent_state.cjs');
const { ComputeBudget }      = require('./compute_budget.cjs');
const { SearchBudget,
        weightedTopK,
        weightedArgmaxSoft } = require('./search.cjs');
const { RunningStats }       = require('./running_stats.cjs');
const { stageA_delta }       = require('./advantage.cjs');
const { buildControllerPrompt,
        parseControllerOutput,
        TOKEN_WEIGHTS }      = require('./prompts.cjs');
const { TOOL_CATALOG,
        dispatch: dispatchTool } = require('./tools.cjs');
const { TrajectoryLogger }   = require('./trajectory_log.cjs');
const { HealthMonitor,
        maskedPlanForLogging } = require('./safeguards.cjs');

// ── Defaults ────────────────────────────────────────────────────────────────
const ENGINE_DEFAULTS = {
  maxSteps: 12,          // hard cap on loop iterations per goal
  replanMax: 2,          // how many times a single step may be re-planned
  terminateV: 2.5,       // early exit if V ≥ this (normalised)
  stepTimeoutMs: 60_000, // per-step wall clock ceiling
  embedOnCandidates: true,
  deltaWindow: 512,
  errorWindow: 128,
  log: true
};

function noopLogger(/* level, msg, meta */) {}

// ── Engine class ────────────────────────────────────────────────────────────
class Engine {
  constructor(deps = {}, cfg = {}) {
    this.deps = deps;
    this.cfg = { ...ENGINE_DEFAULTS, ...cfg };
    this.log = deps.logger || noopLogger;

    // Stateful components (lifetime = engine)
    this.valueFn = new ValueFunction({
      window: 1024,
      judgeFn: deps.judge || null
    });
    this.latent = new LatentState({
      alpha: cfg.latentAlpha ?? 0.7,
      resetEvery: cfg.latentResetEvery ?? 32
    });
    this.budget = new ComputeBudget({
      minCandidates: 1,
      maxCandidates: cfg.maxCandidatesPerStep ?? 5,
      maxDepth: cfg.maxDepth ?? 4,
      terminateV: this.cfg.terminateV
    });
    this.deltaStats = new RunningStats({
      window: this.cfg.deltaWindow,
      tag: 'dV_raw'
    });
    this.health = new HealthMonitor({ window: 256 });
  }

  // ── High-level run: loop until termination condition ──────────────────────
  async run(goal, opts = {}) {
    const sessionId = opts.sessionId || null;
    const userId = opts.userId || null;
    const constraints = opts.constraints || [];
    const traj = new TrajectoryLogger({ sessionId, userId, goal });

    const state = new SystemState({ goal, constraints });
    let terminalReason = null;

    for (let i = 0; i < this.cfg.maxSteps; i++) {
      const stepOut = await this._step(state, traj, { maxReplan: this.cfg.replanMax });

      if (stepOut.error) {
        terminalReason = `error:${stepOut.error}`;
        break;
      }

      if (stepOut.terminate) {
        terminalReason = stepOut.reason || 'controller_terminated';
        break;
      }

      if (this.budget.shouldTerminate(state.V)) {
        terminalReason = 'high_value_reached';
        break;
      }
    }
    if (!terminalReason) terminalReason = 'max_steps';

    // Finalise
    traj.logFinal({
      terminal_reason: terminalReason,
      bestV: state.H.bestV,
      bestX: state.H.bestX,
      totalSteps: state.t
    });

    // Assess health — caller sees it in the result
    const alerts = this.health.assess();

    return {
      ok: true,
      goal,
      sessionId: traj.sessionId,
      bestX: state.H.bestX,
      bestV: state.H.bestV,
      finalV: state.V,
      steps: state.t,
      terminalReason,
      alerts,
      state: state.toJSON(),
      snapshots: {
        value: this.valueFn.snapshot(),
        latent: this.latent.snapshot(),
        budget: this.budget.snapshot(),
        health: this.health.snapshot()
      }
    };
  }

  // ── Single step — spec §3 mapped 1:1 ──────────────────────────────────────
  async _step(state, traj, { maxReplan = 2 } = {}) {
    const stepStart = Date.now();
    // (1) Observe S_t — already in hand. Gather derived inputs.
    const stateSummary = state.summary();
    const memoryContext = this.latent.recall(3);
    const allocation = this.budget.allocationFor(state.V);
    state.setMemoryContext(memoryContext);

    // (2) Controller predicts five blocks.  Retry on malformed output.
    let parsed = null;
    let rawController = '';
    let attempts = 0;
    for (; attempts <= maxReplan; attempts++) {
      rawController = await this._controllerCall(state, {
        memoryContext,
        allocation
      });
      parsed = parseControllerOutput(rawController);
      const needReplan = !parsed.plan || parsed.missing.includes('PLAN');
      if (!needReplan) break;
      this.log('warn', 'controller output missing PLAN; replanning', {
        missing: parsed.missing, attempt: attempts
      });
    }

    if (!parsed || !parsed.plan) {
      this.log('error', 'controller failed to produce a plan after retries', {});
      return { error: 'no_plan', attempts };
    }

    // (3) Execute PLAN via tools
    const toolResults = [];
    for (const entry of parsed.plan) {
      if (!entry || !entry.tool) continue;
      const r = await dispatchTool(entry.tool, state, entry.args || {}, {
        ...this.deps,
        valueFunction: this.valueFn
      });
      toolResults.push({ tool: entry.tool, args: entry.args, result: r });
      if (entry.tool === 'terminate') {
        const reason = (r.result && r.result.reason) || 'controller_terminated';
        // Log the step before returning
        traj.logStep(this._assembleLogRecord(state, {
          rawController, parsed, toolResults, deltaActual: 0,
          E_t: 0, attempts, allocationFrac: allocation,
          terminal: true, terminalReason: reason
        }));
        state.appendStep({
          plan: parsed.plan, reasoning: parsed.reasoning,
          delta_pred: parsed.delta_pred, V: state.V,
          x: state.x, terminal: true
        });
        return { terminate: true, reason };
      }
    }

    // Pick the promoted candidate, if any. Rules (in order):
    //   a) explicit update_state with {candidate}
    //   b) evaluate_candidates output → weightedArgmaxSoft over V
    //   c) refine_solution output
    //   d) generate_candidates output → best V after scoring
    const promoted = await this._promoteCandidate(state, toolResults);

    // (4) Evaluate V_{t+1}
    let V_next = state.V;
    let V_next_raw = state.V_raw;
    let xNext = state.x;
    if (promoted && promoted.raw != null) {
      xNext = promoted.raw;
      const scored = await this.valueFn.score(xNext, {
        prompt: state.goal,
        constraints: state.M.constraints,
        format: 'auto',
        expectedLen: 400
      });
      V_next = scored.V;
      V_next_raw = scored.raw;
    }

    // ΔV_actual
    const deltaActual = V_next - state.V;

    // Stage A — squashed delta (used for latent trace + telemetry)
    const deltaNorm = stageA_delta(state.V, V_next, this.deltaStats);

    // (5) Calibration error E_t
    const E_t = Number.isFinite(parsed.delta_pred)
      ? Math.abs(parsed.delta_pred - deltaActual)
      : null;
    if (E_t != null) this.budget.observeError(E_t);

    // (6) Update latent z_{t+1}
    if (xNext != null) {
      const emb = this.cfg.embedOnCandidates ? await this._embed(xNext) : null;
      if (emb) {
        this.latent.step([{ embedding: emb, V: V_next, x: xNext }]);
      }
    }

    // Commit state
    if (promoted && xNext !== state.x) state.setSolution(xNext, V_next, V_next_raw);

    // (7) Replan trigger — inform caller (bookkept for future multi-attempt)
    const replanTriggered = E_t != null && this.budget.shouldReplan(E_t);

    // Feed health monitor
    this.health.observe({
      advantages: [deltaNorm],
      calErrors: E_t != null ? [E_t] : [],
      rawDeltas: [deltaActual]
    });

    // (8) Append to H_t + persistent log
    state.appendStep({
      plan: parsed.plan, reasoning: parsed.reasoning,
      delta_pred: parsed.delta_pred, delta_actual: deltaActual,
      calibration_error: E_t,
      V: V_next, V_prev: state.V - deltaActual, // (V before promotion)
      x: xNext,
      replanTriggered,
      wallMs: Date.now() - stepStart
    });

    traj.logStep(this._assembleLogRecord(state, {
      rawController, parsed, toolResults,
      deltaActual, E_t, attempts, allocationFrac: allocation,
      V_next, V_next_raw, xNext, deltaNorm, replanTriggered
    }));

    return { terminate: false, V: V_next, delta: deltaActual, E_t };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  async _controllerCall(state, { memoryContext, allocation }) {
    const prompt = buildControllerPrompt({
      goal: state.goal,
      stateSummary: state.summary(),
      history: state.H.steps.slice(-4),
      memoryContext,
      toolCatalog: TOOL_CATALOG,
      constraints: state.M.constraints.map(c =>
        typeof c === 'string' ? c : (c.describe || c.description || 'unnamed constraint')
      ),
      available_budget: allocation
    });

    if (!this.deps.ollama) {
      return '<STATE>no model</STATE><REASONING>no ollama</REASONING>' +
             '<PLAN>[{"tool":"terminate","args":{"reason":"no_model"}}]</PLAN>' +
             '<DELTA>0</DELTA><NEXT_STATE>{"confidence":0.6}</NEXT_STATE>';
    }
    return this.deps.ollama.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4
    });
  }

  async _embed(text) {
    if (!this.deps.embedder) return null;
    try { return await this.deps.embedder(text); }
    catch (e) {
      this.log('warn', 'embedder failed', { err: e.message });
      return null;
    }
  }

  async _promoteCandidate(state, toolResults) {
    // Rule A — explicit update_state wins
    for (const r of toolResults) {
      if (r.tool === 'update_state' && r.result.ok && r.result.result?.updated) {
        const { x, V } = r.result.result;
        return { raw: x, V };
      }
    }

    // Rule B — evaluate_candidates produced scored candidates
    for (const r of toolResults) {
      if (r.tool === 'evaluate_candidates' && r.result.ok) {
        const scored = r.result.result.scored || [];
        const pick = weightedArgmaxSoft(scored, 1.0);
        if (pick && pick.V > state.V) return { raw: pick.raw || pick.x, V: pick.V };
      }
    }

    // Rule C — refine_solution produced a single candidate
    for (const r of toolResults) {
      if (r.tool === 'refine_solution' && r.result.ok && r.result.result?.refined) {
        return { raw: r.result.result.refined };
      }
    }

    // Rule D — generate_candidates: score the best before promotion
    for (const r of toolResults) {
      if (r.tool === 'generate_candidates' && r.result.ok) {
        const cs = r.result.result.candidates || [];
        if (!cs.length) continue;
        const scored = [];
        for (const c of cs) {
          try {
            const sc = await this.valueFn.score(c.raw, {
              prompt: state.goal, constraints: state.M.constraints
            });
            scored.push({ ...c, V: sc.V });
          } catch { /* skip */ }
        }
        const tk = weightedTopK(scored, 1, 1.0);
        if (tk.length && tk[0].V > state.V) return { raw: tk[0].raw, V: tk[0].V };
      }
    }

    return null;
  }

  _assembleLogRecord(state, blob) {
    const {
      rawController, parsed, toolResults,
      deltaActual, E_t, attempts, allocationFrac,
      V_next, V_next_raw, xNext, deltaNorm,
      replanTriggered, terminal = false, terminalReason = null
    } = blob;

    // Mask PLAN tokens for logging parity with training-side 15% drop.
    const planMasked = parsed.plan
      ? maskedPlanForLogging(parsed.plan, { seed: state.t + 1 })
      : null;

    return {
      // — Block content (for token-weighted training) —
      raw_controller: rawController,
      blocks: {
        state: parsed.state, reasoning: parsed.reasoning,
        plan: parsed.plan, plan_masked: planMasked,
        delta_pred: parsed.delta_pred, next_state: parsed.next_state
      },
      token_weights: TOKEN_WEIGHTS,

      // — Execution —
      tool_results: toolResults.map(t => ({
        tool: t.tool,
        args: t.args,
        ok: t.result.ok,
        error: t.result.error || null,
        summary: summariseToolResult(t.result.result)
      })),

      // — State transitions —
      x_prev: state.H.steps.length ? state.H.steps[state.H.steps.length - 1].x ?? null : null,
      x: xNext ?? state.x,
      V_prev: state.V - (deltaActual || 0),
      V_next: V_next ?? state.V,
      V_next_raw,
      delta_actual: deltaActual,
      delta_pred: parsed.delta_pred,
      delta_norm: deltaNorm,
      calibration_error: E_t,
      confidence: parsed.confidence,

      // — Orchestration —
      controller_attempts: attempts,
      allocation_frac: allocationFrac,
      replan_triggered: !!replanTriggered,
      terminal,
      terminal_reason: terminalReason,

      // — Ambient snapshots —
      latent: this.latent.snapshot(),
      budget: this.budget.snapshot()
    };
  }
}

// Keep tool-result shapes bounded — full blobs can balloon trajectory files.
function summariseToolResult(r) {
  if (!r || typeof r !== 'object') return r;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string') out[k] = v.length > 400 ? v.slice(0, 400) + '…' : v;
    else if (Array.isArray(v)) out[k] = v.length > 8 ? `[${v.length} items]` : v.map(item =>
      typeof item === 'string' && item.length > 200 ? item.slice(0, 200) + '…' : item);
    else out[k] = v;
  }
  return out;
}

module.exports = { Engine, ENGINE_DEFAULTS };
