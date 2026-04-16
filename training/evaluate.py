# ═══════════════════════════════════════════════════════════════════════════
# KURO::TRAINING — Evaluation harness (Spec §16)
# ═══════════════════════════════════════════════════════════════════════════
#
# Five-axis evaluation of a checkpoint against a held-out trajectory JSONL:
#
#   1. V score            — mean final V per session (higher is better)
#   2. ΔV calibration     — mean |ΔV_pred − ΔV_actual|   (target < 0.15)
#   3. Monotonicity       — fraction of trajectories where V trends up
#   4. Token efficiency   — mean output length vs. expected_len
#   5. Adversarial        — V on an adversarial subset (flagged by path prefix)
#
# Offline mode consumes trajectory JSONL directly — perfect for CI and for the
# promotion gate. An optional "online" mode runs the engine against a live
# model via a supplied deps factory, but the shipping default is offline.
#
# Usage
#   python -m training.evaluate \
#     --raw-glob "$KURO_DATA/trajectories/eval-*.jsonl" \
#     --config   training/configs/awbc.yaml \
#     --out-json "${OUTPUT_DIR}/eval_report.json"
# ═══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
from collections import defaultdict
from typing import Iterable

import yaml


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def _iter_jsonl(paths: list[str]) -> Iterable[dict]:
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    rec["__src"] = p
                    yield rec
        except FileNotFoundError:
            continue


# ── Metric 1: V score ─────────────────────────────────────────────────────
def metric_v_score(records: list[dict]) -> dict:
    finals = [r for r in records if r.get("type") == "final"]
    vs = [r["bestV"] for r in finals if math.isfinite(r.get("bestV", float("-inf")))]
    if not vs:
        return {"mean_V": None, "n": 0}
    return {
        "mean_V": sum(vs) / len(vs),
        "min_V":  min(vs),
        "max_V":  max(vs),
        "n":      len(vs),
    }


# ── Metric 2: ΔV calibration ──────────────────────────────────────────────
def metric_calibration(records: list[dict], target: float = 0.15) -> dict:
    steps = [r for r in records if r.get("type") == "step"]
    errors = []
    for r in steps:
        dp = r.get("delta_pred")
        da = r.get("delta_actual")
        if dp is None or da is None:
            continue
        if not (math.isfinite(dp) and math.isfinite(da)):
            continue
        errors.append(abs(float(dp) - float(da)))
    if not errors:
        return {"mean_abs_error": None, "passes": None, "target": target, "n": 0}
    mean = sum(errors) / len(errors)
    return {
        "mean_abs_error": mean,
        "passes": mean < target,
        "target": target,
        "p50": sorted(errors)[len(errors) // 2],
        "p90": sorted(errors)[int(len(errors) * 0.9)] if len(errors) > 10 else None,
        "n": len(errors),
    }


# ── Metric 3: monotonicity (V trends upward within a session) ─────────────
def metric_monotonicity(records: list[dict]) -> dict:
    by_session: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        if r.get("type") != "step":
            continue
        sid = r.get("session") or "__none__"
        by_session[sid].append(r)

    sessions_analysed = 0
    monotone_count = 0
    for sid, steps in by_session.items():
        if len(steps) < 3:
            continue
        sessions_analysed += 1
        steps_sorted = sorted(steps, key=lambda s: s.get("t", 0))
        vs = [s.get("V_next") for s in steps_sorted if s.get("V_next") is not None]
        if len(vs) < 3:
            continue
        # "Monotone enough" = final V > initial V AND at least 60% of deltas ≥ 0
        non_neg = sum(1 for i in range(1, len(vs)) if vs[i] >= vs[i - 1])
        frac_up = non_neg / max(len(vs) - 1, 1)
        if vs[-1] > vs[0] and frac_up >= 0.6:
            monotone_count += 1

    if sessions_analysed == 0:
        return {"fraction_monotone": None, "n": 0}
    return {
        "fraction_monotone": monotone_count / sessions_analysed,
        "n": sessions_analysed,
    }


# ── Metric 4: token efficiency ────────────────────────────────────────────
def metric_token_efficiency(records: list[dict], expected_len: int = 400) -> dict:
    steps = [r for r in records if r.get("type") == "step"]
    lens = []
    for r in steps:
        x = r.get("x") or ""
        if isinstance(x, str) and x:
            lens.append(len(x))
    if not lens:
        return {"mean_len": None, "ratio_vs_expected": None, "n": 0}
    mean_len = sum(lens) / len(lens)
    return {
        "mean_len": mean_len,
        "ratio_vs_expected": mean_len / expected_len,
        "n": len(lens),
    }


# ── Metric 5: adversarial robustness ──────────────────────────────────────
# Adversarial records are flagged either by file-name prefix "adversarial-"
# or by the session having an explicit `adversarial: true` marker. This lets
# operators curate a hostile eval set without changing the log schema.
def metric_adversarial(records: list[dict]) -> dict:
    adv_finals = []
    for r in records:
        if r.get("type") != "final":
            continue
        src = r.get("__src", "")
        is_adv = (
            os.path.basename(src).startswith("adversarial-")
            or bool(r.get("adversarial"))
        )
        if is_adv and r.get("bestV") is not None:
            adv_finals.append(r["bestV"])

    if not adv_finals:
        return {"mean_V": None, "n": 0}
    return {
        "mean_V": sum(adv_finals) / len(adv_finals),
        "min_V":  min(adv_finals),
        "n":      len(adv_finals),
    }


# ── Report ─────────────────────────────────────────────────────────────────
def evaluate(raw_glob: str, cfg: dict) -> dict:
    paths = sorted(glob.glob(_expand(raw_glob)))
    if not paths:
        return {"error": f"no files matched {raw_glob}"}
    records = list(_iter_jsonl(paths))
    if not records:
        return {"error": "no records parsed"}

    eval_cfg = cfg.get("eval", {})
    target   = eval_cfg.get("calibration_target", 0.15)
    expected = eval_cfg.get("token_efficiency_expected_len", 400)

    report = {
        "files":           len(paths),
        "record_count":    len(records),
        "v_score":         metric_v_score(records),
        "calibration":     metric_calibration(records, target=target),
        "monotonicity":    metric_monotonicity(records),
        "token_efficiency": metric_token_efficiency(records, expected_len=expected),
        "adversarial":     metric_adversarial(records),
    }

    # Top-level pass/fail: calibration target is the spec-defined gate.
    cal = report["calibration"]
    report["passes_calibration"] = bool(cal.get("passes"))
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description="KURO evaluation harness (§16).")
    ap.add_argument("--raw-glob", required=True)
    ap.add_argument("--config", default="training/configs/awbc.yaml")
    ap.add_argument("--out-json", default=None)
    args = ap.parse_args()

    cfg = {}
    if os.path.exists(args.config):
        with open(args.config, "r", encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)

    report = evaluate(args.raw_glob, cfg)

    out = json.dumps(report, indent=2, default=str)
    print(out)
    if args.out_json:
        os.makedirs(os.path.dirname(_expand(args.out_json)) or ".", exist_ok=True)
        with open(_expand(args.out_json), "w", encoding="utf-8") as fh:
            fh.write(out)

    return 0 if report.get("passes_calibration") else 1


if __name__ == "__main__":
    sys.exit(main())
