'use strict';

// Single source of truth for KUROPay commission tiers.
// Three knobs per tier: minimum_fee_aud, rate (fraction of gross), cap_aud (null = no cap).
// Fee math rounds UP to the nearest cent — never undercharge at display precision.

const TIERS = {
  free: { minimum_fee_aud: 0.19, rate: 0.03,   cap_aud: 5.00 },
  pro:  { minimum_fee_aud: 0,    rate: 0.015,  cap_aud: 3.00 },
  sov:  { minimum_fee_aud: 0,    rate: 0.0075, cap_aud: null },
};

const TIER_ALIASES = { sovereign: 'sov' };

const DAILY_LIMITS_AUD = { free: 500, pro: 2000, sov: 10000 };

// Rounding unit (in destination currency) for a displayable "X minimum" hint.
// VND and IDR have small unit values so we round up to a clean bill-friendly denomination.
const LOCAL_ROUND_UNIT = { VND: 500, IDR: 1000, THB: 1, PHP: 1, MYR: 1 };

function normalizeTier(tier) {
  const raw = String(tier || 'free').toLowerCase();
  const t = TIER_ALIASES[raw] || raw;
  return TIERS[t] ? t : 'free';
}

function getTier(user) { return normalizeTier(user && user.tier); }

function getPolicy(tier) { return TIERS[normalizeTier(tier)]; }

function getDailyLimitAUD(tier) { return DAILY_LIMITS_AUD[normalizeTier(tier)]; }

function ceilCents(aud) { return Math.ceil(aud * 100) / 100; }

function calcFee(grossAUD, tier) {
  const p = getPolicy(tier);
  let fee = grossAUD * p.rate;
  let feeFloored = false;
  let feeCapped  = false;
  if (fee < p.minimum_fee_aud) { fee = p.minimum_fee_aud; feeFloored = true; }
  if (p.cap_aud !== null && fee > p.cap_aud) { fee = p.cap_aud; feeCapped = true; }
  fee = ceilCents(fee);
  return {
    fee,
    feeFloored,
    feeCapped,
    rate: p.rate,
    cap_aud: p.cap_aud,
    minimum_fee_aud: p.minimum_fee_aud,
  };
}

// Display helper: convert the tier's AUD minimum into destination currency,
// rounded UP to a clean bill-friendly denomination. Null if min is zero or rate missing.
function localizedMinimum(minAUD, destinationCurrency, fxRate) {
  if (!minAUD || !fxRate || fxRate <= 0) return null;
  const unit = LOCAL_ROUND_UNIT[destinationCurrency] || 1;
  return Math.ceil((minAUD * fxRate) / unit) * unit;
}

// Convenience: all the policy knobs a frontend needs, with VND/IDR/... localized minima
// precomputed for common rails. Pass an fxRates map (e.g. { VND: 16500, THB: 23.5 }).
function publicPolicy(tier, fxRates) {
  const t = normalizeTier(tier);
  const p = TIERS[t];
  const minima = {};
  if (fxRates && typeof fxRates === 'object') {
    for (const [cur, rate] of Object.entries(fxRates)) {
      minima[cur] = localizedMinimum(p.minimum_fee_aud, cur, rate);
    }
  }
  return {
    tier: t,
    minimum_fee_aud: p.minimum_fee_aud,
    rate: p.rate,
    cap_aud: p.cap_aud,
    daily_limit_aud: DAILY_LIMITS_AUD[t],
    localized_minima: minima,
  };
}

module.exports = {
  TIERS,
  DAILY_LIMITS_AUD,
  LOCAL_ROUND_UNIT,
  normalizeTier,
  getTier,
  getPolicy,
  getDailyLimitAUD,
  calcFee,
  localizedMinimum,
  publicPolicy,
};
