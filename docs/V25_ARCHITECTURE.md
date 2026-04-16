# KURO V2.5 — MYTHOS-CONVERGENT Architecture

> **Status:** Additive. `server.cjs`, existing layers (voter, synthesis,
> mnemosyne, thinking_stream, context_reactor, web_search), and the frozen
> LLM (Qwen3.5 35B) are unchanged. The V2.5 machinery lives in two new
> self-contained subsystems.

## Two Subsystems

```
┌──────────────────────────────────────────────────────────┐
│  layers/kuro_engine/          runtime JS (CJS)           │
│   ├── engine.cjs              §3 core inference loop     │
│   ├── state_machine.cjs       §2 S_t = (z,x,V,M,H)       │
│   ├── value_function.cjs      §4 multi-metric V          │
│   ├── advantage.cjs           §5 seven-stage pipeline    │
│   ├── prompts.cjs             §7,§8 block format + weights│
│   ├── latent_state.cjs        §9 z_{t+1}                 │
│   ├── compute_budget.cjs      §10 adaptive b_t            │
│   ├── search.cjs              §11 node/depth caps         │
│   ├── tools.cjs               §12 eight tool actions      │
│   ├── trajectory_log.cjs      §13 JSONL emitter           │
│   ├── safeguards.cjs          §17 health monitor          │
│   ├── running_stats.cjs       Welford foundation          │
│   └── tests/unit.cjs          33 passing assertions       │
│                                                          │
│  training/                    offline Python pipeline    │
│   ├── requirements.txt                                   │
│   ├── configs/awbc.yaml                                  │
│   ├── configs/accelerate.yaml                            │
│   ├── configs/ds_config_35b.json                         │
│   ├── sanitize.py             §13 seven-stage cleanup    │
│   ├── balance.py              §14 batch balancing         │
│   ├── token_weights.py        §8 token-level weights     │
│   ├── awbc_loss.py            §6 composite loss           │
│   ├── train.py                QLoRA 4-bit trainer        │
│   ├── evaluate.py             §16 five-axis harness       │
│   ├── promote.py              §15 +5% uplift gate         │
│   └── monitor.py              offline health watchdog    │
└──────────────────────────────────────────────────────────┘
```

## Wire Diagram

```
          ┌───────────── inference ─────────────┐       ┌──────── training ───────────┐
          │                                     │       │                              │
 user ───►│  server.cjs  /api/stream            │       │                              │
          │       │                              │       │                              │
          │       │  (future wiring)             │       │                              │
          │       ▼                              │       │                              │
          │  Engine.run(goal)                    │       │                              │
          │       │                              │       │                              │
          │       ├─► controller: ollama.chat    │       │                              │
          │       ├─► judge:       voter_layer   │       │                              │
          │       ├─► embedder:    nomic         │       │                              │
          │       ├─► synthesiser: synthesis_layer│      │                              │
          │       ├─► web_search:  web_search    │       │                              │
          │       │                              │       │                              │
          │       ▼                              │       │                              │
          │   trajectory_log ─► $KURO_DATA/trajectories/YYYY-MM-DD.jsonl                │
          │                                                      │                     │
          └──────────────────────────────────────────────────────┼─────────────────────┘
                                                                 ▼
                                                sanitize.py → balance.py → train.py
                                                                                 │
                                                                                 ▼
                                                        evaluate.py → promote.py
                                                                                 │
                                                                                 ▼
                                                $KURO_DATA/promoted/CURRENT ─► adapter load
```

## Spec Coverage

| Spec § | What it says                             | Where it lives                                                  |
|--------|------------------------------------------|------------------------------------------------------------------|
| §2     | S_t = (z, x, V, M, H)                    | `layers/kuro_engine/state_machine.cjs`                           |
| §3     | Core inference loop                      | `layers/kuro_engine/engine.cjs`                                  |
| §4     | Multi-metric V                           | `layers/kuro_engine/value_function.cjs`                          |
| §5     | Advantage pipeline, 7 stages             | `layers/kuro_engine/advantage.cjs` + `training/sanitize.py`      |
| §6     | L = CE·w + λ₁·Huber + β·KL               | `training/awbc_loss.py`                                          |
| §7     | STATE/REASONING/PLAN/DELTA/NEXT_STATE    | `layers/kuro_engine/prompts.cjs`                                 |
| §8     | Token-weight table + 15% PLAN mask       | `layers/kuro_engine/prompts.cjs` + `training/token_weights.py`   |
| §9     | Latent belief z_t                        | `layers/kuro_engine/latent_state.cjs`                            |
| §10    | Adaptive compute budget                  | `layers/kuro_engine/compute_budget.cjs`                          |
| §11    | 30–50 nodes, depth 3–4, weighted merge   | `layers/kuro_engine/search.cjs`                                  |
| §12    | Eight tool actions                       | `layers/kuro_engine/tools.cjs`                                   |
| §13    | Sanitisation                             | `training/sanitize.py`                                           |
| §14    | Data balancing                           | `training/balance.py`                                            |
| §15    | Promotion gate (≥ +5%)                   | `training/promote.py`                                            |
| §16    | Five-axis eval harness                   | `training/evaluate.py`                                           |
| §17    | Safeguards                               | `layers/kuro_engine/safeguards.cjs` + `training/monitor.py`      |

## Invariants (keep in sync)

Three pairs of constants MUST stay aligned across the JS/Python boundary:

1. `TOKEN_WEIGHTS`
   - `layers/kuro_engine/prompts.cjs` ↔ `training/token_weights.py`
2. Advantage-pipeline thresholds (`gamma`, `tau_A`, `tau_E`, `alpha`, `conf_lo/hi`)
   - `layers/kuro_engine/advantage.cjs DEFAULTS` ↔ `training/configs/awbc.yaml pipeline.*`
3. PLAN-masking drop probability and PRNG
   - `layers/kuro_engine/safeguards.cjs xorshift32 + dropProb=0.15`
   - ↔ `training/token_weights.py xorshift32 + PLAN_MASK_PROB`

Drift between these pairs will silently corrupt training. A follow-up task
should add a CI check that reads both sides and asserts equality — for now
they are convention-enforced with comments pointing to the mirror file.

## Running the Engine Against a Live Model

```js
const { Engine } = require('./layers/kuro_engine');
const { ask }    = require('./layers/ollama.js');
const voter      = require('./layers/voter_layer.js');
const synth      = require('./layers/synthesis_layer.js');
const webSearch  = require('./layers/web_search.js');

const deps = {
  ollama: {
    chat: ({ messages, temperature }) =>
      ask({ model: 'qwen3.5:35b', messages, temperature })
  },
  judge:       async (p, o) => (await voter.judge({ prompt: p, candidate: o })).score,
  synthesizer: async (p, opts) => synth.synthesize({ prompt: p, ...opts }),
  webSearch
};

const engine = new Engine(deps, { maxSteps: 8 });
const r = await engine.run(userGoal);
```

## What "DON'T CHANGE THE MODEL" means in V2.5

- The base LLM remains **frozen** at inference. V2.5's intelligence lives in
  the scaffold (engine), not the weights.
- Training does update weights — but only via a small **LoRA adapter**
  (r=32, α=64, seven target projections). The base 4-bit weights never move.
- Promotion only swaps the adapter, never the base model.
- The KL term in AWBC is computed against the adapter-disabled forward pass,
  anchoring the adapter to the base model's behaviour.

## Next Steps (not yet scheduled)

1. Wire `/api/stream` to call `Engine.run` behind a feature flag.
2. Add a CI workflow that runs `node layers/kuro_engine/tests/unit.cjs` +
   `node scripts/kuro_engine_smoke.cjs`.
3. Add a drift-check script asserting the three invariant pairs above.
4. Swap the Qwen2.5-32B placeholder in `awbc.yaml model.name` for the
   actual Qwen3.5 35B snapshot path on the training rig.
