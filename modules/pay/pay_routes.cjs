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

const parser   = require('./vietqr_parser.cjs');
const stripe   = require('./stripe_connector.cjs');
const x402     = require('./x402_pay.cjs');
const ledger   = require('./pay_ledger.cjs');

// ── Init DB schema on first require ──────────────────────────────
ledger.initSchema();
stripe.runMigration();

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

    // 3. Resolve AUD amount
    // For now: caller provides amount in AUD via req.body.amountAUD,
    // or we treat the local amount as VND and use 1 AUD ≈ 16500 VND (indicative).
    // In production the facilitator quotes the FX rate.
    const amountAUD = req.body.amountAUD
      ? parseFloat(req.body.amountAUD)
      : parseFloat((localAmount / 16500).toFixed(4));

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
        { paymentId, reference, network: parsed.standard }
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

  console.log('[KURO::PAY] v2 routes mounted at /api/pay/{parse,card/*,initiate,history,receipt/*}');
}

module.exports = { mountPayRoutes };
