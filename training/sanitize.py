# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Sanitizer (Spec §13)
# ═══════════════════════════════════════════════════════════════════════════
#
# Reads trajectory JSONL logs produced by layers/kuro_engine/trajectory_log.cjs
# and applies the §5 seven-stage advantage pipeline, plus the §13 cleanup
# checklist:
#
#   1. Drop corrupted / parse-failed steps
#   2. Re-compute V / ΔV against local running stats (so changes in the
#      engine's Welford state don't poison training)
#   3. Stage A — squashed delta (Δ_norm)
#   4. Stage B — short-horizon A_t = Δ_t + γ Δ_{t+1}
#   5. Stage C — batch normalise
#   6. Stage D — dynamic rescale (max|A| → 1)
#   7. Stage E — Pareto retention
#   8. Stage F — calibration gate
#   9. Stage G — final softplus weight · confidence
#  10. Emit Parquet with every field training/train.py expects
#
# Usage
#   python -m training.sanitize \
#     --raw-glob "$KURO_DATA/trajectories/*.jsonl" \
#     --out      "$KURO_DATA/training/sanitized.parquet" \
#     --config   training/configs/awbc.yaml
#
# This script is PURE over its input files — running it twice on the same raw
# data produces identical output. All stateful parts (running stats) are
# re-initialised per invocation.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import yaml

EPS = 1e-6


# ── Running stats (Welford) ────────────────────────────────────────────────
# Mirrors layers/kuro_engine/running_stats.cjs so the sanitizer's sense of
# "normalised" matches the engine's at inference time.
@dataclass
class RunningStats:
    n: int = 0
    mean: float = 0.0
    M2: float = 0.0

    def update(self, x: float) -> None:
        if not math.isfinite(x):
            return
        self.n += 1
        delta = x - self.mean
        self.mean += delta / self.n
        delta2 = x - self.mean
        self.M2 += delta * delta2

    @property
    def variance(self) -> float:
        return self.M2 / (self.n - 1) if self.n > 1 else 0.0

    @property
    def std(self) -> float:
        return math.sqrt(max(self.variance, 0.0))


# ── JSONL loader ───────────────────────────────────────────────────────────
def iter_steps(paths: list[str]) -> Iterable[dict]:
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for ln, line in enumerate(fh, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("type") != "step":
                        continue
                    rec["__src_file"] = p
                    rec["__src_line"] = ln
                    yield rec
        except FileNotFoundError:
            continue


# ── Pipeline stages — ports of advantage.cjs ──────────────────────────────
def stage_a_delta(v_curr: float, v_next: float, stats: RunningStats) -> float:
    raw = v_next - v_curr
    stats.update(raw)
    sigma = max(stats.std, EPS)
    return math.tanh(raw / (2 * sigma))


def stage_b_short_horizon(deltas: list[float], gamma: float) -> list[float]:
    n = len(deltas)
    out = [0.0] * n
    for t in range(n):
        nxt = deltas[t + 1] if t + 1 < n else 0.0
        out[t] = deltas[t] + gamma * nxt
    return out


def stage_c_batch_norm(A: list[float], clip_a: float) -> list[float]:
    if not A:
        return []
    arr = np.asarray(A, dtype=np.float64)
    mean = float(arr.mean())
    std = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
    normed = (arr - mean) / (std + EPS)
    return np.clip(normed, -clip_a, clip_a).tolist()


def stage_d_dynamic_rescale(A: list[float]) -> list[float]:
    if not A:
        return []
    arr = np.asarray(A, dtype=np.float64)
    max_abs = float(np.max(np.abs(arr)))
    return (arr / (max_abs + EPS)).tolist()


def stage_e_pareto(sample: dict, A_t: float, cfg: dict) -> bool:
    if abs(A_t) >= cfg["tau_A"]:
        return True
    curr = sample.get("v_raw") or {}
    nxt = sample.get("v_next_raw") or {}
    eps_m = cfg["metric_improve_eps"]
    for k in curr.keys():
        if (nxt.get(k, 0.0) or 0.0) - (curr.get(k, 0.0) or 0.0) >= eps_m:
            return True
    return False


def stage_f_calibration_gate(sample: dict, cfg: dict) -> bool:
    dp = sample.get("delta_pred")
    da = sample.get("delta_actual")
    if dp is None or da is None:
        return True  # fail-open — Welford stats will deprioritise via weight
    if not (math.isfinite(dp) and math.isfinite(da)):
        return True
    return abs(dp - da) <= cfg["tau_E"]


def stage_g_weight(
    A_batch: list[float],
    confidences: list[float],
    cfg: dict,
) -> list[float]:
    n = len(A_batch)
    if n == 0:
        return []
    alpha = cfg["alpha_weight"]
    conf_lo = cfg["conf_lo"]
    conf_hi = cfg["conf_hi"]
    b = float(np.mean(A_batch))
    weights = []
    for i in range(n):
        s = alpha * (A_batch[i] - b)
        # Numerically stable softplus
        softplus = max(s, 0.0) + math.log1p(math.exp(-abs(s)))
        c = min(max(confidences[i] if confidences[i] is not None else conf_lo, conf_lo), conf_hi)
        weights.append(softplus * c)
    return weights


# ── Trajectory assembly ────────────────────────────────────────────────────
def group_by_session(steps: Iterable[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for s in steps:
        sid = s.get("session") or "__nosession__"
        groups.setdefault(sid, []).append(s)
    # Sort each session by step index `t` if present, else by source line
    for sid, lst in groups.items():
        lst.sort(key=lambda r: (r.get("t", 0), r.get("__src_line", 0)))
    return groups


def _coerce_v_pair(step: dict) -> tuple[float, float] | None:
    V_prev = step.get("V_prev")
    V_next = step.get("V_next")
    if V_prev is None or V_next is None:
        return None
    if not (math.isfinite(V_prev) and math.isfinite(V_next)):
        return None
    return float(V_prev), float(V_next)


# ── Main sanitise entrypoint ───────────────────────────────────────────────
def sanitize(raw_paths: list[str], cfg_pipeline: dict) -> pd.DataFrame:
    steps = list(iter_steps(raw_paths))
    sessions = group_by_session(steps)
    delta_stats = RunningStats()

    rows: list[dict] = []

    for sid, sess in sessions.items():
        # 1) Drop corrupted V pairs upfront
        clean = []
        for s in sess:
            vpair = _coerce_v_pair(s)
            if vpair is None:
                continue
            V_prev, V_next = vpair
            clean.append((s, V_prev, V_next))
        if not clean:
            continue

        # 2) Stage A — per-step squashed delta (shares global ΔV stats)
        deltas = [stage_a_delta(v0, v1, delta_stats) for (_, v0, v1) in clean]

        # 3) Stage B — short-horizon
        A = stage_b_short_horizon(deltas, cfg_pipeline["gamma"])

        # 4) Stage C — batch normalise (per-session)
        A = stage_c_batch_norm(A, cfg_pipeline["clip_A"])

        # 5) Stage D — dynamic rescale
        A = stage_d_dynamic_rescale(A)

        # 6+7) Pareto + calibration gates
        survivor_idx = []
        dropped_pareto = dropped_cal = 0
        for i, (s, _, _) in enumerate(clean):
            if not stage_e_pareto(s, A[i], cfg_pipeline):
                dropped_pareto += 1
                continue
            if not stage_f_calibration_gate(s, cfg_pipeline):
                dropped_cal += 1
                continue
            survivor_idx.append(i)

        if not survivor_idx:
            continue

        # 8) Stage G — softplus weight, over surviving batch only
        A_keep = [A[i] for i in survivor_idx]
        confs = [
            (clean[i][0].get("confidence") or cfg_pipeline["conf_lo"])
            for i in survivor_idx
        ]
        weights = stage_g_weight(A_keep, confs, cfg_pipeline)

        for j, i in enumerate(survivor_idx):
            s, V_prev, V_next = clean[i]
            blocks = s.get("blocks") or {}
            rows.append({
                "session": sid,
                "t": s.get("t"),
                "goal": s.get("goal"),
                "controller_text": s.get("raw_controller") or "",
                # Block content — the training-side token_weights.py reads these
                "state_block":      blocks.get("state") or "",
                "reasoning_block":  blocks.get("reasoning") or "",
                "plan_block":       json.dumps(blocks.get("plan") or [], ensure_ascii=False),
                "plan_masked":      json.dumps(blocks.get("plan_masked") or [], ensure_ascii=False),
                "delta_block":      "" if blocks.get("delta_pred") is None else str(blocks.get("delta_pred")),
                "next_state_block": json.dumps(blocks.get("next_state") or {}, ensure_ascii=False),
                # Numeric targets
                "V_prev": V_prev,
                "V_next": V_next,
                "delta_pred":   s.get("delta_pred"),
                "delta_actual": s.get("delta_actual") if s.get("delta_actual") is not None else (V_next - V_prev),
                "delta_norm":   deltas[i],
                "advantage":    A[i],
                "weight":       weights[j],
                "confidence":   confs[j],
                "calibration_error": s.get("calibration_error"),
                # Bookkeeping
                "src_file": s.get("__src_file"),
                "src_line": s.get("__src_line"),
                "dropped_pareto_in_session": dropped_pareto,
                "dropped_cal_in_session":    dropped_cal,
            })

    df = pd.DataFrame(rows)
    return df


# ── CLI ────────────────────────────────────────────────────────────────────
def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def main() -> int:
    ap = argparse.ArgumentParser(description="KURO trajectory sanitizer (§13).")
    ap.add_argument("--raw-glob", default=None,
                    help="Glob for trajectory JSONL (defaults to config data.raw_glob).")
    ap.add_argument("--out",      default=None,
                    help="Output parquet path (defaults to config data.sanitized_out).")
    ap.add_argument("--config",   default="training/configs/awbc.yaml")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)

    raw_glob = _expand(args.raw_glob or cfg["data"]["raw_glob"])
    out      = _expand(args.out      or cfg["data"]["sanitized_out"])

    paths = sorted(glob.glob(raw_glob))
    if not paths:
        print(f"[sanitize] no files matched: {raw_glob}", file=sys.stderr)
        return 2

    print(f"[sanitize] reading {len(paths)} file(s) from {raw_glob}")
    df = sanitize(paths, cfg["pipeline"])

    if df.empty:
        print("[sanitize] no surviving rows", file=sys.stderr)
        return 3

    Path(os.path.dirname(out) or ".").mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)

    print(f"[sanitize] wrote {len(df)} rows → {out}")
    print(f"[sanitize] advantage stats: "
          f"min={df['advantage'].min():.3f} "
          f"max={df['advantage'].max():.3f} "
          f"μ={df['advantage'].mean():.3f} "
          f"σ={df['advantage'].std():.3f}")
    print(f"[sanitize] weight stats:    "
          f"min={df['weight'].min():.3f} "
          f"max={df['weight'].max():.3f} "
          f"μ={df['weight'].mean():.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
