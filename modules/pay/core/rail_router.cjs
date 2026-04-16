'use strict';

// Routes an input string (QR payload or identifier) to the best-matching adapter.
// Runs all registered adapters' detect() in parallel, ranks by confidence,
// disambiguates if top two are within 0.1 of each other, falls back to
// USDC wallet prompt if all adapters score < 0.6.

const registry = require('./rail_registry.cjs');

const AMBIGUITY_THRESHOLD  = 0.1;
const MINIMUM_CONFIDENCE   = 0.6;

async function detect(input) {
  const adapters = registry.list();
  if (adapters.length === 0) {
    return { matched: false, reason: 'no_adapters_registered', fallback: 'usdc_wallet' };
  }

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const r = await adapter.detect(input);
        return { adapter, ...r };
      } catch (err) {
        return { adapter, matches: false, confidence: 0, error: err.message };
      }
    })
  );

  const ranked = results
    .filter(r => r.matches)
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) {
    return { matched: false, reason: 'no_adapter_matched', fallback: 'usdc_wallet' };
  }

  const top  = ranked[0];
  const next = ranked[1];

  // Ambiguity: top two within 0.1 — let caller show disambiguation UI
  if (next && (top.confidence - next.confidence) <= AMBIGUITY_THRESHOLD) {
    return {
      matched:        false,
      ambiguous:      true,
      candidates:     ranked.slice(0, 3).map(r => ({
        rail:       r.adapter.id,
        confidence: r.confidence,
        parsed:     r.parsed || null,
      })),
    };
  }

  // Below minimum — fall back
  if (top.confidence < MINIMUM_CONFIDENCE) {
    return {
      matched:    false,
      reason:     'low_confidence',
      best:       { rail: top.adapter.id, confidence: top.confidence },
      fallback:   'usdc_wallet',
    };
  }

  return {
    matched:    true,
    rail:       top.adapter.id,
    confidence: top.confidence,
    parsed:     top.parsed || null,
  };
}

module.exports = { detect };
