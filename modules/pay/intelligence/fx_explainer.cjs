'use strict';
// §4.6 — Dynamic copy for the FX transparency modal. Sync, <500ms budget.
const { ORCHESTRATOR, chat, safeParse } = require('./models.cjs');
const { isInjectionEcho } = require('./prompt_safety.cjs');

const SYSTEM = [
  'You write one short paragraph (2-3 sentences, ≤60 words) explaining an FX conversion honestly.',
  'State the AUD amount, the rate applied, how it compares to the mid-market rate, and that Stripe takes a margin.',
  'Output JSON only: {"copy":string}. No markdown.',
].join(' ');

function staticFallback({ amount_aud, applied_rate, mid_rate }) {
  const spread = mid_rate ? ((mid_rate - applied_rate) / mid_rate * 100).toFixed(2) : '~1.7';
  return `You pay AUD $${amount_aud}. Stripe applies a rate ~${spread}% off mid-market to cover currency handling. The merchant receives the full VND amount shown.`;
}

let _modelFn = async (system, user) => chat({ ...ORCHESTRATOR, timeout_ms: 500 }, system, user);

async function explain({ amount_aud, applied_rate, mid_rate }) {
  try {
    const raw = await _modelFn(SYSTEM, { amount_aud, applied_rate, mid_rate });
    if (isInjectionEcho(raw)) {
      return { copy: staticFallback({ amount_aud, applied_rate, mid_rate }), fallback: true };
    }
    const parsed = safeParse(raw, null);
    if (!parsed || !parsed.copy) {
      return { copy: staticFallback({ amount_aud, applied_rate, mid_rate }), fallback: true };
    }
    return { copy: parsed.copy, fallback: false };
  } catch (_) {
    return { copy: staticFallback({ amount_aud, applied_rate, mid_rate }), fallback: true };
  }
}

module.exports = { explain, _setModelForTest: fn => { _modelFn = fn; } };
