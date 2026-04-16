'use strict';

/**
 * KURO::PAY — Stripe Connector
 * Card storage and charging only. No Wise. No FX. No settlement.
 * Stripe = funding rail. x402 + facilitator = settlement rail.
 */

const crypto = require('crypto');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return require('stripe')(key);
}

function getDB() {
  try { return require('../../layers/auth/db.cjs').db; }
  catch (_) { return null; }
}

// ── DB migration — additive ──────────────────────────────────────
function runMigration() {
  const db = getDB();
  if (!db) return;
  // Add stripe_customer_id to users if not present
  try { db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`); }
  catch (_) { /* column already exists */ }
}

// ── createCustomer ────────────────────────────────────────────────
// Create or retrieve a Stripe customer for a KURO user.
async function createCustomer(userId, email) {
  const stripe = getStripe();
  const db     = getDB();

  const row = db?.prepare(`SELECT stripe_customer_id FROM users WHERE id=?`).get(userId);
  if (row?.stripe_customer_id) {
    return { customerId: row.stripe_customer_id, existing: true };
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { kuroUserId: userId },
  });

  db?.prepare(`UPDATE users SET stripe_customer_id=? WHERE id=?`).run(customer.id, userId);
  return { customerId: customer.id, existing: false };
}

// ── createSetupIntent ─────────────────────────────────────────────
// Returns client_secret for frontend Stripe.js card collection.
async function createSetupIntent(customerId) {
  const stripe = getStripe();
  const si = await stripe.setupIntents.create({
    customer:             customerId,
    payment_method_types: ['card'],
  });
  return { clientSecret: si.client_secret, setupIntentId: si.id };
}

// ── listPaymentMethods ────────────────────────────────────────────
async function listPaymentMethods(customerId) {
  const stripe = getStripe();
  const pms    = await stripe.customers.listPaymentMethods(customerId, { type: 'card' });
  return pms.data.map(pm => ({
    id:       pm.id,
    brand:    pm.card.brand,
    last4:    pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear:  pm.card.exp_year,
    country:  pm.card.country,
  }));
}

// ── createPaymentIntent ───────────────────────────────────────────
// Charge the user's card. Defaults to AUD (matches the live Stripe
// account's settlement currency). Caller supplies amount in major units
// of the chosen currency; cents conversion happens here.
async function createPaymentIntent(customerId, amount, paymentMethodId, metadata = {}, currency = 'aud') {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount:         Math.round(amount * 100), // cents (zero-decimal currencies aren't supported by this rail yet)
    currency:       String(currency).toLowerCase(),
    customer:       customerId,
    payment_method: paymentMethodId,
    confirm:        true,
    return_url:     (process.env.KURO_BASE_URL || 'https://kuroglass.net') + '/pay/return',
    metadata,
  });
  return intent;
}

// ── confirmPaymentIntent ──────────────────────────────────────────
async function confirmPaymentIntent(paymentIntentId) {
  const stripe = getStripe();
  return stripe.paymentIntents.confirm(paymentIntentId);
}

// ── calcCommission ────────────────────────────────────────────────
function calcCommission(grossAUD) {
  const rate       = parseFloat(process.env.KURO_PAY_COMMISSION || '0.012');
  const commission = parseFloat((grossAUD * rate).toFixed(4));
  const net        = parseFloat((grossAUD - commission).toFixed(4));
  return { grossAUD, commission, net, rate };
}

// ── warmPreAuth ───────────────────────────────────────────────────
// Pre-warms a card with a $0 manual-capture intent so the actual ATM
// initiate flow can charge in <1 RTT. The warm window is 5 minutes.
async function warmPreAuth(customerId, paymentMethodId) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount:         0,
    currency:       'aud',
    customer:       customerId,
    payment_method: paymentMethodId,
    confirm:        false,
    capture_method: 'manual',
    metadata:       { type: 'warm_preauth', kuro: 'true' },
  });
  return {
    paymentIntentId: intent.id,
    clientSecret:    intent.client_secret,
    expiresAt:       Math.floor(Date.now() / 1000) + 300,
  };
}

// ── calculateAmount ───────────────────────────────────────────────
// FX formula:
//   amountUSD = (localAmount / fxSpot) * (1 + σ + R_stripe + R_kuro) + F_fixed
// Returns USD amount, cents amount for Stripe, breakdown (internal-only),
// and a human-readable displayRate. Throws if userTier cap is exceeded.
function calculateAmount(localAmount, localCurrency, fxSpot, userTier) {
  if (!(localAmount > 0)) throw new Error('localAmount must be > 0');
  if (!(fxSpot > 0))      throw new Error('fxSpot must be > 0');

  const sigma     = parseFloat(process.env.KURO_PAY_VOLATILITY_BUFFER || '0.0075');
  const R_stripe  = 0.014;
  const R_kuro    = parseFloat(process.env.KURO_PAY_R_KURO || '0.005');
  const F_fixed   = 0.30;

  const base              = localAmount / fxSpot;
  const volatilityBuffer  = base * sigma;
  const stripeFee         = base * R_stripe;
  const kuroFee           = base * R_kuro;
  const amountUSDraw      = base * (1 + sigma + R_stripe + R_kuro) + F_fixed;
  const amountUSD         = parseFloat(amountUSDraw.toFixed(2));

  const tier = (userTier || 'payg').toLowerCase();
  const capPAYG  = parseFloat(process.env.KURO_PAY_MAX_PAYG  || '200');
  const capNomad = parseFloat(process.env.KURO_PAY_MAX_NOMAD || '500');
  const cap = tier === 'nomad' ? capNomad : capPAYG;
  if (amountUSD > cap) {
    throw new Error(`Amount ${amountUSD} USD exceeds ${tier.toUpperCase()} cap of ${cap} USD`);
  }

  // ── USD → AUD (Stripe account settles in AUD) ──
  // AUD_USD_SPOT is "USD per 1 AUD" (forex convention). e.g. 0.64 → 1 AUD = 0.64 USD.
  const audUsdSpot = parseFloat(process.env.AUD_USD_SPOT || '0.64');
  if (!(audUsdSpot > 0)) throw new Error('AUD_USD_SPOT must be > 0');
  const amountAUD     = parseFloat((amountUSD / audUsdSpot).toFixed(2));
  const amountCharged = Math.round(amountAUD * 100); // cents AUD for Stripe

  const perUnitAUD = (1 / fxSpot) / audUsdSpot;
  const displayRate = `1 ${localCurrency} = ${perUnitAUD.toPrecision(3)} AUD`;

  return {
    amountUSD,                 // formula intermediary (used by reserve + x402 audit)
    amountAUD,                 // canonical Stripe charge amount
    amountCharged,             // cents AUD
    currency:    'aud',        // explicit — caller passes through to createPaymentIntent
    fxRate:      fxSpot,       // local → USD
    audUsdSpot,                // USD per AUD
    breakdown: {
      base:             parseFloat(base.toFixed(4)),
      volatilityBuffer: parseFloat(volatilityBuffer.toFixed(4)),
      stripeFee:        parseFloat(stripeFee.toFixed(4)),
      kuroFee:          parseFloat(kuroFee.toFixed(4)),
      fixedFee:         F_fixed,
    },
    displayRate,
  };
}

module.exports = {
  runMigration,
  createCustomer,
  createSetupIntent,
  listPaymentMethods,
  createPaymentIntent,
  confirmPaymentIntent,
  calcCommission,
  warmPreAuth,
  calculateAmount,
};
