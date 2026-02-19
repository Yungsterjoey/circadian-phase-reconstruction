/**
 * KURO::STRIPE v1.0
 * Subscription management via Stripe Checkout + Webhooks
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY=sk_xxx
 *   STRIPE_WEBHOOK_SECRET=whsec_xxx
 *   STRIPE_PRO_PRICE=price_xxx
 *   STRIPE_SOVEREIGN_PRICE=price_xxx
 *
 * Mount:
 *   app.use('/api/stripe', stripeRoutes);
 *   // CRITICAL: webhook route needs raw body — mounted separately
 *   app.post('/api/stripe/webhook', express.raw({type:'application/json'}), stripeWebhook);
 */

const express = require('express');
const { db, stmts } = require('../auth/db.cjs');

let stripe;
try {
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
} catch (e) {
  console.warn('[STRIPE] stripe package not installed — payments disabled');
}

const PRICES = {
  pro: process.env.STRIPE_PRO_PRICE || '',
  sovereign: process.env.STRIPE_SOVEREIGN_PRICE || ''
};

const BASE_URL = process.env.KURO_URL || 'https://kuroglass.net';

// ═══════════════════════════════════════════════════════
// STRIPE ROUTES (JSON-parsed body — normal express.json)
// ═══════════════════════════════════════════════════════

function createStripeRoutes(authMiddleware) {
  const router = express.Router();

  // ─── CREATE CHECKOUT SESSION ─────────────────────────
  router.post('/checkout', authMiddleware.required, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

    const { tier } = req.body;
    if (!tier || !PRICES[tier]) {
      return res.status(400).json({ error: 'Invalid tier. Choose pro or sovereign.' });
    }

    if (!PRICES[tier]) {
      return res.status(503).json({ error: `Price not configured for ${tier}` });
    }

    const userId = req.user.userId;
    const user = stmts.getUserById.get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    try {
      // Check for existing Stripe customer
      const existingSub = stmts.getActiveSubscription.get(userId);
      let customerId = existingSub?.stripe_customer_id;

      if (!customerId) {
        // Create Stripe customer
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { kuro_user_id: userId }
        });
        customerId = customer.id;
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: PRICES[tier], quantity: 1 }],
        success_url: `${BASE_URL}/desktop?upgraded=true&tier=${tier}`,
        cancel_url: `${BASE_URL}/desktop?upgrade_canceled=true`,
        metadata: { user_id: userId, tier },
        subscription_data: {
          metadata: { user_id: userId, tier }
        }
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (e) {
      console.error('[STRIPE] Checkout error:', e.message);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  // ─── CUSTOMER PORTAL ─────────────────────────────────
  router.post('/portal', authMiddleware.required, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

    const sub = stmts.getActiveSubscription.get(req.user.userId);
    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${BASE_URL}/desktop`
      });
      res.json({ url: portal.url });
    } catch (e) {
      console.error('[STRIPE] Portal error:', e.message);
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  });

  // ─── SUBSCRIPTION STATUS ─────────────────────────────
  router.get('/status', authMiddleware.required, (req, res) => {
    const sub = stmts.getActiveSubscription.get(req.user.userId);
    const user = stmts.getUserById.get(req.user.userId);
    res.json({
      tier: user?.tier || 'free',
      subscription: sub ? {
        id: sub.id,
        status: sub.status,
        tier: sub.tier,
        periodEnd: sub.current_period_end,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end
      } : null
    });
  });

  return router;
}

// ═══════════════════════════════════════════════════════
// WEBHOOK HANDLER (raw body — GPT-04 idempotency)
// ═══════════════════════════════════════════════════════

async function stripeWebhookHandler(req, res) {
  if (!stripe) return res.status(503).send('Payments not configured');

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[STRIPE] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (e) {
    console.error('[STRIPE] Webhook signature failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  // Idempotency check (GPT-04)
  const existing = stmts.checkStripeEvent.get(event.id);
  if (existing) {
    return res.status(200).send('Already processed');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log(`[STRIPE] Unhandled event: ${event.type}`);
    }

    // Record processed event
    stmts.recordStripeEvent.run(event.id, event.type);
  } catch (e) {
    console.error(`[STRIPE] Webhook handler error (${event.type}):`, e.message);
    // Return 200 anyway to prevent Stripe retries for handler errors
    // (vs 400 for signature failures which should retry)
  }

  res.status(200).send('OK');
}

// ═══════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════

async function handleCheckoutComplete(session) {
  const userId = session.metadata?.user_id;
  const tier = session.metadata?.tier;
  if (!userId || !tier) {
    console.error('[STRIPE] Checkout missing metadata:', session.id);
    return;
  }

  const subscriptionId = session.subscription;
  const customerId = session.customer;

  // Fetch subscription details from Stripe
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (e) {
    console.error('[STRIPE] Failed to retrieve subscription:', e.message);
    return;
  }

  // Upsert subscription record
  stmts.upsertSubscription.run(
    subscriptionId, userId, customerId,
    sub.items?.data?.[0]?.price?.id || '',
    sub.status, tier,
    new Date(sub.current_period_start * 1000).toISOString(),
    new Date(sub.current_period_end * 1000).toISOString()
  );

  // Upgrade user tier
  stmts.updateTier.run(tier, userId);
  console.log(`[STRIPE] User ${userId} upgraded to ${tier}`);
}

async function handleSubscriptionUpdate(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;

  const tier = subscription.metadata?.tier || deriveTier(subscription);

  stmts.upsertSubscription.run(
    subscription.id, userId,
    subscription.customer,
    subscription.items?.data?.[0]?.price?.id || '',
    subscription.status, tier,
    new Date(subscription.current_period_start * 1000).toISOString(),
    new Date(subscription.current_period_end * 1000).toISOString()
  );

  // Sync user tier based on subscription status
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    stmts.updateTier.run(tier, userId);
  } else if (subscription.status === 'past_due') {
    // Keep tier but flag — give grace period
    console.log(`[STRIPE] User ${userId} subscription past_due`);
  } else {
    stmts.updateTier.run('free', userId);
  }
}

async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;

  stmts.upsertSubscription.run(
    subscription.id, userId,
    subscription.customer,
    subscription.items?.data?.[0]?.price?.id || '',
    'canceled', subscription.metadata?.tier || 'free',
    new Date(subscription.current_period_start * 1000).toISOString(),
    new Date(subscription.current_period_end * 1000).toISOString()
  );

  stmts.updateTier.run('free', userId);
  console.log(`[STRIPE] User ${userId} downgraded to free (subscription deleted)`);
}

async function handleInvoicePaid(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;
  // Subscription update event handles the rest
  console.log(`[STRIPE] Invoice paid for subscription ${subId}`);
}

async function handlePaymentFailed(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;
  console.log(`[STRIPE] Payment failed for subscription ${subId}`);
  // Could send notification email here
}

/**
 * Derive tier from price ID if metadata is missing
 */
function deriveTier(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId === PRICES.sovereign) return 'sovereign';
  if (priceId === PRICES.pro) return 'pro';
  return 'pro'; // Default paid tier
}

module.exports = { createStripeRoutes, stripeWebhookHandler };
