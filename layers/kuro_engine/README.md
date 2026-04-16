# KURO::ENGINE — V2.5 MYTHOS-CONVERGENT Runtime

> Search-augmented, signal-sanitized, advantage-weighted reasoning on a frozen LLM.
> This directory is the JavaScript runtime side (Node CJS). The Python training
> pipeline that consumes its logs lives in `../../training/`.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  server.cjs   ──┐                                                │
│                 │  new Engine(deps, cfg)                         │
│  stream API  ───┼─────►  Engine.run(goal) ─► { bestX, bestV, …}  │
│                 │                                                │
│  deps = {                                                        │
│    ollama,     ──► LLM / controller + generator calls             │
│    embedder,   ──► nomic-embed-text for latent z_t               │
│    judge,      ──► voter_layer Actor-Judge → v_logic             │
│    synthesizer,──► synthesis_layer multiverse→critique→collapse  │
│    webSearch,  ──► layers/web_search.js                          │
│    logger                                                        │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

Every external system is **injected**. The engine never imports from
`../voter_layer.js` etc. directly — it takes callables. This keeps the loop
unit-testable without a running Ollama, and keeps the engine safely importable
from training-data scripts that only need the pure modules.

## File Map

| File                  | Spec § | Role |
|-----------------------|--------|------|
| `engine.cjs`          | §3     | Core loop: observe → controller → tools → V_{t+1} → E_t → z_{t+1} → replan → log |
| `state_machine.cjs`   | §2     | `SystemState` = (z_t, x_t, V_t, M_t, H_t) |
| `value_function.cjs`  | §4     | Multi-metric V + per-metric RunningStats |
| `advantage.cjs`       | §5     | 7-stage pipeline (Δ → short-horizon → BN → rescale → Pareto → cal-gate → weight) |
| `prompts.cjs`         | §7, §8 | `<STATE>` `<REASONING>` `<PLAN>` `<DELTA>` `<NEXT_STATE>` + token weights |
| `latent_state.cjs`    | §9     | z_{t+1} = α·z_t + (1−α)·Σ softmax(V)·φ(x), periodic reset |
| `compute_budget.cjs`  | §10    | b_t ∝ (1 − V_t); τ_adaptive = rolling p80 |
| `search.cjs`          | §11    | 30–50 node / depth 3–4 caps + weighted merging |
| `tools.cjs`           | §12    | 8 tool actions w/ central `dispatch` |
| `trajectory_log.cjs`  | §13    | JSONL → `$KURO_DATA/trajectories/YYYY-MM-DD.jsonl` |
| `safeguards.cjs`      | §17    | PLAN masking helper + A_t distribution HealthMonitor |
| `running_stats.cjs`   | —      | Welford online μ/σ with windowed recompute |

## Usage

### Minimal (no tools configured — controller will just terminate)

```js
const { Engine } = require('./layers/kuro_engine');
const deps = {
  ollama: { chat: async ({ messages, temperature }) => /* your call */ '' }
};
const engine = new Engine(deps);
const result = await engine.run('Write a clean implementation of binary search.');
console.log(result.bestX, result.bestV, result.alerts);
```

### Production wiring (composes existing KURO layers)

```js
const { Engine } = require('./layers/kuro_engine');
const voter       = require('./layers/voter_layer.js');
const synth       = require('./layers/synthesis_layer.js');
const webSearch   = require('./layers/web_search.js');
const { ask }     = require('./layers/ollama.js');
const { embed }   = require('./layers/embeddings.js');     // nomic-embed-text

const deps = {
  ollama: {
    chat: ({ messages, temperature }) => ask({
      model: 'qwen3.5:35b', messages, temperature
    })
  },
  embedder: embed,
  judge: async (prompt, output) => {
    const { score } = await voter.judge({ prompt, candidate: output });
    return score;  // 0..10
  },
  synthesizer: async (prompt, opts) => synth.synthesize({ prompt, ...opts }),
  webSearch
};

const engine = new Engine(deps, { maxSteps: 10, terminateV: 2.5 });
```

### Training-data collection

Every `engine.run()` appends JSONL to `$KURO_DATA/trajectories/`. The Python
sanitizer in `training/sanitize.py` consumes these directly — no extra export
step. See `training/README.md` for the pipeline.

## Configuration (common knobs)

| Option               | Default | Where           | Purpose |
|----------------------|---------|-----------------|---------|
| `maxSteps`           | 12      | `ENGINE_DEFAULTS` | Hard cap per `run()` |
| `terminateV`         | 2.5     | both            | Early-exit threshold |
| `replanMax`          | 2       | `ENGINE_DEFAULTS` | Retry on malformed controller output |
| `latentAlpha`        | 0.7     | LatentState     | z_t blending coefficient |
| `latentResetEvery`   | 32      | LatentState     | Drift reset period |
| `maxCandidatesPerStep` | 5     | ComputeBudget   | Per-step candidate ceiling |
| `deltaWindow`        | 512     | Engine          | Rolling ΔV history size |

## Safety Rails

`HealthMonitor` watches the distribution of advantages, calibration errors,
and raw deltas. It raises alerts for:

- `advantage_collapse` — A_t variance < 0.05 (signal dying)
- `advantage_runaway` — A_t variance > 0.8 (judge unstable)
- `calibration_degraded` — mean E_t > 0.25 (controller drifted)
- `delta_flatlined` — ΔV variance < 0.01 (trajectories plateaued)

Alerts are attached to every `run()` result and snapshotted in the trajectory
log. Typical response (orchestrator-decided): recompute stats, widen τ_A, or
kick in extra negatives. Nothing auto-restarts — the caller owns response.

## Testing

Pure modules (`advantage.cjs`, `value_function.cjs`, `latent_state.cjs`,
`running_stats.cjs`, `search.cjs`, `prompts.cjs`) are deterministic given
seed/state and have unit tests in `tests/`. The orchestrator is covered by
`scripts/kuro_engine_smoke.cjs` with a mock ollama.

## What this replaces

Nothing, currently. The engine is strictly additive — `server.cjs` continues
to ship responses as before. When the V2.5 wiring is ready:

1. The `/api/stream` handler instantiates an `Engine` with the above deps.
2. It calls `engine.run(goal)` and streams back the step events as SSE.
3. Trajectory logs accumulate; training picks them up on its own cadence.

The existing voter / synthesis / mnemosyne / thinking_stream layers continue
to exist and are *used by* the engine via dep injection — no duplication.
