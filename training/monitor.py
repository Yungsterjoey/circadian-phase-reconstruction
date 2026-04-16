# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Offline distribution watchdog (Spec §17 / Final Red Team)
# ═══════════════════════════════════════════════════════════════════════════
#
# Reads the latest trajectory JSONL(s) and reports whether the A_t, E_t, and
# ΔV distributions are healthy. Mirrors the runtime HealthMonitor in
# layers/kuro_engine/safeguards.cjs but against logged data — used for
# periodic sanity checks and post-training regression detection.
#
# Thresholds match the runtime ones:
#   - advantage_collapse    A_t.std < 0.05
#   - advantage_runaway     A_t.std > 0.8
#   - calibration_degraded  mean E_t > 0.25
#   - delta_flatlined       ΔV.std < 0.01
#
# Usage
#   python -m training.monitor --raw-glob "$KURO_DATA/trajectories/*.jsonl"
#
# Emits JSON to stdout; exits 0 if no alerts, 1 otherwise.
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
import statistics
from typing import Iterable


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def _iter_steps(paths: list[str]) -> Iterable[dict]:
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if r.get("type") == "step":
                        yield r
        except FileNotFoundError:
            continue


def _std(xs: list[float]) -> float:
    return statistics.pstdev(xs) if len(xs) >= 2 else 0.0


def assess(steps: list[dict]) -> dict:
    deltas     = []
    advantages = []
    errors     = []

    for s in steps:
        da = s.get("delta_actual")
        if da is not None and math.isfinite(da):
            deltas.append(float(da))
        dn = s.get("delta_norm")
        if dn is not None and math.isfinite(dn):
            advantages.append(float(dn))
        e = s.get("calibration_error")
        if e is not None and math.isfinite(e):
            errors.append(float(e))

    alerts = []
    if len(advantages) >= 32 and _std(advantages) < 0.05:
        alerts.append({"kind": "advantage_collapse", "std": _std(advantages)})
    if len(advantages) >= 32 and _std(advantages) > 0.8:
        alerts.append({"kind": "advantage_runaway", "std": _std(advantages)})
    if len(errors) >= 32 and (sum(errors) / len(errors)) > 0.25:
        alerts.append({"kind": "calibration_degraded", "mean": sum(errors) / len(errors)})
    if len(deltas) >= 32 and _std(deltas) < 0.01:
        alerts.append({"kind": "delta_flatlined", "std": _std(deltas)})

    return {
        "step_count": len(steps),
        "advantages": {"n": len(advantages), "std": _std(advantages),
                       "mean": (sum(advantages) / len(advantages)) if advantages else None},
        "errors":     {"n": len(errors), "mean": (sum(errors) / len(errors)) if errors else None},
        "deltas":     {"n": len(deltas), "std": _std(deltas),
                       "mean": (sum(deltas) / len(deltas)) if deltas else None},
        "alerts": alerts,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="KURO offline health monitor.")
    ap.add_argument("--raw-glob", required=True)
    args = ap.parse_args()

    paths = sorted(glob.glob(_expand(args.raw_glob)))
    steps = list(_iter_steps(paths))
    report = {
        "files": len(paths),
        **assess(steps),
    }
    print(json.dumps(report, indent=2, default=str))
    return 1 if report["alerts"] else 0


if __name__ == "__main__":
    sys.exit(main())
