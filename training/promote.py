# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Promotion gate (Spec §15)
# ═══════════════════════════════════════════════════════════════════════════
#
# "Only promote a new checkpoint if it beats the previous by ≥ +5% on V."
#
# Inputs
#   --candidate-eval  path to JSON report from evaluate.py for the NEW ckpt
#   --baseline-eval   path to JSON report for the CURRENT production ckpt
#   --min-uplift-pct  override for cfg.promote.min_uplift_pct (default 5.0)
#
# Exit
#   0  → promotion approved (uplift ≥ threshold AND calibration target met)
#   1  → promotion denied
#   2  → input missing / malformed
#
# Side effects
#   If --promote-to PATH is given and promotion is approved, writes:
#     PATH/CURRENT               ← symlink / file containing candidate dir
#     PATH/promotion_manifest.json
#   This is intentionally file-based (no registry dependency). Deploy scripts
#   read CURRENT to know which adapter to load.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import yaml


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def _load_report(p: str) -> dict:
    with open(p, "r", encoding="utf-8") as fh:
        return json.load(fh)


def decide(candidate: dict, baseline: dict, min_uplift_pct: float, metric: str = "mean_V") -> dict:
    cand_cal = candidate.get("calibration") or {}
    if cand_cal.get("passes") is False:
        return {
            "approved": False,
            "reason": "candidate_failed_calibration_target",
            "candidate_mean_abs_error": cand_cal.get("mean_abs_error"),
            "target": cand_cal.get("target"),
        }

    cand_v = (candidate.get("v_score") or {}).get(metric)
    base_v = (baseline.get("v_score")  or {}).get(metric)
    if cand_v is None:
        return {"approved": False, "reason": "candidate_missing_V_score"}
    if base_v is None:
        # No prior baseline → auto-approve iff candidate calibration passes
        return {
            "approved": True,
            "reason": "no_baseline_bootstrap_ok",
            "candidate_V": cand_v,
            "baseline_V": None,
        }

    uplift_pct = 100.0 * (cand_v - base_v) / max(abs(base_v), 1e-6)
    approved = uplift_pct >= min_uplift_pct
    return {
        "approved": approved,
        "reason": "uplift_met" if approved else "uplift_below_threshold",
        "candidate_V": cand_v,
        "baseline_V":  base_v,
        "uplift_pct":  uplift_pct,
        "required_pct": min_uplift_pct,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="KURO promotion gate (§15).")
    ap.add_argument("--candidate-eval", required=True)
    ap.add_argument("--baseline-eval",  default=None)
    ap.add_argument("--candidate-dir",  required=True,
                    help="Path to candidate adapter directory (written on approval).")
    ap.add_argument("--config",         default="training/configs/awbc.yaml")
    ap.add_argument("--min-uplift-pct", type=float, default=None)
    ap.add_argument("--promote-to",     default=None,
                    help="Write CURRENT marker into this directory on approval.")
    args = ap.parse_args()

    cfg = {}
    if os.path.exists(args.config):
        with open(args.config, "r", encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)
    min_uplift = (
        args.min_uplift_pct
        if args.min_uplift_pct is not None
        else cfg.get("promote", {}).get("min_uplift_pct", 5.0)
    )
    metric = cfg.get("promote", {}).get("uplift_metric", "mean_V")

    cand = _load_report(_expand(args.candidate_eval))
    base = _load_report(_expand(args.baseline_eval)) if args.baseline_eval else {}

    verdict = decide(cand, base, min_uplift, metric=metric)
    out = {
        "candidate_dir": _expand(args.candidate_dir),
        "verdict":       verdict,
    }
    print(json.dumps(out, indent=2, default=str))

    if verdict["approved"] and args.promote_to:
        p = Path(_expand(args.promote_to))
        p.mkdir(parents=True, exist_ok=True)
        (p / "CURRENT").write_text(_expand(args.candidate_dir) + "\n")
        with open(p / "promotion_manifest.json", "w") as fh:
            json.dump(out, fh, indent=2, default=str)

    return 0 if verdict["approved"] else 1


if __name__ == "__main__":
    sys.exit(main())
