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
// Charge the user's card in AUD. Returns Stripe PaymentIntent.
async function createPaymentIntent(customerId, amountAUD, paymentMethodId, metadata = {}) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount:         Math.round(amountAUD * 100), // cents
    currency:       'aud',
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

module.exports = {
  runMigration,
  createCustomer,
  createSetupIntent,
  listPaymentMethods,
  createPaymentIntent,
  confirmPaymentIntent,
  calcCommission,
};
