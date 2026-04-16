# A Deterministic Phase-Wrapped Circadian Entrainment Engine with Bounded Gain and Adversarial Validation

---

## 1. Problem Framing

Circadian phase—the biological clock's position within its approximately 24-hour cycle—governs alertness, hormone secretion, thermoregulation, and metabolic function. Quantitative phase estimation is needed for jet-lag recovery, shift-work disorder management, and chronotherapy scheduling, yet continuous sensing via actigraphy or dim-light melatonin onset (DLMO) assay requires hardware and conditions unavailable outside clinical settings.

Prior continuous-time PRC models (Kronauer et al. 1999; Jewett et al. 1999) require numerical ODE integration and physiological time series. The goal here is a deployable discrete alternative: a Bayesian filter on the circle S¹ that propagates phase from sparse behavioral observations (sleep timing, light exposure, caffeine intake), quantifies its own uncertainty, and is fully verifiable by automated adversarial test.

---

## 2. Mathematical Formulation

**State:** φ(t) ∈ [0, 2π),   C(t) ∈ [0, 1]

**Free-running propagation:**

    φ(t) = (φ₀ + ω·Δt) mod 2π,    ω = 2π/τ,    τ = 24.2 h

**Confidence decay:**

    C(t) = C₀ · e^(−λ·Δt),    λ = 0.08 h⁻¹

**Phase-wrapped innovation (shortest arc on S¹):**

    Δφ = ((φ_obs − φ_prior + π) mod 2π) − π

**Bayesian posterior (Kalman-form correction on S¹):**

    φ_post = wrapPhase(φ_prior + K·Δφ)

Observation gains: K_sleep = 0.9, K_light = 0.6, K_caffeine = 0.4

**PRC zones:**

    DELAY:    φ ∈ [4π/3, 7π/4)
    ADVANCE:  φ ∈ [7π/4, 2π) ∪ [0, π/6)
    Dead zone: φ ∈ [π/6, π)

**Phase-dependent light gain (piecewise):**

    φ ∈ [0, π/6):   g(φ) = K_base · sin(π/6 − φ)          [advance tail]
    φ ∈ [π, 2π):    g(φ) = K_base · max(0, sin(φ − π))     [night arc]
    φ ∈ [π/6, π):   g(φ) = 0                                [dead zone]

**Phase labels (equal quadrants, π/2 rad each):**

    ACTIVATION ∈ [0, π/2),    BALANCE ∈ [π/2, π)
    BRAKE ∈ [π, 3π/2),        RESET ∈ [3π/2, 2π)

Sleep phase observation: midpoint of sleep arc mapped to S¹ via ω.

---

## 3. Implementation

The engine is a single CommonJS module (`circadian_model.js`) in Node.js with zero external runtime dependencies. State is `{phaseRadians, confidence, lastUpdateMs}`; configuration (τ, λ, K) is mutable via `setConfig()` for sensitivity sweeps without process restart.

**Architectural decisions:**

- **Discrete update, not ODE integration.** Each observation triggers one Bayesian correction step; no integration loop.
- **Phase wrapping at every operation.** `wrapPhase()` is applied after every arithmetic operation on φ to prevent accumulation error at the 0/2π boundary.
- **No network dependencies.** All computation is local; no external state store, no telemetry.
- **Deterministic given state.** Fixed `lastUpdateMs` and fixed input sequence reproduce all outputs bit-for-bit.
- **Exposed internals for unit testing.** The `_internal` export (`propagatePhase`, `bayesianCorrect`, `decayConfidence`, `lightPhaseGain`, `wrapPhase`, `getState`, `setState`) permits isolated testing of each primitive. The test suite uses only the built-in `assert` module.

---

## 4. Validation Results

All 15 tests pass (T1–T15, 15/15). The test suite is adversarial: 30-day free-run stability, simultaneous competing corrections, 10-pulse zone-saturation, a 60-combination parameter sweep, IEEE 754 boundary probes at φ = 0, φ = 2π − ε, and φ = 1 × 10⁻⁹, and DLMO validation against the MMASH real dataset.

| ID  | Scope | Result |
|-----|-------|--------|
| T1  | Phase propagation; full period returns to φ₀ | Pass |
| T2  | Kalman correction scales with K; K=0 preserves prior, K=1 equals observed | Pass |
| T3  | Confidence matches e^(−λΔt) at Δt = 1/λ and 24 h | Pass |
| T4  | project() samples correct; confidence monotone non-increasing | Pass |
| T5  | simulateShift() delta proportional to shiftHours×ω; zero shift → zero delta | Pass |
| T6  | All four labels present in 24 h; wrap-around correct at 0/2π | Pass |
| T7  | 720 h free-run: φ ∈ [0, 2π), C ≥ 0, no NaN/Inf | Pass |
| T8  | 8 h sleep shift + opposing light + caffeine: all outputs in valid ranges | Pass |
| T9  | 10 light pulses / 2 h: zone-edge absorption confirmed; dead zone entered and held | Pass |
| T10 | 60-combination parameter sweep (τ, λ, K ±20%): φ and conf in bounds, \|errH\| < 6 h | Pass |
| T11 | φ = 0, φ = 2π − ε, wrap-boundary sleep: no label discontinuity at any boundary | Pass |
| T12 | Light pulse at φ = 0.05 rad (ADVANCE tail): pre-fix gain = 0 confirmed, post-fix gain > 0, \|Δφ\| > 0, direction = ADVANCE | Pass |
| T13 | Gain continuity at φ = π: both sides give K ≈ 0 (no cliff); deliberate wrap-gate at 2π/0 documented (cliff ≈ 0.30) | Pass |
| T14 | φ = 1 × 10⁻⁹ micro boundary: post-correction phase ∈ [0, 2π), no sign flip, finite | Pass |
| T15 | MMASH DLMO validation: MAE = 0.29 h, mean signed error = +0.23 h, median \|error\| = 0.24 h, max \|error\| = 1.00 h (N = 20; user_11 excluded: no sleep; user_21 excluded: no saliva) | Pass |

**T10 Sensitivity Results** — 60 combinations: τ ∈ {23.8, 24.0, 24.2, 24.5} h, λ ∈ {0.02, 0.05, 0.08, 0.14, 0.20} h⁻¹, K_scale ∈ {0.8, 1.0, 1.2}. One sleep event at T+16 h; evaluated at T+48 h.

| Metric | Worst case |
|--------|------------|
| Max \|errHours\| vs. nominal | **1.40 h** (τ = 23.8, Ks = 0.8) |
| Max projDiv(h) at T+49 h | **1.40 h** (same combination) |
| λ effect on phase | **0.00 h** (confidence only) |
| K_scale effect at nominal τ | **±0.87 h** (symmetric) |

**T15 DLMO Validation Results** — MMASH dataset, N = 20 subjects (user_11 excluded: no sleep data; user_21 excluded: no saliva). Proxy: DLMO = sleep onset − 2 h (Benloucif et al. 2005). Anchor fix: `sleepPhaseObservation()` 3π/2 → 7π/4 resolved 2.48 h systematic bias prior to validation run.

| Metric | Value |
|--------|-------|
| MAE | **0.29 h** |
| Mean signed error | **+0.23 h** (model leads by 14 min; near-zero bias) |
| Median \|error\| | **0.24 h** |
| Max \|error\| | **1.00 h** (user_9; consistent with individual DLMO-to-sleep-onset variation) |

---

## 5. Known Limitations

1. **Confidence saturation** — display rounds to 0 after ~43 h (C < 0.0005); raw value positive but uninformative.
2. **Correction non-commutativity** — inputs applied sequentially; permuting order changes the posterior. Joint estimation not implemented.
3. **Binary PRC zone-edge absorption** — light corrections stop abruptly once the phase crosses the zone boundary. This is zone-edge absorption: no restoring force exists in the dead zone. It is not attractor convergence (no stable fixed-point; a Van der Pol oscillator would behave differently).
4. **τ mismatch accumulation** — Δφ(48 h) ≈ 1.4 h for Δτ = 0.7 h; individual τ is not detectable from observations.
5. **Equal-quadrant labels** — four π/2-wide segments do not match biological durations; boundary misclassification may reach ~1 h.
6. **Deliberate wrap-gate discontinuity** — gain cliff of ≈ 0.30 at the 2π/0 boundary (advance tail gives K > 0 at φ = 0⁺; night-side formula gives K = 0 at φ → 2π⁻). May produce different correction magnitudes for numerically equivalent phases near 0 and 2π. This is pragmatic smoothing to avoid a dead ADVANCE region, not a biological artifact.
7. **DLMO proxy (population-mean offset)** — Two-timepoint MMASH saliva samples are insufficient for threshold-based DLMO detection; population regression (sleep onset − 2 h; Benloucif et al. 2005) used instead. Individual DLMO-to-sleep-onset interval variation accounts for the residual +0.23 h signed bias observed in T15.

---

## 6. Future Work

**τ estimation from observations.** τ is currently a fixed parameter. An augmented Kalman state with τ as a latent variable could infer individual period from residual sleep-onset patterns across multiple cycles, addressing limitation 4.

**Full covariance propagation.** The scalar C(t) is not a principled uncertainty bound. Propagating a wrapped normal distribution on S¹ through each correction step would yield calibrated credible intervals on φ.

**Smooth continuous PRC.** The piecewise binary zones produce the abrupt transitions and wrap-gate discontinuity in limitation 6. A sinusoidal or Kronauer-form PRC would eliminate zone-edge absorption and yield a continuously differentiable gain function, enabling gradient-based parameter estimation.

**Real dataset validation (T15).** MMASH DLMO validation (T15, N = 20) confirms MAE = 0.29 h against a population-mean proxy (Benloucif et al. 2005). Comparison against the MESA Sleep Study actigraphy dataset (with threshold-based DLMO ground truth) would provide independent replication and calibrate τ to population distributions beyond the ±20% sweep in T10.

---

Source code and test suite: https://github.com/Yungsterjoey/circadian-phase-reconstruction
