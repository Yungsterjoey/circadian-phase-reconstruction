'use strict';

// Adapter quote + tier-aware commission + daily-limit enforcement.
// Pricing rules (rate, cap, minimum) live in ./commission_policy.cjs — this
// module just orchestrates. The ATM flow (stripe_connector.calculateAmount)
// has its own pricing model and is not touched here.

const policy = require('./commission_policy.cjs');

function getDB() {
  try { return require('../../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

function getTier(user) { return policy.getTier(user); }

function getCommissionRate(user) { return policy.getPolicy(getTier(user)).rate; }

function getCommissionCap(user)  { return policy.getPolicy(getTier(user)).cap_aud; }

// Compute commission for a gross AUD amount under the user's tier.
// Returns { grossAUD, commission, net, rate, feeCapped } to match legacy callers.
function calcCommission(grossAUD, user) {
  const { fee, feeCapped, rate } = policy.calcFee(grossAUD, getTier(user));
  const net = parseFloat((grossAUD - fee).toFixed(4));
  return { grossAUD, commission: fee, net, rate, feeCapped };
}

// Throw DAILY_LIMIT_EXCEEDED if adding amountAUD would breach today's tier limit.
function checkDailyLimit(user, amountAUD) {
  const db    = getDB();
  const tier  = getTier(user);
  const limit = policy.getDailyLimitAUD(tier);
  const today = new Date().toISOString().slice(0, 10);

  let usedAUD = 0;
  if (db && user && user.id) {
    const row = db.prepare(
      `SELECT total_aud FROM pay_daily_usage WHERE user_id=? AND date=?`
    ).get(user.id, today);
    usedAUD = (row && row.total_aud) || 0;
  }

  if (usedAUD + amountAUD > limit) {
    const err = new Error('DAILY_LIMIT_EXCEEDED');
    err.code         = 'DAILY_LIMIT_EXCEEDED';
    err.limitAUD     = limit;
    err.usedAUD      = usedAUD;
    err.requestedAUD = amountAUD;
    throw err;
  }
}

function recordUsage(userId, amountAUD) {
  const db = getDB();
  if (!db || !userId) return;
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO pay_daily_usage (user_id, date, total_aud, tx_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET
      total_aud = total_aud + excluded.total_aud,
      tx_count  = tx_count  + 1
  `).run(userId, today, amountAUD);
}

async function quote(adapter, { sourceAmount, sourceCurrency, destination, user }) {
  checkDailyLimit(user, sourceAmount);

  const adapterQuote = await adapter.quote({ sourceAmount, sourceCurrency, destination });
  const tier = getTier(user);
  const { commission, net, rate, feeCapped } = calcCommission(sourceAmount, user);
  const minAUD = policy.getPolicy(tier).minimum_fee_aud;

  return {
    ...adapterQuote,
    commission,
    commissionRate: rate,
    feeCapped,
    net,
    grossAUD: sourceAmount,
    tier,
    dailyLimitAUD: policy.getDailyLimitAUD(tier),
    minimumFeeAUD: minAUD,
    localizedMinimum: policy.localizedMinimum(
      minAUD,
      adapterQuote.destinationCurrency,
      adapterQuote.fxRate,
    ),
  };
}

// Back-compat constants — derived from policy, so they stay in sync.
const RATES = Object.fromEntries(Object.entries(policy.TIERS).map(([k, v]) => [k, v.rate]));
const CAPS  = Object.fromEntries(Object.entries(policy.TIERS).map(([k, v]) => [k, v.cap_aud]));

module.exports = {
  getCommissionRate,
  getCommissionCap,
  calcCommission,
  checkDailyLimit,
  recordUsage,
  quote,
  RATES,
  CAPS,
  DAILY_LIMITS_AUD: policy.DAILY_LIMITS_AUD,
};
