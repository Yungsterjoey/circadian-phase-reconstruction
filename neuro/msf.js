/**
 * msf.js — Multi-Signal Function (MSF) Orchestration Layer
 * NEURO-KURO Tier 0 | KURO OS v9
 *
 * MSF(t) = S_endo(t) + S_pharma(t) + S_env(t) + S_elec(t) + S_field(t)
 *
 * S_endo  — Endogenous circadian signal (IMPLEMENTED via circadian_model.js)
 * S_pharma — Pharmacokinetic / substance signal          (PENDING)
 * S_env   — Environmental / contextual signal            (PENDING)
 * S_elec  — Electrophysiological signal (EEG/HRV)        (PENDING)
 * S_field — Electromagnetic / geophysical field signal   (PENDING)
 *
 * Supported computation modes:
 *   RECALL   — reconstruct historical state from logged inputs
 *   PRESENT  — compute current state
 *   PROJECT  — forecast future trajectory
 *   SIMULATE — run counterfactual scenario
 */

'use strict';

const circadian = require('./circadian_model.js');

// ─── Sub-signal stubs ────────────────────────────────────────────────────────
// Each returns a standardised envelope: { value, confidence, status }.
// Confidence = 0 until the sub-module is implemented.

/**
 * S_pharma(t) — Pharmacokinetic model (adenosine, melatonin, stimulants, etc.)
 * Pending: requires PK module with compound-specific half-life tables.
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ value: {}, confidence: number, status: string }}
 */
function S_pharma(t) { // eslint-disable-line no-unused-vars
  return { value: {}, confidence: 0, status: 'PENDING_PK_MODULE' };
}

/**
 * S_env(t) — Environmental context (ambient light, temperature, noise, location)
 * Pending: requires sensor feed and environment DB.
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ value: {}, confidence: number, status: string }}
 */
function S_env(t) { // eslint-disable-line no-unused-vars
  return { value: {}, confidence: 0, status: 'PENDING_ENV_MODULE' };
}

/**
 * S_elec(t) — Electrophysiological signal (EEG alpha/theta, HRV RMSSD)
 * Pending: requires wearable data ingestion pipeline.
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ value: {}, confidence: number, status: string }}
 */
function S_elec(t) { // eslint-disable-line no-unused-vars
  return { value: {}, confidence: 0, status: 'PENDING_ELEC_MODULE' };
}

/**
 * S_field(t) — Electromagnetic / geophysical field signal (Schumann resonance, solar flux)
 * Pending: requires external geophysical data feeds.
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ value: {}, confidence: number, status: string }}
 */
function S_field(t) { // eslint-disable-line no-unused-vars
  return { value: {}, confidence: 0, status: 'PENDING_FIELD_MODULE' };
}

// ─── S_endo: live circadian signal ───────────────────────────────────────────

/**
 * S_endo(t) — Endogenous circadian signal.
 * Wraps circadian_model.js getCurrentPhase().
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ value: object, confidence: number, status: string }}
 */
function S_endo(t) {
  const result = circadian.getCurrentPhase(t);
  return {
    value:      result,
    confidence: result.confidence,
    status:     'OK',
  };
}

// ─── MSF aggregator ──────────────────────────────────────────────────────────

/**
 * Aggregate all five sub-signals into the Multi-Signal Function output.
 * Confidence is the weighted mean of implemented sub-signal confidences
 * (zero-confidence stubs are included in denominator to reflect incompleteness).
 *
 * @param {number} t — evaluation time (ms since epoch)
 * @returns {{ signals, aggregateConfidence, msfValue }}
 */
function _aggregate(t) {
  const signals = {
    endo:   S_endo(t),
    pharma: S_pharma(t),
    env:    S_env(t),
    elec:   S_elec(t),
    field:  S_field(t),
  };

  const confs = Object.values(signals).map(s => s.confidence);
  // Simple mean — treats all sub-signals as equally weighted in the target model.
  const aggregateConfidence = confs.reduce((a, b) => a + b, 0) / confs.length;

  // msfValue: collect value payloads from all sub-signals.
  const msfValue = Object.fromEntries(
    Object.entries(signals).map(([k, v]) => [k, v.value])
  );

  return { signals, aggregateConfidence: Math.round(aggregateConfidence * 1000) / 1000, msfValue };
}

// ─── Mode handlers ───────────────────────────────────────────────────────────

/**
 * computeMSF — Main entry point. Dispatches by mode.
 *
 * @param {number} timestamp — evaluation anchor (ms since epoch)
 * @param {'RECALL'|'PRESENT'|'PROJECT'|'SIMULATE'} mode
 * @param {object} [opts] — mode-specific options
 *   PROJECT:  { hoursAhead: number }
 *   SIMULATE: { params: object } — forwarded to circadian.simulateShift()
 *   RECALL:   { fromMs: number, toMs: number } — placeholder (pending log replay)
 * @returns {object}
 */
function computeMSF(timestamp, mode = 'PRESENT', opts = {}) {
  switch (mode) {

    case 'PRESENT': {
      const agg = _aggregate(timestamp);
      return {
        mode,
        timestamp,
        ...agg,
      };
    }

    case 'PROJECT': {
      const hoursAhead = opts.hoursAhead || 24;
      // Project the circadian sub-signal; other stubs have no trajectory yet.
      const endoProjection = circadian.project(hoursAhead, timestamp);
      const presentAgg     = _aggregate(timestamp);
      return {
        mode,
        timestamp,
        hoursAhead,
        endoProjection,
        // Aggregate confidence at projection origin only (future confidence decays per step).
        aggregateConfidence: presentAgg.aggregateConfidence,
        signals:             presentAgg.signals,
      };
    }

    case 'SIMULATE': {
      const simResult = circadian.simulateShift({ ...(opts.params || {}), fromMs: timestamp });
      const presentAgg = _aggregate(timestamp);
      return {
        mode,
        timestamp,
        simulation: simResult,
        aggregateConfidence: presentAgg.aggregateConfidence,
        signals:             presentAgg.signals,
      };
    }

    case 'RECALL': {
      // Full recall requires log replay across all sub-signals — pending implementation.
      // Returns current state as the best available approximation.
      const agg = _aggregate(timestamp);
      return {
        mode,
        timestamp,
        status:  'PARTIAL_RECALL — log replay not yet implemented',
        ...agg,
      };
    }

    default:
      throw new Error(`computeMSF: unknown mode "${mode}". Valid: RECALL PRESENT PROJECT SIMULATE`);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  computeMSF,
  // Expose individual sub-signal functions for direct use / testing.
  S_endo,
  S_pharma,
  S_env,
  S_elec,
  S_field,
  // Re-export circadian update for the /update route.
  updateCircadian: circadian.update,
};
