# Circadian Phase Reconstruction Engine — Mathematical Reference

**Module:** `circadian_model.js`
**Version:** NEURO-KURO Tier 0, KURO OS v9
**Date:** 2026-02-24
**Status:** Research prototype. Not validated for clinical use.

---

## 1. Model Overview

This module reconstructs the endogenous circadian phase as a single continuous
variable φ(t) on the circle [0, 2π). The model is a first-order scalar
approximation of the two-process model of sleep regulation (Borbély &
Achermann, 1999) restricted to the circadian component only. The homeostatic
process (Process S) is not implemented.

The approach has three components:

1. **Free-running propagation** — phase advances at a fixed angular velocity
   derived from the intrinsic period τ.
2. **Bayesian (scalar Kalman) correction** — entrainment inputs shift the
   estimated phase toward an observed anchor, weighted by input reliability.
3. **Confidence decay** — uncertainty in the phase estimate grows exponentially
   in the absence of new inputs.

---

## 2. State Representation

The model maintains a minimal state vector:

```
S = { φ₀, C₀, t₀ }
```

| Symbol | Type    | Meaning                                          |
|--------|---------|--------------------------------------------------|
| φ₀     | radians | Phase at the time of last state update           |
| C₀     | [0, 1]  | Confidence in φ₀ at time t₀                     |
| t₀     | ms      | Wall-clock timestamp of last state write         |

---

## 3. Equations

### 3.1 Phase Propagation

In the absence of external zeitgebers, the circadian oscillator advances at
the intrinsic angular velocity ω:

```
φ(t) = (φ₀ + ω · Δt)  mod  2π

where:
  ω  = 2π / τ          (angular velocity, rad h⁻¹)
  τ  = 24.2 h           (intrinsic free-running period)
  Δt = t − t₀          (hours elapsed since last state write)
```

This is a first-order Euler integration of the phase ODE dφ/dt = ω. Higher-
order integration is not warranted given the uncertainty in τ across individuals
(SD ≈ 0.17 h; Czeisler et al., 1999).

### 3.2 Bayesian Phase Correction

When an entrainment input provides an observed phase φ_obs, the posterior
estimate is updated via a scalar Kalman step:

```
φ_posterior = φ_prior + K · δ

where:
  δ = φ_obs − φ_prior     (innovation, computed on shortest arc)
  K ∈ [0, 1]              (input reliability / Kalman gain)
```

The shortest-arc innovation handles the discontinuity at the 0/2π boundary:

```
if δ >  π:  δ = δ − 2π
if δ < −π:  δ = δ + 2π
```

This is equivalent to a one-step update in a static Kalman filter where the
measurement noise covariance is assumed proportional to (1 − K) and the
process noise is zero between updates.

### 3.3 Confidence Decay

Confidence decays exponentially with time since the last entrainment input:

```
C(t) = C₀ · e^(−λ · Δt)

where:
  λ = 0.08 h⁻¹           (decay rate; half-confidence ≈ 8.7 h)
  Δt = t − t₀             (hours since last state write)
```

When an entrainment input of gain K is applied, confidence is boosted:

```
C_new = min(1.0,  C_old + K · (1 − C_old))
```

This is a convex combination that asymptotically approaches 1 as repeated
high-K inputs are applied.

### 3.4 Phase Response Curve (PRC) for Light

The direction and magnitude of a photic phase shift depend on *when* in the
circadian cycle the stimulus occurs. This is the Phase Response Curve (Kronauer
et al., 1999; Khalsa et al., 2003).

The model uses a first-order binary-zone PRC approximation:

```
Zone 1 — DELAY:   φ ∈ [4π/3, 7π/4)    ≈ CT16 – CT21
  Δφ = −Δφ_max · sat(E)

Zone 2 — ADVANCE: φ ∈ [7π/4, 2π) ∪ [0, π/6)   ≈ CT21 – CT24 and CT0 – CT1
  Δφ = +Δφ_max · sat(E)

Zone 3 — DEAD ZONE: all other phases
  Δφ = 0
```

where the lux saturation curve is:

```
sat(E) = 1 − e^(−E / 2000)

  E        = illuminance (lux)
  Δφ_max   = prcMaxShiftHours · ω    (default: 2 h × ω ≈ 0.519 rad)
```

The boundary at φ = 7π/4 (CT21 ≈ 5.497 rad) corresponds to the core body
temperature minimum (CBT_min), which is the empirical zero-crossing of the
human PRC (Czeisler & Khalsa, 2000).

The gain-weighted net correction applied in update() is:

```
φ_new = (φ_prior + K_light · Δφ)  mod  2π
```

### 3.5 Sleep Phase Observation

Sleep onset is used as a phase anchor near the BRAKE→RESET boundary:

```
φ_obs = (3π/2 + α · π/8)  mod  2π

where:
  α = (D_sleep − 7.0) / 7.0       (normalised duration deviation)
  D_sleep = (t_offset − t_onset) in hours
```

The anchor 3π/2 (CT18) is chosen as a robust empirical midpoint for habitual
sleep onset. Duration deviation shifts the anchor by at most ±π/8 rad
(≈ ±1.1 h equivalent) over the range 0–14 h.

### 3.6 Caffeine Phase Observation

Caffeine is modelled as a weak phase cue anchored to the BALANCE midpoint
(3π/4), with effectiveness decaying at the pharmacological half-life:

```
K_eff = K_caffeine · e^(−ln2 · Δt_caf / t_½)

where:
  Δt_caf  = hours since caffeine intake
  t_½     = 5 h (caffeine half-life; Nehlig et al., 1992)
  K_caffeine = 0.4 (base reliability weight)
```

The Bayesian correction pulls the prior toward φ_obs = 3π/4 with gain K_eff.

---

## 4. Parameter Definitions

| Parameter            | Symbol      | Default  | Units   | Source / Rationale                              |
|----------------------|-------------|----------|---------|-------------------------------------------------|
| Intrinsic period     | τ           | 24.2     | h       | Czeisler et al. (1999) population mean          |
| Angular velocity     | ω = 2π/τ   | 0.2596   | rad h⁻¹ | Derived from τ                                  |
| Confidence decay rate| λ           | 0.08     | h⁻¹     | Half-confidence ≈ 8.7 h; heuristic              |
| Sleep gain           | K_sleep     | 0.9      | —       | Dominant zeitgeber; high reliability            |
| Light gain           | K_light     | 0.6      | —       | Photic input via ipRGC pathway; moderate        |
| Caffeine gain        | K_caffeine  | 0.4      | —       | Indirect chronobiotic; weaker cue               |
| Light threshold      | E_min       | 50       | lux     | Below scotopic range; no entrainment modelled   |
| PRC lux saturation   | E_sat       | 2000     | lux     | Saturating photic response curve                |
| PRC max shift        | Δφ_max      | 2 h × ω  | rad     | Empirical PRC amplitude (Khalsa et al., 2003)   |
| PRC delay start      | φ_D         | 4π/3     | rad     | CT16 ≈ 4.189 rad                               |
| CBT minimum          | φ_CBT       | 7π/4     | rad     | CT21 ≈ 5.497 rad                               |
| PRC advance end      | φ_A         | π/6      | rad     | CT1 ≈ 0.524 rad                                |
| Caffeine half-life   | t_½         | 5        | h       | Nehlig et al. (1992)                           |

All parameters are accessible at runtime via `getConfig()` and adjustable
via `setConfig(overrides)` without breaking the public API.

---

## 5. Phase Label Mapping

The continuous phase [0, 2π) is partitioned into four equal quadrants for
human-readable output. Labels are indicative only; they do not correspond
to discrete biological states.

| Label      | Range (rad)      | Approx. CT  | Subjective correlate                        |
|------------|------------------|-------------|---------------------------------------------|
| ACTIVATION | [0, π/2)         | CT0 – CT6   | Rising cortisol, core temperature climbing  |
| BALANCE    | [π/2, π)         | CT6 – CT12  | Peak alertness, cognitive performance       |
| BRAKE      | [π, 3π/2)        | CT12 – CT18 | Melatonin onset, core temperature falling   |
| RESET      | [3π/2, 2π)       | CT18 – CT24 | Sleep consolidation, SWS dominant           |

CT = circadian time, defined such that CT0 corresponds to habitual wake time
in a fully entrained individual.

---

## 6. Assumptions

1. **Single oscillator.** The model treats the circadian pacemaker as a single
   phase variable. Tissue-level clocks and inter-organ coupling are not modelled.

2. **Constant τ.** The intrinsic period is fixed at 24.2 h. Intra-individual
   variation and age-dependent drift (typically −0.01 h/decade) are not modelled.

3. **Instantaneous entrainment.** Zeitgeber corrections are applied as a single
   Bayesian update step. The gradual, multi-day re-entrainment dynamics of the
   Van der Pol oscillator (Kronauer et al., 1982) are not captured.

4. **Additive independence.** Multiple simultaneous zeitgebers are applied
   sequentially (sleep → light → caffeine). Cross-signal interactions are
   not modelled.

5. **Phase-dependent Kalman gain for light.** K_light(φ) is now a
   sinusoidal function of phase rather than a constant (see Section 3.7).
   Sleep and caffeine gains remain constant. The sinusoidal form is a
   first-order PRC amplitude approximation; a full nonlinear Kronauer model
   would compute the gain from a two-process coupled oscillator.

6. **Binary PRC zones.** The PRC direction (advance / delay / dead zone) is
   still approximated as two rectangular zones. The empirical human PRC has a
   smooth, sinusoidal profile; the binary approximation introduces up to ~0.5 h
   error at zone boundaries.

7. **Caffeine as phase cue.** The caffeine model treats adenosine antagonism
   as a weak circadian phase cue anchored to the BALANCE phase. This is a
   simplification. Caffeine's primary effect is alerting (Process S modulation),
   not direct phase shifting of the SCN pacemaker.

8. **No homeostatic component.** Process S (sleep pressure) is not modelled.
   Outputs represent circadian phase only, not overall alertness or performance.

---

## 7. Limitations

- **No individual calibration.** The model uses population-level parameters.
  Individual τ varies from ≈23.5 to ≈25.0 h (Czeisler et al., 1999). Estimates
  will drift for individuals with atypical periods.

- **No feedback loop.** There is no mechanism for the oscillator to resist
  entrainment (limit-cycle dynamics). Repeated large corrections can displace
  the phase arbitrarily, unlike a true nonlinear oscillator.

- **Confidence is heuristic.** The decay rate λ and the confidence boost formula
  are heuristically chosen. They do not correspond to a statistically derived
  covariance model.

- **Light is not time-stamped spatially.** The model cannot distinguish between
  a 10-minute pulse and 8-hour continuous light exposure of the same lux value.
  Duration-weighting is not implemented.

- **No masking.** Direct (non-photic) masking of overt rhythms by behaviour
  (e.g., forced wakefulness, exercise) is not modelled.

- **Single time zone.** All timestamps are absolute (ms since epoch). There is
  no concept of local social time or jet-lag relative to a destination
  time zone; callers must provide timestamps in the appropriate frame.

---

## 8. Known Simplifications vs. Published Models

| Feature                        | This model          | Kronauer et al. (1999)          |
|--------------------------------|---------------------|---------------------------------|
| Oscillator type                | Phase-only (1D)     | Van der Pol (2D, limit cycle)   |
| PRC shape                      | Binary rectangular  | Smooth sinusoidal               |
| Light integration              | Instantaneous lux   | Time-integral of photic history |
| τ variability                  | Fixed               | Individual-fitted               |
| Homeostatic process            | Absent              | Two-process coupled model       |
| Inter-individual differences   | None                | Chronotype parameterisation     |

---

## 9. References

- Borbély, A.A. & Achermann, P. (1999). Sleep homeostasis and models of sleep
  regulation. *Journal of Biological Rhythms*, 14(6), 557–568.
- Czeisler, C.A. et al. (1999). Stability, precision, and near-24-hour period
  of the human circadian pacemaker. *Science*, 284(5423), 2177–2181.
- Czeisler, C.A. & Khalsa, S.B.S. (2000). The human circadian timing system
  and sleep-wake regulation. In *Principles and Practice of Sleep Medicine*,
  3rd ed., pp. 353–375.
- Jewett, M.E. & Kronauer, R.E. (1998). Refinement of a limit cycle oscillator
  model of the effects of light on the human circadian pacemaker. *Journal of
  Theoretical Biology*, 192(4), 455–465.
- Khalsa, S.B.S. et al. (2003). A phase response curve to single bright light
  pulses in human subjects. *Journal of Physiology*, 549(3), 945–952.
- Kronauer, R.E. et al. (1982). Mathematical model of the human circadian system
  with two interacting oscillators. *American Journal of Physiology*, 242(1),
  R3–R17.
- Kronauer, R.E. et al. (1999). Quantifying human circadian pacemaker response
  to brief, extended, and repeated light stimuli over the phototopic range.
  *Journal of Biological Rhythms*, 14(6), 500–515.
- Nehlig, A. et al. (1992). Caffeine and the central nervous system: mechanisms
  of action, biochemical, metabolic and psychostimulant effects. *Brain Research
  Reviews*, 17(2), 139–170.

---

## 10. Future Integration

This module implements **S_endo(t)**, the endogenous circadian sub-function of
a broader **Memory State Function (MSF)** architecture:

```
MSF(t) = S_endo(t) + S_pharma(t) + S_env(t) + S_elec(t) + S_field(t)
```

`circadian_model.js` is component 1 of 5. The remaining sub-functions are
defined with stub interfaces in `msf.js` and return `confidence: 0` pending
implementation. The full MSF is orchestrated by `msf.js`, which exposes
`computeMSF(timestamp, mode)` for external consumption.

Defined interface contracts for pending sub-functions:

| Sub-function | Identifier   | Status               | Description                                       |
|--------------|--------------|----------------------|---------------------------------------------------|
| Endogenous   | S_endo(t)    | **Implemented**      | Circadian phase reconstruction (this module)      |
| Pharmacological | S_pharma(t) | PENDING_PK_MODULE  | Substance PK/PD modelling (adenosine, melatonin)  |
| Environmental | S_env(t)    | PENDING_ENV_MODULE   | Ambient light, temperature, noise, location       |
| Electrophysiological | S_elec(t) | PENDING_ELEC_MODULE | EEG, HRV, wearable biosignal integration    |
| Field        | S_field(t)   | PENDING_FIELD_MODULE | Geophysical / electromagnetic field correlates    |

Each sub-function is expected to return an envelope of the form:

```js
{
  value:      object,   // sub-function-specific payload
  confidence: number,   // [0, 1]
  status:     string,   // 'OK' | 'PENDING_*' | error string
}
```

The circadian module is designed so that its public API (`getCurrentPhase`,
`update`, `project`, `simulateShift`, `getConfig`, `setConfig`, `computePRC`)
is stable and does not require modification when sibling sub-functions are
implemented. Changes to the MSF aggregation logic are isolated to `msf.js`.

---

## 11. Phase-Dependent Kalman Gain K(φ) for Light Entrainment

### 11.1 Biological Basis

The human circadian PRC for bright-light stimuli is not flat: the magnitude
of the phase shift depends strongly on the phase at which light is delivered
(Czeisler et al., 1989, *Science* 244:1328; Khalsa et al., 2003). Near the
core body temperature minimum (CBT_min), small perturbations produce large
phase shifts. Near CBT_max (subjective midday), the oscillator is most
resistant to entrainment. A constant Kalman gain K ignores this structure and
applies uniform correction regardless of circadian phase, which overestimates
entrainment sensitivity during the subjective day and underestimates it near
CBT_min.

### 11.2 Mathematical Form

The phase-dependent gain replaces the constant K_light with:

```
K(φ) = K_base · max(0, sin(φ − π))

where:
  K_base = kalmanGain.light     (configurable; default 0.6)
  π      = gain-null reference point (CT12 analogue in this model)
```

The `max(0, ·)` clamp ensures K(φ) ∈ [0, K_base] ⊆ [0, 1], satisfying the
Kalman filter requirement of non-negative gain.

### 11.3 Gain Profile

| Phase φ       | sin(φ − π)  | K(φ)          | Interpretation                       |
|---------------|-------------|---------------|--------------------------------------|
| 0 (= 2π)      | 0           | 0             | CBT_max; oscillator maximally stable |
| π/2           | −1          | 0 (clamped)   | Midday; suppressed gain              |
| π             | 0           | 0             | Gain-null reference (CT12 analogue)  |
| 3π/2          | +1          | K_base (max)  | RESET midpoint; peak sensitivity     |
| 7π/4 (≈ CBT_min) | +0.707   | 0.707·K_base  | Near biological CBT_min; high gain   |

The gain is zero for φ ∈ [0, π] (subjective day and early night) and
positive and sinusoidally varying for φ ∈ (π, 2π) (subjective night).

### 11.4 Interaction with the Binary PRC Zones

The direction of correction (ADVANCE / DELAY / DEAD_ZONE) continues to be
determined by `prcDelta()`, which implements the binary zone structure. K(φ)
modulates the *magnitude* of that correction:

```
Effective correction = K(φ) × sat(E) × maxΔφ

where:
  sat(E) = 1 − e^(−E / 2000)   (lux saturation)
  maxΔφ  = prcMaxShiftHours × ω (default 2h × ω ≈ 0.519 rad)
```

If K(φ) = 0 (i.e., φ ∈ [0, π]) but prcDelta would assign ADVANCE or DELAY,
the correction magnitude is zero and no state change occurs. The event is
logged in correctionApplied with K = 0 for auditability.

### 11.5 Distinction from Constant-Gain Filtering

| Property                    | Constant K                        | Phase-Dependent K(φ)              |
|-----------------------------|-----------------------------------|-----------------------------------|
| Correction magnitude        | Uniform across all phases         | Sinusoidally varying with φ       |
| Daytime light exposure      | Full correction K_base            | Zero correction (K=0 for φ<π)     |
| Near CBT_min (φ≈3π/2)      | Same K as all other phases        | Maximum K = K_base                |
| Near CBT_max (φ≈0)         | Full K applies                    | K → 0 (biologically correct)      |
| Number of parameters added  | 0                                 | 0 (uses existing K_base and π)    |
| Computational cost          | O(1)                              | O(1) + one sin() call             |

The phase-dependent form is a strictly more accurate first-order approximation
of the biological PRC than a constant gain. It adds no free parameters beyond
the existing K_base.

### 11.6 Limitation Note

The reference point φ = π (CT12 analogue) is a modelling simplification.
The empirical gain-null for the human light PRC occurs at CBT_min, which is
around CT21 (φ ≈ 7π/4) in biological CT coordinates. The offset between π
and 7π/4 (= 9π/4 ≡ 5π/4 difference, or approximately 11.6 equivalent hours)
reflects the difference between the model's phase coordinate origin and the
biological CBT_min timing. A higher-fidelity implementation would use the
biological CBT_min (7π/4) as the gain-null reference, or derive the reference
individually from each user's chronotype data.

---

## 12. Robustness and Adversarial Test Results

Tests T7–T11 were designed to probe model stability beyond normal operating
conditions. All 11 tests (T1–T11) passed. Results and documented limitations
follow.

### T7 — 30-day no-input simulation

**Result: PASS**

Phase stays in [0, 2π) and confidence remains ≥ 0 for all 720 hourly samples.
No NaN, Inf, or negative values were produced. IEEE 754 double precision
correctly represents C(720) = e^(−57.6) ≈ 9.5 × 10⁻²⁶ as a non-zero
subnormal positive float.

**Documented limitation:**
The rounded display value (`Math.round(C × 1000) / 1000`) saturates to 0
after approximately 43 h of no input (when C < 5 × 10⁻⁴). The internal
raw value remains positive but provides no discriminating information for
long no-input windows. Callers relying on the rounded confidence for
threshold-based decisions should be aware of this saturation floor.

---

### T8 — Extreme simultaneous entrainment

**Result: PASS**

Phase stays in [0, 2π) and confidence stays in [0, 1] after an 8-hour sleep
shift, an opposing photic correction, and caffeine administered simultaneously.
No numerical instability was observed.

**Documented limitation:**
Correction order is fixed (sleep → light → caffeine). Applying the three
corrections in a different order would produce a different posterior, because
each step's PRC zone lookup and K(φ) evaluation depend on the phase value
after the previous correction. The model does not implement joint estimation
across simultaneous inputs. This ordering sensitivity is a consequence of the
sequential scalar Kalman update architecture.

---

### T9 — 10 sequential light corrections within 2 hours

**Result: PASS**

Phase converges toward the prcDelta dead zone (φ ∈ [π/6, 4π/3)) without
oscillating. Once the dead zone is entered, subsequent corrections produce
zero phase change. The sequence of per-step phase deltas is non-increasing.

**Documented limitation:**
The binary PRC zone structure produces zone-edge absorption: phase rapidly
converges to the dead-zone boundary and then stalls. A continuous sinusoidal
PRC (as in the Kronauer Van der Pol model) would produce a smooth asymptotic
approach to a stable fixed-point attractor. The binary zones are a coarser
approximation. Additionally, K(φ) = 0 for φ ∈ [0, π] means light corrections
are completely suppressed in the advance zone sub-region [0, π/6), even though
prcDelta classifies those phases as ADVANCE.

---

### T10 — Parameter sensitivity sweep (60 combinations)

**Result: PASS**

Maximum phase error at 48 h across all (τ, λ, K_scale) combinations: 1.40 h.
Phase errors are invariant to λ (decay rate has no effect on phase in the
absence of additional inputs after the single sleep event). Phase error scales
linearly with τ mismatch. K_scale ±20% produces ±0.87 h at nominal τ, with
the sign flipping symmetrically around the nominal K.

**Documented limitation:**
Phase error grows linearly with τ mismatch: Δφ(t) ≈ 2π × Δτ⁻¹ × Δt.
For a 0.7 h error in τ (the realistic inter-individual SD reported by
Czeisler et al., 1999), error accumulates at ≈ 0.029 rad/h ≈ 0.11 h/h.
Over one week without entrainment this would be ≈ 18 h of accumulated phase
error. The model has no mechanism to detect or correct τ mismatch from
observational data; user-specific τ calibration is not implemented.

---

### T11 — Boundary conditions

**Result: PASS**

Phase labels are continuous and correct across the 0/2π boundary, at exact
segment boundaries, and for sleep inputs at wrap-around points. No
discontinuities, gaps, or incorrect assignments were found.

**Documented limitation:**
Phase labels are assigned to exactly four equal quadrants of π/2 rad each.
Biological segment durations are not equal: the RESET segment (deep sleep)
subjectively spans ≈ 6–8 h, but π/2 ÷ ω ≈ 6.05 h in this model, which
coincidentally approximates the biological duration. However, the BALANCE
and BRAKE segments are each ≈ 6.05 h in the model while their biological
counterparts vary with chronotype, light exposure, and sleep pressure.
Phases near segment boundaries may be misclassified by up to ≈ 1–2 h of
biological time.

---

### Summary table

| Test | Description                                | Result | Primary Limitation                            |
|------|--------------------------------------------|--------|-----------------------------------------------|
| T7   | 30-day no-input, 720 h                     | PASS   | Confidence display saturates at 0 after 43 h  |
| T8   | Extreme simultaneous 3-signal correction   | PASS   | Correction order non-commutativity            |
| T9   | 10 sequential light pulses (convergence)   | PASS   | Binary zone-edge absorption (not smooth limit)|
| T10  | 60-combination parameter sensitivity       | PASS   | Phase error grows linearly with τ mismatch    |
| T11  | Boundary conditions (φ=0, φ=2π−ε, wrap)  | PASS   | Equal-quadrant labels vs. unequal biology     |

All T1–T11 tests pass. No failures were recorded. The documented limitations
represent known model approximations, not implementation defects.

---

*This document describes a research prototype. All parameter values are
population-level estimates. Outputs are decision-support signals only and
must not be used as a substitute for clinical assessment.*
