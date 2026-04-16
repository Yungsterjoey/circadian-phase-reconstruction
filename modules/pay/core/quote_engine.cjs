'use strict';

// Single source of truth for commission rates, daily limits, and fee quotes.
// Replaces the flat KURO_PAY_COMMISSION rate used by stripe_connector.calcCommission
// for all new rail flows. The ATM flow (stripe_connector.calculateAmount) is not
// touched here — it has its own pricing model.

const RATES = { free: 0.015, pro: 0.010, sov: 0.005 };
const CAPS  = { free: 5.00,  pro: 5.00,  sov: null  };  // AUD; null = no cap
const DAILY_LIMITS_AUD = { free: 500, pro: 2000, sov: 10000 };

function getDB() {
  try { return require('../../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

function getTier(user) {
  return (user?.tier || 'free').toLowerCase();
}

function getCommissionRate(user) {
  return RATES[getTier(user)] ?? RATES.free;
}

function getCommissionCap(user) {
  return CAPS[getTier(user)] ?? CAPS.free;
}

// Compute commission for a gross AUD amount, respecting tier cap.
function calcCommission(grossAUD, user) {
  const rate   = getCommissionRate(user);
  const cap    = getCommissionCap(user);
  let   comm   = parseFloat((grossAUD * rate).toFixed(4));
  const capped = cap !== null && comm > cap;
  if (capped) comm = cap;
  const net = parseFloat((grossAUD - comm).toFixed(4));
  return { grossAUD, commission: comm, net, rate, feeCapped: capped };
}

// Throw DAILY_LIMIT_EXCEEDED if adding amountAUD would breach today's limit.
function checkDailyLimit(user, amountAUD) {
  const db    = getDB();
  const tier  = getTier(user);
  const limit = DAILY_LIMITS_AUD[tier] ?? DAILY_LIMITS_AUD.free;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let usedAUD = 0;
  if (db && user?.id) {
    const row = db.prepare(
      `SELECT total_aud FROM pay_daily_usage WHERE user_id=? AND date=?`
    ).get(user.id, today);
    usedAUD = row?.total_aud ?? 0;
  }

  if (usedAUD + amountAUD > limit) {
    const err = new Error('DAILY_LIMIT_EXCEEDED');
    err.code        = 'DAILY_LIMIT_EXCEEDED';
    err.limitAUD    = limit;
    err.usedAUD     = usedAUD;
    err.requestedAUD = amountAUD;
    throw err;
  }
}

// Record usage after a successful payment.
function recordUsage(userId, amountAUD) {
  const db    = getDB();
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

// Full quote: adapter.quote() + tier commission + daily limit check.
async function quote(adapter, { sourceAmount, sourceCurrency, destination, user }) {
  checkDailyLimit(user, sourceAmount);

  const adapterQuote = await adapter.quote({ sourceAmount, sourceCurrency, destination });
  const { commission, net, rate, feeCapped } = calcCommission(sourceAmount, user);

  return {
    ...adapterQuote,
    commission,
    commissionRate: rate,
    feeCapped,
    net,
    grossAUD: sourceAmount,
    dailyLimitAUD: DAILY_LIMITS_AUD[getTier(user)] ?? DAILY_LIMITS_AUD.free,
  };
}

module.exports = {
  getCommissionRate,
  getCommissionCap,
  calcCommission,
  checkDailyLimit,
  recordUsage,
  quote,
  RATES,
  CAPS,
  DAILY_LIMITS_AUD,
};
