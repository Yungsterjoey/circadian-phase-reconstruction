# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Balancer (Spec §14)
# ═══════════════════════════════════════════════════════════════════════════
#
# Reshuffles sanitized rows so the trainer sees a healthy mix of high-signal
# positives, low-signal steady-state, and explicit negatives.
#
# Rules (per spec §14):
#   - Oversample the top-|A_t| quantile (default 20%)   → learn from peaks
#   - Keep 30–40% of batch as negatives (A_t < 0)        → preserve contrast
#   - Shuffle deterministically for reproducible epochs  → seed from config
#
# Run after sanitize.py, before train.py:
#   python -m training.balance \
#     --sanitized "$KURO_DATA/training/sanitized.parquet" \
#     --out       "$KURO_DATA/training/balanced.parquet" \
#     --config    training/configs/awbc.yaml
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def balance(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    if df.empty:
        return df.copy()

    rng = np.random.default_rng(cfg.get("shuffle_seed", 17))
    top_frac  = cfg.get("oversample_top_abs_A_fraction", 0.20)
    neg_frac  = cfg.get("negative_fraction", 0.35)

    # ── 1) Identify top |A_t| quantile ────────────────────────────────────
    abs_a   = df["advantage"].abs()
    thresh  = abs_a.quantile(1 - top_frac) if len(df) > 4 else abs_a.min()
    peaks   = df[abs_a >= thresh]
    middle  = df[abs_a <  thresh]

    # Oversample peaks ×2 — simple, effective, no leakage into negatives
    peaks_x2 = pd.concat([peaks, peaks.sample(frac=1.0, random_state=rng.integers(0, 2**31))])

    combined = pd.concat([peaks_x2, middle], ignore_index=True)

    # ── 2) Adjust negative fraction ──────────────────────────────────────
    negatives = combined[combined["advantage"] < 0]
    positives = combined[combined["advantage"] >= 0]

    target_size = len(combined)
    target_neg  = int(round(neg_frac * target_size))

    if len(negatives) == 0 or len(positives) == 0:
        # Degenerate batch — nothing to rebalance
        balanced = combined
    else:
        # If we have too few negatives, upsample with replacement; too many, downsample.
        if len(negatives) < target_neg:
            extra = negatives.sample(
                n=target_neg - len(negatives), replace=True,
                random_state=rng.integers(0, 2**31)
            )
            negatives = pd.concat([negatives, extra])
        elif len(negatives) > target_neg:
            negatives = negatives.sample(
                n=target_neg, random_state=rng.integers(0, 2**31)
            )

        pos_needed = target_size - len(negatives)
        if len(positives) > pos_needed:
            positives = positives.sample(
                n=pos_needed, random_state=rng.integers(0, 2**31)
            )
        elif len(positives) < pos_needed:
            extra = positives.sample(
                n=pos_needed - len(positives), replace=True,
                random_state=rng.integers(0, 2**31)
            )
            positives = pd.concat([positives, extra])

        balanced = pd.concat([negatives, positives], ignore_index=True)

    # ── 3) Deterministic shuffle ─────────────────────────────────────────
    balanced = balanced.sample(frac=1.0, random_state=rng.integers(0, 2**31)).reset_index(drop=True)
    return balanced


def main() -> int:
    ap = argparse.ArgumentParser(description="KURO training-batch balancer (§14).")
    ap.add_argument("--sanitized", default=None)
    ap.add_argument("--out",       default=None)
    ap.add_argument("--config",    default="training/configs/awbc.yaml")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)

    sanitized = _expand(args.sanitized or cfg["data"]["sanitized_out"])
    out       = _expand(args.out       or cfg["data"]["balanced_out"])

    if not os.path.exists(sanitized):
        print(f"[balance] sanitized parquet missing: {sanitized}", file=sys.stderr)
        return 2

    df = pd.read_parquet(sanitized)
    print(f"[balance] loaded {len(df)} rows from {sanitized}")

    balanced = balance(df, cfg["balance"])

    Path(os.path.dirname(out) or ".").mkdir(parents=True, exist_ok=True)
    balanced.to_parquet(out, index=False)

    neg = (balanced["advantage"] < 0).mean()
    print(f"[balance] wrote {len(balanced)} rows → {out}")
    print(f"[balance] neg fraction: {neg:.3f} (target {cfg['balance']['negative_fraction']:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
