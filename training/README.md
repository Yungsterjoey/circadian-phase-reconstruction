# KURO::TRAINING — V2.5 Playbook

> Advantage-Weighted Behavioral Cloning pipeline for Qwen3.5 35B with QLoRA 4-bit.
> Consumes JSONL trajectories emitted by `layers/kuro_engine` at inference time.

## Pipeline at a Glance

```
 trajectories/*.jsonl  (produced by layers/kuro_engine/trajectory_log.cjs)
           │
           ▼  sanitize.py          §13 — 7-stage advantage pipeline
 training/sanitized.parquet
           │
           ▼  balance.py           §14 — oversample peaks, 30-40% negatives
 training/balanced.parquet
           │
           ▼  train.py             §5, §6, §8 — QLoRA + AWBC loss
 checkpoints/kuro-v25-lora/
           │
           ▼  evaluate.py          §16 — V, cal, monotonicity, eff, adversarial
 eval_report.json
           │
           ▼  promote.py           §15 — +5% uplift gate → CURRENT marker
 promote_target/CURRENT
```

Every stage is idempotent — re-running produces the same output if input is
the same. All stateful math (running stats, Welford) lives inside the script
invocation, never persisted between runs.

## Files

| File             | Role                                                                                 |
|------------------|--------------------------------------------------------------------------------------|
| `requirements.txt`| Pinned PyPI deps (torch + transformers + peft + trl + bitsandbytes + deepspeed).     |
| `configs/awbc.yaml` | All hyperparameters in one place. Model, quant, lora, pipeline, loss, tokens, balance, train, eval, promote, data. |
| `configs/accelerate.yaml` | Accelerate launcher config pointing at DeepSpeed.                             |
| `configs/ds_config_35b.json` | DeepSpeed Zero-3 with CPU offload.                                        |
| `sanitize.py`    | Reads JSONL trajectories; applies §5 stages A–G; writes parquet.                     |
| `balance.py`     | §14 batch balancing: oversample top-20% \|A\|, enforce 35% negatives.                |
| `token_weights.py`| Per-token weight table + PLAN masking (mirrors `prompts.cjs`).                      |
| `awbc_loss.py`   | CE · w_t + λ₁·Huber + β·KL. Framework-agnostic over batch shape.                     |
| `train.py`       | QLoRA 4-bit NF4 trainer with custom Trainer.compute_loss.                            |
| `evaluate.py`    | §16 five-metric harness against held-out trajectories.                               |
| `promote.py`     | §15 uplift gate (≥+5%) + CURRENT marker.                                             |
| `monitor.py`     | Offline health watchdog (mirrors `safeguards.cjs` HealthMonitor).                    |

## Full run (single node)

```bash
export KURO_DATA=/var/lib/kuro

# 0. Deps (one-time)
pip install -r training/requirements.txt

# 1. Sanitize ~10k steps in seconds
python -m training.sanitize \
    --config training/configs/awbc.yaml

# 2. Balance the dataset
python -m training.balance \
    --config training/configs/awbc.yaml

# 3. Train (multi-GPU recommended for 35B)
accelerate launch \
    --config_file training/configs/accelerate.yaml \
    training/train.py \
    --config training/configs/awbc.yaml

# 4. Evaluate on held-out trajectories
python -m training.evaluate \
    --raw-glob "$KURO_DATA/trajectories/eval-*.jsonl" \
    --config training/configs/awbc.yaml \
    --out-json $KURO_DATA/eval/candidate.json

# 5. Promote (if +5% over baseline and cal < 0.15)
python -m training.promote \
    --candidate-eval $KURO_DATA/eval/candidate.json \
    --baseline-eval  $KURO_DATA/eval/baseline.json \
    --candidate-dir  $KURO_DATA/checkpoints/kuro-v25-lora \
    --promote-to    $KURO_DATA/promoted \
    --config training/configs/awbc.yaml

# 6. (Optional) Health check
python -m training.monitor \
    --raw-glob "$KURO_DATA/trajectories/*.jsonl"
```

## Collecting Trajectories

The engine automatically writes JSONL to `$KURO_DATA/trajectories/YYYY-MM-DD.jsonl`
on every `engine.run()`. No separate export is needed — the trainer reads those
files directly. For eval sets, point the engine at a dedicated session prefix
and use that prefix in `--raw-glob`.

## Hyperparameters

See `configs/awbc.yaml`. Keep in mind:

- **pipeline.*** mirrors `advantage.cjs DEFAULTS`. Changing one requires changing
  the other — the engine's in-flight calibration gate uses these same thresholds.
- **tokens.*** mirrors `prompts.cjs TOKEN_WEIGHTS`. Same invariant.
- **model.name** is a placeholder — swap for your local Qwen3.5 35B snapshot path
  at train time. Keep trust_remote_code on; Qwen models ship custom attention.
- **quant.bnb_4bit_compute_dtype** should match your GPU's preferred dtype
  (bf16 on A100/H100, fp16 on older cards).

## Troubleshooting

- **"CUDA out of memory" on load**: drop `max_seq_length` (configs/awbc.yaml
  `train.max_seq_length`) or enable offload in `ds_config_35b.json`.
- **`advantage_collapse` alert from monitor**: your trajectories have too little
  variance. Raise controller temperature at inference time or widen τ_A so more
  samples survive Stage E.
- **`calibration_degraded`**: the controller's ΔV predictions have drifted. Run
  extra iterations with the current checkpoint to refresh before promotion.
- **Empty balanced.parquet**: probably all samples were dropped by Stage F
  (calibration). Temporarily raise `pipeline.tau_E` to diagnose.

## Invariants worth guarding

1. `TOKEN_WEIGHTS` in `token_weights.py` ↔ `TOKEN_WEIGHTS` in `prompts.cjs`.
2. `pipeline.*` in `awbc.yaml` ↔ `DEFAULTS` in `advantage.cjs`.
3. `plan_mask_prob` in `awbc.yaml` ↔ `dropProb` default in `safeguards.cjs`.
4. The evaluation harness's calibration target (0.15) is a spec-defined number.
   Do not raise it without updating §16.
