'use strict';

/**
 * KURO::PAY — Express Routes v2
 * Architecture: Stripe (card charge) → x402 (settlement protocol) → facilitator (VND payout)
 * No Wise calls. No FX logic. Settlement is the facilitator's responsibility.
 *
 * Mount: mountPayRoutes(app, requireAuth)
 * Routes at: /api/pay/*
 */

const express = require('express');
const crypto  = require('crypto');

const parser      = require('./vietqr_parser.cjs');
const stripe      = require('./stripe_connector.cjs');
const x402        = require('./x402_pay.cjs');
const ledger      = require('./pay_ledger.cjs');
const facilitator = require('./connectors/x402_facilitator.cjs');

// ── Init DB schema on first require ──────────────────────────────
ledger.initSchema();
stripe.runMigration();

// ── ENV check — log missing keys, never fail startup ─────────────
(function checkEnv() {
  const required = [
    'NIUM_API_KEY', 'NIUM_API_URL', 'NIUM_CLIENT_ID',
    'X402_FACILITATOR_URL', 'KURO_X402_SIGNING_KEY', 'KURO_X402_RECEIVE_ADDRESS',
    'WISE_API_TOKEN', 'WISE_PROFILE_ID', 'WISE_DESTINATION_ACCOUNT_ID',
  ];
  const defaults = {
    KURO_PAY_COMMISSION_MIN_PAYOUT_AUD:   '5',
    KURO_PAY_PAYOUT_MAX_PER_TRANSFER_AUD: '500',
    KURO_PAY_PAYOUT_ENABLED:              'false',
  };
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.warn('[KURO::PAY] Missing env vars (connectors will degrade):', missing.join(', '));
  }
  for (const [k, v] of Object.entries(defaults)) {
    if (!process.env[k]) process.env[k] = v;
  }
})();

// ── mountPayRoutes ────────────────────────────────────────────────
function mountPayRoutes(app, requireAuth) {

  // ── POST /api/pay/parse — public ────────────────────────────────
  app.post('/api/pay/parse', express.json(), (req, res) => {
    const { qr } = req.body;
    if (!qr) return res.status(400).json({ error: 'qr is required' });

    try {
      const parsed   = parser.parseEMVQR(qr);
      const routable = parser.isRoutable(parsed);
      return res.json({
        parsed,
        routable,
        requiresAmount: parsed.isStatic, // static QR needs user-supplied amount
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ── POST /api/pay/card/setup — requireAuth ──────────────────────
  // Create/retrieve Stripe customer and return SetupIntent client secret.
  app.post('/api/pay/card/setup', requireAuth, express.json(), async (req, res) => {
    const userId = req.user.userId;
    const email  = req.user.email || req.body.email;

    if (!email) return res.status(400).json({ error: 'email is required for card setup' });

    try {
      const { customerId } = await stripe.createCustomer(userId, email);
      const { clientSecret, setupIntentId } = await stripe.createSetupIntent(customerId);
      return res.json({ clientSecret, setupIntentId, customerId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/pay/card/list — requireAuth ────────────────────────
  app.get('/api/pay/card/list', requireAuth, async (req, res) => {
    const userId = req.user.userId;

    try {
      const db  = ledger.getDB();
      // Pull stripe_customer_id from users table
      const row = db?.prepare(`SELECT stripe_customer_id FROM users WHERE id=?`).get(userId);
      if (!row?.stripe_customer_id) return res.json({ cards: [] });

      const cards = await stripe.listPaymentMethods(row.stripe_customer_id);
      return res.json({ cards });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/pay/initiate — requireAuth ────────────────────────
  // Full payment flow: parse → validate → charge Stripe → x402 submit → receipt
  app.post('/api/pay/initiate', requireAuth, express.json(), async (req, res) => {
    const userId = req.user.userId;
    const { qr, amount, currency, paymentMethodId } = req.body;

    if (!qr)              return res.status(400).json({ error: 'qr is required' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });

    // 1. Parse QR
    let parsed;
    try {
      parsed = parser.parseEMVQR(qr);
    } catch (err) {
      return res.status(400).json({ error: 'QR parse failed: ' + err.message });
    }

    if (!parser.isRoutable(parsed)) {
      return res.status(422).json({
        error:      'QR is not routable — bank or account not identified',
        confidence: parsed.confidence,
        warnings:   parsed.warnings,
      });
    }

    // 2. Resolve local currency amount
    // Static QR: user must supply amount. Dynamic QR: amount is in QR.
    const localAmount = parsed.amount || (amount ? parseFloat(amount) : null);
    if (!localAmount || localAmount <= 0) {
      return res.status(400).json({
        error:          'amount is required for static QR codes',
        requiresAmount: true,
        standard:       parsed.standard,
      });
    }

    // 3. Resolve AUD amount — prefer caller-supplied fxSpot, then facilitator live rate
    let amountAUD;
    if (req.body.amountAUD) {
      amountAUD = parseFloat(req.body.amountAUD);
    } else {
      const fxSpot = parseFloat(req.body.fxSpot) || 0;
      if (fxSpot > 0) {
        amountAUD = parseFloat((localAmount / fxSpot).toFixed(4));
      } else {
        const { rate } = await facilitator.getRate(parsed.currency || 'VND');
        amountAUD = parseFloat((localAmount / (rate || 16500)).toFixed(4));
      }
    }

    if (amountAUD <= 0) return res.status(400).json({ error: 'Computed AUD amount must be > 0' });

    const { grossAUD, commission, net } = stripe.calcCommission(amountAUD);
    const paymentId  = crypto.randomUUID();
    const reference  = `KURO-${Date.now().toString(36).toUpperCase()}`;
    const db         = ledger.getDB();

    // 4. Insert pending record
    if (db) {
      ledger.insertPayment(db, {
        id:              paymentId,
        userId,
        qrRaw:           qr,
        merchantAccount: parsed.accountNumber,
        merchantName:    parsed.merchantName || '',
        bankBin:         parsed.bankBin,
        bankCode:        parsed.bankShortName,
        bankName:        parsed.bankName,
        amountAUD:       grossAUD,
        amountVND:       localAmount,
        currency:        parsed.currency || currency || 'VND',
        reference,
        network:         parsed.standard,
      });
    }

    // 5. Stripe charge
    let stripeIntent;
    try {
      const row = db?.prepare(`SELECT stripe_customer_id FROM users WHERE id=?`).get(userId);
      if (!row?.stripe_customer_id) throw new Error('No Stripe customer — call /api/pay/card/setup first');

      stripeIntent = await stripe.createPaymentIntent(
        row.stripe_customer_id,
        grossAUD,
        paymentMethodId,
        { paymentId, reference, network: parsed.standard },
        'aud'
      );

      if (db) ledger.updatePaymentStripe(db, paymentId, stripeIntent.id);
    } catch (err) {
      if (db) ledger.updatePaymentError(db, paymentId, err.message);
      return res.status(402).json({ error: 'Card charge failed: ' + err.message, paymentId });
    }

    // 6. Build x402 payment required + submit to facilitator
    const paymentRequired  = x402.buildPaymentRequired(parsed, grossAUD, localAmount, stripeIntent.id, reference);
    const settlementResult = await x402.verifyPayment(paymentRequired);
    const receipt          = x402.generateReceipt(paymentId, paymentRequired, settlementResult);

    if (db) ledger.updatePaymentSettled(db, paymentId, JSON.stringify(receipt));

    return res.status(settlementResult.success ? 200 : 202).json({
      paymentId,
      reference,
      status:    receipt.status,
      receipt,
      merchant:  {
        name:    parsed.merchantName,
        bank:    parsed.bankName,
        account: parsed.accountNumber,
      },
      amounts: {
        localCurrency:  parsed.currency || 'VND',
        localAmount,
        aud:            grossAUD,
        commission,
        net,
      },
      settled:    settlementResult.success,
      // If facilitator offline — 202 Accepted, payment is queued
      offline:    settlementResult.offline || false,
    });
  });

  // ── GET /api/pay/history — requireAuth ──────────────────────────
  app.get('/api/pay/history', requireAuth, (req, res) => {
    const userId = req.user.userId;
    const limit  = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const db     = ledger.getDB();

    if (!db) return res.json({ payments: [] });

    const payments = ledger.getUserPayments(db, userId, limit);
    return res.json({ payments });
  });

  // ── GET /api/pay/receipt/:id — requireAuth ──────────────────────
  app.get('/api/pay/receipt/:id', requireAuth, (req, res) => {
    const userId = req.user.userId;
    const db     = ledger.getDB();

    if (!db) return res.status(503).json({ error: 'Database unavailable' });

    const row = ledger.getPayment(db, req.params.id);
    if (!row)                  return res.status(404).json({ error: 'Payment not found' });
    if (row.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    const receipt = row.x402_receipt_json ? JSON.parse(row.x402_receipt_json) : null;
    return res.json({ payment: row, receipt });
  });

  // ── POST /api/pay/camera/open — requireAuth ────────────────────
  // Pre-warms a card so the ATM flow can charge in <1 RTT.
  // Stores warm_token_id + expiry on the card row.
  app.post('/api/pay/camera/open', requireAuth, express.json(), async (req, res) => {
    const userId = req.user.userId;
    const { paymentMethodId } = req.body || {};
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });

    const db = ledger.getDB();
    try {
      const row = db?.prepare(`SELECT stripe_customer_id FROM users WHERE id=?`).get(userId);
      if (!row?.stripe_customer_id) {
        return res.status(400).json({ error: 'No Stripe customer — call /api/pay/card/setup first' });
      }

      const warm = await stripe.warmPreAuth(row.stripe_customer_id, paymentMethodId);

      if (db) {
        db.prepare(`UPDATE kuro_pay_cards
                     SET warm_token_id=?, warm_token_expires_at=?
                     WHERE user_id=? AND stripe_payment_method_id=?`)
          .run(warm.paymentIntentId, warm.expiresAt * 1000, userId, paymentMethodId);
      }

      return res.json({
        warmTokenId: warm.paymentIntentId,
        expiresIn:   300,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/pay/atm/initiate — requireAuth ───────────────────
  // Single-shot ATM flow: QR (with GPS + ATM gate) → Stripe charge →
  // x402 submit → reserve + receipt. No user confirmation step; warm
  // token is the confirmation.
  app.post('/api/pay/atm/initiate', requireAuth, express.json(), async (req, res) => {
    const userId = req.user.userId;
    const { qr, amount, currency, lat, lng, paymentMethodId, warmTokenId } = req.body || {};

    if (!qr)              return res.status(400).json({ error: 'qr is required' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });
    if (!warmTokenId)     return res.status(400).json({ flag: 'warm_token_required', error: 'warmTokenId is required' });
    if (!(amount > 0))    return res.status(400).json({ error: 'amount must be > 0' });

    // 1. Parse QR with GPS
    let parsed;
    try { parsed = parser.parseQR(qr, { lat, lng }); }
    catch (err) { return res.status(400).json({ error: 'QR parse failed: ' + err.message }); }

    if (parsed.confidence < 0.85) {
      return res.status(422).json({
        flag:       parsed.flag || 'low_confidence',
        confidence: parsed.confidence,
        gpsMatch:   parsed.gpsMatch,
        warnings:   parsed.warnings,
      });
    }

    // 2. Require ATM QR
    if (parsed.qrType !== 'atm') {
      return res.status(422).json({ flag: 'not_an_atm_qr', qrType: parsed.qrType });
    }

    // 3. Verify warm token exists and not expired
    const db = ledger.getDB();
    const card = db?.prepare(`SELECT * FROM kuro_pay_cards
                              WHERE user_id=? AND stripe_payment_method_id=? AND warm_token_id=?`)
                   .get(userId, paymentMethodId, warmTokenId);
    if (!card || !card.warm_token_expires_at || card.warm_token_expires_at < Date.now()) {
      return res.status(401).json({ flag: 'warm_token_required', error: 'warm token missing or expired' });
    }

    // 4. Create ATM session
    const atmCountry = parsed.gpsCountry || parsed.countryCode || null;
    const localCurrency = parsed.currency || currency || 'VND';
    const sessionId = ledger.createATMSession(
      userId, qr, atmCountry, parseFloat(amount), localCurrency, warmTokenId
    );

    // 5. FX amount (USD)
    const fxSpot   = parseFloat(req.body.fxSpot || '0');
    const userTier = (req.user.tier || req.body.userTier || 'payg');
    if (!(fxSpot > 0)) {
      return res.status(400).json({ error: 'fxSpot is required (facilitator-quoted rate)' });
    }

    let fx;
    try { fx = stripe.calculateAmount(parseFloat(amount), localCurrency, fxSpot, userTier); }
    catch (err) {
      ledger.attachATMPayment(sessionId, null, 'rejected');
      return res.status(422).json({ flag: 'cap_exceeded', error: err.message });
    }

    // 6. Charge the card (USD)
    const paymentId = crypto.randomUUID();
    const reference = `KURO-ATM-${Date.now().toString(36).toUpperCase()}`;

    if (db) {
      ledger.insertPayment(db, {
        id:              paymentId,
        userId,
        qrRaw:           qr,
        merchantAccount: parsed.accountNumber,
        merchantName:    parsed.merchantName || 'ATM',
        bankBin:         parsed.bankBin,
        bankCode:        parsed.bankShortName,
        bankName:        parsed.bankName,
        amountAUD:       fx.amountAUD,
        amountVND:       parseFloat(amount),
        currency:        localCurrency,
        reference,
        network:         parsed.standard,
      });
      db.prepare(`UPDATE kuro_pay_payments SET warm_token_id=? WHERE id=?`).run(warmTokenId, paymentId);
    }

    let stripeIntent;
    try {
      stripeIntent = await stripe.createPaymentIntent(
        card.stripe_customer_id,
        fx.amountAUD,
        paymentMethodId,
        { paymentId, reference, type: 'atm', session: sessionId },
        'aud'
      );
      if (db) ledger.updatePaymentStripe(db, paymentId, stripeIntent.id);
    } catch (err) {
      if (db) ledger.updatePaymentError(db, paymentId, err.message);
      ledger.attachATMPayment(sessionId, paymentId, 'failed');
      return res.status(402).json({ flag: 'charge_failed', error: err.message, paymentId });
    }

    // 7. x402 submit (funding currency is AUD — matches Stripe charge)
    const paymentRequired  = x402.buildPaymentRequired(parsed, fx.amountAUD, parseFloat(amount), stripeIntent.id, reference);
    const settlementResult = await x402.submitPayment(paymentRequired);
    const receipt          = x402.generateReceipt(paymentId, paymentRequired, settlementResult);

    // 8. Update payment + session + reserve
    if (db) {
      ledger.updatePaymentSettled(db, paymentId, JSON.stringify(receipt));
      ledger.updatePaymentSettlementMeta(db, paymentId, {
        latencyMs:   settlementResult.settlementLatencyMs,
        txSignature: settlementResult.txSignature,
        network:     settlementResult.network,
      });
    }
    ledger.attachATMPayment(sessionId, paymentId, settlementResult.success ? 'settled' : 'pending');
    let reserveContribution = 0;
    try { reserveContribution = ledger.recordReserve(paymentId, fx.amountUSD); } catch (_) {}

    // 9. Display object — never expose breakdown
    return res.status(settlementResult.success ? 200 : 202).json({
      paymentId,
      sessionId,
      reference,
      status:              receipt.status,
      settled:             settlementResult.success,
      settlementLatencyMs: settlementResult.settlementLatencyMs,
      txSignature:         settlementResult.txSignature,
      display: {
        chargedAUD:    fx.amountAUD,
        chargedUSD:    fx.amountUSD,   // audit/x402 reference; not user-facing
        localAmount:   parseFloat(amount),
        localCurrency,
        displayRate:   fx.displayRate,
      },
      merchant: {
        name:    parsed.merchantName,
        bank:    parsed.bankName,
        account: parsed.accountNumber,
      },
      reserveContribution,
    });
  });

  // ── POST /api/pay/webhook/stripe — no auth, signature-verified ─
  // Raw body required for Stripe signature verification.
  const rawBody = express.raw({ type: 'application/json' });
  app.post('/api/pay/webhook/stripe', rawBody, (req, res) => {
    const stripeSDK = (() => { try { return require('stripe')(process.env.STRIPE_SECRET_KEY); } catch(_) { return null; } })();
    const secret    = process.env.STRIPE_WEBHOOK_SECRET;
    const sig       = req.headers['stripe-signature'];
    if (!stripeSDK || !secret || !sig) {
      return res.status(400).json({ error: 'webhook not configured' });
    }

    let event;
    try { event = stripeSDK.webhooks.constructEvent(req.body, sig, secret); }
    catch (err) { return res.status(400).json({ error: `signature verification failed: ${err.message}` }); }

    const db = ledger.getDB();

    // Look up internal payment by the Stripe PaymentIntent id
    function findPaymentByIntent(intentId) {
      if (!db || !intentId) return null;
      return db.prepare(`SELECT id, user_id FROM kuro_pay_payments WHERE stripe_payment_intent_id=?`).get(intentId);
    }

    function securityLog(kind, meta) {
      try { require('../../layers/auth/security.cjs').securityLog?.(kind, meta); }
      catch (_) { console.warn('[KURO::PAY webhook]', kind, meta); }
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi  = event.data.object;
          const row = findPaymentByIntent(pi.id);
          if (db && row) db.prepare(`UPDATE kuro_pay_payments SET status='settled', settled_at=CURRENT_TIMESTAMP WHERE id=?`).run(row.id);
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi  = event.data.object;
          const row = findPaymentByIntent(pi.id);
          if (db && row) db.prepare(`UPDATE kuro_pay_payments SET status='failed', error=? WHERE id=?`)
                          .run(pi.last_payment_error?.message || 'payment_failed', row.id);
          break;
        }
        case 'charge.dispute.created': {
          const dispute = event.data.object;
          const row     = findPaymentByIntent(dispute.payment_intent);
          if (db && row) {
            db.prepare(`UPDATE kuro_pay_payments SET status='disputed' WHERE id=?`).run(row.id);
            try {
              const pmt = db.prepare(`SELECT amount_aud FROM kuro_pay_payments WHERE id=?`).get(row.id);
              if (pmt?.amount_aud) ledger.deductReserveForDispute(row.id, pmt.amount_aud);
            } catch (_) {}
          }
          securityLog('pay.dispute', { paymentId: row?.id, amount: dispute.amount, reason: dispute.reason });
          break;
        }
      }
    } catch (err) {
      console.error('[KURO::PAY webhook] handler error:', err.message);
    }

    return res.json({ received: true, type: event.type });
  });

  // ── GET /api/pay/fx-rate — public ─────────────────────────────
  // Returns live or fallback rate for ?currency=VND (etc).
  // Source field: 'facilitator' | 'env' | 'fallback'
  app.get('/api/pay/fx-rate', async (req, res) => {
    const currency = (req.query.currency || 'VND').toUpperCase();
    try {
      const result = await facilitator.getRate(currency);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/pay/detect — public ──────────────────────────────
  // Runs all rail adapters' detect() in parallel and returns the best match.
  app.post('/api/pay/detect', express.json(), async (req, res) => {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'input is required' });

    try {
      // Lazy-require so rails register themselves on first detect call
      require('./rails/vietqr.cjs');
      require('./rails/promptpay.cjs');
      require('./rails/qris.cjs');
      require('./rails/qrph.cjs');
      require('./rails/duitnow.cjs');

      const router = require('./core/rail_router.cjs');
      const result = await router.detect(input);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/pay/status/:id — requireAuth ───────────────────────
  app.get('/api/pay/status/:id', requireAuth, async (req, res) => {
    const userId = req.user.userId;
    const db     = ledger.getDB();
    if (!db) return res.status(503).json({ error: 'Database unavailable' });

    const row = ledger.getPayment(db, req.params.id);
    if (!row)                  return res.status(404).json({ error: 'Payment not found' });
    if (row.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    const receipt = row.x402_receipt_json ? JSON.parse(row.x402_receipt_json) : null;
    return res.json({ status: row.status, settledAt: row.settled_at, receipt, paymentId: row.id });
  });

  // ── POST /api/pay/admin/sweep — requireAuth (admin) ────────────
  // Manual trigger for commission payout logic. Respects MIN/MAX/ENABLED flags.
  app.post('/api/pay/admin/sweep', requireAuth, async (req, res) => {
    try {
      const { runPayout } = require('./scheduler/commission_payout_hourly.cjs');
      await runPayout();
      return res.json({ swept: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  console.log('[KURO::PAY] v2 routes mounted at /api/pay/{parse,fx-rate,detect,card/*,initiate,status/*,history,receipt/*,camera/open,atm/initiate,webhook/stripe,admin/sweep}');
}

module.exports = { mountPayRoutes };
