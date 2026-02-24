# NEURO-KURO Tier 0 — Circadian Phase Engine Validation Summary

**Module:** `circadian_model.js` | **Date:** 2026-02-24 | **Tests:** T1–T14, 14/14 pass

---

## What This Module Does

- Reconstructs circadian phase φ(t) ∈ [0, 2π) from entrainment inputs (sleep, light, caffeine) via a gain-weighted Bayesian correction on S¹ with phase-wrapped innovation, applied at each observation.
- Projects free-running phase forward in time; simulates schedule-shift scenarios (jet-lag, shift work).
- Outputs phase label (ACTIVATION / BALANCE / BRAKE / RESET), confidence score, and predicted transition times. Does not model sleep homeostasis (Process S).

---

## Mathematical Core

**Propagation:** φ(t) = (φ₀ + ω·Δt) mod 2π, ω = 2π/τ, τ = 24.2 h
**Bayesian correction:** gain-weighted correction on S¹: φ_post = φ_prior + K·(φ_obs − φ_prior), shortest-arc (phase-wrapped) innovation
**Confidence decay:** C(t) = C₀·e^(−λ·Δt), λ = 0.08 h⁻¹
**PRC direction:** binary zones — DELAY [4π/3, 7π/4), ADVANCE [7π/4, 2π)∪[0, π/6)
**Phase-dependent gain:** piecewise — advance tail [0, π/6): K_base·sin(π/6 − φ) (pragmatic smoothing); night (π, 2π): K_base·max(0, sin(φ − π)); dead zone [π/6, π]: 0

---

## Test Suite (T1–T14)

**T1** Phase advances at ω; full period returns to φ₀.
**T2** Kalman correction scales with K; K=0 preserves prior, K=1 equals observed.
**T3** Confidence matches e^(−λΔt) at Δt=1/λ and 24 h.
**T4** project() samples correct; confidence monotone non-increasing.
**T5** simulateShift() delta proportional to shiftHours×ω; zero shift → zero delta.
**T6** All four labels in 24 h; wrap-around correct at 0/2π.
**T7** 720 h no-input: φ ∈ [0,2π), C ≥ 0, no NaN/Inf.
**T8** 8 h sleep shift + opposing light + caffeine: all outputs in valid ranges.
**T9** 10 light pulses / 2 h: phase absorbed at zone boundary (zone-edge absorption, not attractor convergence); dead zone entered and held.
**T10** 60-combination sweep (τ, λ, K ±20%): φ and conf in bounds, errH < 6 h.
**T11** φ=0, φ=2π−ε, wrap-boundary sleep: no label discontinuity at any boundary.
**T12** Light pulse at φ=0.05 rad (ADVANCE tail): pre-fix gain=0 confirmed, post-fix gain>0, |Δφ|>0, direction=ADVANCE.
**T13** Gain continuity at φ=π: both sides give K≈0 (no cliff). Deliberate wrap-gate at 2π/0 documented (cliff ≈ 0.30 — pragmatic smoothing artifact, not CBT_min anchor).
**T14** φ=1e-9 micro boundary: post-correction phase ∈ [0, 2π), no sign flip, wrapPhase output finite and valid under high-lux ADVANCE input.

---

## Key Robustness Results (T10)

60 combinations: τ ∈ {23.8–24.5} h, λ ∈ {0.02–0.20} h⁻¹, K_scale ∈ {0.8, 1.0, 1.2}. One sleep event at T+16 h; evaluated at T+48 h.

| Metric | Worst case |
|--------|-----------|
| Max \|errHours\| vs. nominal | **1.40 h** (τ=23.8, Ks=0.8) |
| Max projDiv(h) at T+49 h | **1.40 h** (same) |
| λ effect on phase | **0.00 h** (confidence only) |
| K_scale effect at nominal τ | **±0.87 h** (symmetric) |

---

## Known Limitations

1. **Confidence saturation** — display rounds to 0 after ~43 h (C < 0.0005); raw value positive but uninformative.
2. **Correction non-commutativity** — inputs applied sequentially; permuting order changes the posterior. Joint estimation not implemented.
3. **Binary PRC zone-edge absorption** — light corrections stop abruptly once the phase crosses the zone boundary. This is zone-edge absorption: no restoring force exists in the dead zone. It is not attractor convergence (no stable fixed-point; a Van der Pol oscillator would behave differently).
4. **τ mismatch accumulation** — Δφ(48h) ≈ 1.4 h for Δτ = 0.7 h; individual τ not detectable from observations.
5. **Equal-quadrant labels** — four π/2-wide segments do not match biological durations; boundary misclassification may reach ~1 h.
6. **Deliberate wrap-gate discontinuity** — gain cliff of ≈ 0.30 at the 2π/0 boundary (advance tail gives K>0 at φ=0⁺; night-side formula gives K=0 at φ→2π⁻). May produce different correction magnitudes for numerically equivalent phases near 0 and 2π. This is pragmatic smoothing to avoid a dead ADVANCE region, not a biological artifact.

---

## Repro Steps

```bash
# Run all 11 tests
node /opt/kuro/core/neuro/circadian_model.test.js

# Run 5 validation scenarios
node /opt/kuro/core/neuro/circadian_validation.js

# Append-only API state log
/opt/kuro/data/neuro/state_log.jsonl
```

---

**Status: Tier 0 (software-only). Advisory only. Not medical advice.**
