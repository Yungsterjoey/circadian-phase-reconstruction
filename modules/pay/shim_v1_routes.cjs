'use strict';

/**
 * KURO::PAY — v1 API shim.
 *
 * Thin aliases from the plan's v1 contract
 *   /api/pay/x402/{quote, create, confirm}
 * onto the live v2 routes in pay_routes.cjs
 *   /api/pay/{parse, initiate, receipt}.
 *
 * Why a shim, not a rewrite:
 *   v2 is the tested, mounted stack (atm flow, webhooks, reserve ledger).
 *   The /pay frontend expects v1 URLs. A shim keeps v2 internals untouched
 *   and gives the frontend the contract it was designed against.
 *
 * Invariants we rely on (verified against pay_routes.cjs and pay_ledger.cjs):
 *   1. v2 /initiate is SYNCHRONOUS. Stripe charge, x402 submit, and
 *      ledger.updatePaymentSettled all complete before the HTTP response
 *      is returned — so by the time /create resolves, the ledger row
 *      already holds its final state. /confirm is a plain ledger read,
 *      not a poll.
 *   2. ledger.updatePaymentSettled sets row.status='settled' even when
 *      the facilitator was offline (row carries a receipt whose
 *      settlement.success=false in that case). /confirm must read BOTH
 *      the row status AND the receipt's settlement.success to decide
 *      `confirmed`.
 *
 * What this file does NOT do:
 *   - Does not write to the ledger directly.
 *   - Does not compute commission. v2's stripe.calcCommission is the
 *     single source of truth.
 *   - Does not re-implement auth. /create and /confirm use the same
 *     requireAuth passed to mountPayRoutes; /quote is public (matches
 *     v2 /parse).
 */

const express = require('express');
const http    = require('http');

const parser = require('./vietqr_parser.cjs');
const stripe = require('./stripe_connector.cjs');
const ledger = require('./pay_ledger.cjs');

/* Indicative local-per-AUD rates for /quote preview only. Mirrors the
 * 16500 VND/AUD fallback in pay_routes.cjs /initiate, so a quote and a
 * subsequent create agree when no facilitator fxSpot is supplied. In
 * production the facilitator quotes the real rate and v2 /initiate uses
 * that; these numbers are indicative ONLY.
 */
const INDICATIVE_LOCAL_PER_AUD = {
  VND: 16500,
  THB:    24,
  IDR: 10500,
  PHP:    38,
  MYR:   3.1,
  USD:  0.66,
  AUD:   1.0,
};

/* In-process HTTP loopback. Posts back to our own server so v2's
 * /initiate pipeline — auth, Stripe, x402, ledger — runs untouched.
 * Uses node's http module to avoid adding deps (axios is already a
 * transitive dep but we don't need it here).
 */
function loopback(origReq, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    // Match server.cjs: KURO_PORT > PORT > 3100
    const port = parseInt(process.env.KURO_PORT || process.env.PORT || '3100', 10);
    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    // Forward credentials so v2's requireAuth re-validates the same user.
    if (origReq.headers.cookie)        headers.cookie        = origReq.headers.cookie;
    if (origReq.headers.authorization) headers.authorization = origReq.headers.authorization;

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers, timeout: 20000 },
      (resp) => {
        let buf = '';
        resp.on('data', (chunk) => { buf += chunk; });
        resp.on('end', () => {
          let parsed;
          try { parsed = buf ? JSON.parse(buf) : {}; }
          catch (_) { parsed = { raw: buf }; }
          resolve({ status: resp.statusCode || 502, body: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('loopback timeout')));
    req.on('error',   reject);
    req.write(data);
    req.end();
  });
}

function mountShimRoutes(app, requireAuth) {

  /* ── POST /api/pay/x402/quote ─────────────────────────────────
   * Public preview — no auth, no DB writes. Parses the QR, applies v2's
   * commission formula, returns an indicative AUD amount.
   *
   * Request:  { qrString, amountLocal? }
   * Response: { amountAud, amountLocal, currency, commission, rate,
   *             indicative, merchant, routable, confidence, warnings }
   */
  app.post('/api/pay/x402/quote', express.json(), (req, res) => {
    const { qrString, amountLocal } = req.body || {};
    if (!qrString) return res.status(400).json({ error: 'qrString is required' });

    let parsed;
    try { parsed = parser.parseEMVQR(qrString); }
    catch (err) { return res.status(400).json({ error: 'QR parse failed: ' + err.message }); }

    const currency = parsed.currency || 'VND';
    const supplied = amountLocal != null ? parseFloat(amountLocal) : null;
    const localAmount = (Number.isFinite(supplied) && supplied > 0) ? supplied : parsed.amount;

    if (!localAmount || localAmount <= 0) {
      return res.status(400).json({
        error:          'amountLocal is required for static QR codes',
        requiresAmount: true,
        parsed: {
          standard: parsed.standard,
          merchant: parsed.merchantName,
          bank:     parsed.bankName,
          currency,
        },
      });
    }

    const localPerAud = INDICATIVE_LOCAL_PER_AUD[currency] || INDICATIVE_LOCAL_PER_AUD.VND;
    const amountAud   = parseFloat((localAmount / localPerAud).toFixed(4));

    // v2's calcCommission is the single source of truth.
    const { commission, net, rate: commissionRate } = stripe.calcCommission(amountAud);

    return res.json({
      amountAud,
      amountLocal:    localAmount,
      currency,
      commission,
      commissionRate,
      net,
      total:          amountAud,     // commission is INCLUDED in gross
      rate:           localPerAud,   // local-currency units per 1 AUD
      indicative:     true,
      merchant: {
        name:    parsed.merchantName,
        bank:    parsed.bankName,
        bankBin: parsed.bankBin,
        account: parsed.accountNumber,
      },
      routable:   parser.isRoutable(parsed),
      confidence: parsed.confidence,
      warnings:   parsed.warnings,
    });
  });

  /* ── POST /api/pay/x402/create ────────────────────────────────
   * HTTP-loopback wrapper over v2 /initiate. v2 runs the full
   * create+charge+settle cycle synchronously; we normalise the envelope
   * to the v1 shape the frontend expects.
   *
   * Request:  { qrString, amountLocal, paymentMethodId }
   * Response: { paymentId, status, amountAud, amountLocal, currency,
   *             commission, reference, merchant, settled, offline }
   *
   * Status codes propagated from v2:
   *   200 → settled;        202 → pending (facilitator offline);
   *   400 → bad input;      402 → card charge failed;
   *   422 → QR not routable
   */
  app.post('/api/pay/x402/create', requireAuth, express.json(), async (req, res) => {
    const { qrString, amountLocal, paymentMethodId } = req.body || {};
    if (!qrString)        return res.status(400).json({ error: 'qrString is required' });
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });

    let result;
    try {
      result = await loopback(req, '/api/pay/initiate', {
        qr:              qrString,
        amount:          amountLocal,
        paymentMethodId,
      });
    } catch (err) {
      return res.status(502).json({ error: 'v2 initiate loopback failed: ' + err.message });
    }

    if (result.status >= 400) {
      return res.status(result.status).json(result.body);
    }

    const b       = result.body || {};
    const amounts = b.amounts  || {};

    // Status: 'settled' only when v2 says settled AND facilitator succeeded.
    // v2 sets body.settled based on settlementResult.success, so trust it.
    const status = b.settled ? 'settled'
                  : b.offline ? 'pending'
                  : (b.status || 'pending');

    return res.json({
      paymentId:   b.paymentId,
      status,
      amountAud:   amounts.aud,
      amountLocal: amounts.localAmount,
      currency:    amounts.localCurrency,
      commission:  amounts.commission,
      net:         amounts.net,
      reference:   b.reference,
      merchant:    b.merchant,
      settled:     !!b.settled,
      offline:     !!b.offline,
    });
  });

  /* ── POST /api/pay/x402/confirm ───────────────────────────────
   * Plain ledger read — /initiate is synchronous, so by the time the
   * frontend calls /confirm the row is already in its final state.
   * No polling.
   *
   * Because v2's updatePaymentSettled sets row.status='settled' even
   * when the facilitator is offline, we cross-check the receipt's
   * settlement.success flag before reporting `confirmed: true`.
   *
   * Request:  { paymentId }
   * Responses:
   *   settled:   { confirmed: true,  status: 'settled', paymentId, receipt }
   *   pending:   { confirmed: false, status: 'pending', paymentId, message }
   *   failed:    { confirmed: false, status: 'failed',  paymentId, message }
   */
  app.post('/api/pay/x402/confirm', requireAuth, express.json(), (req, res) => {
    const { paymentId } = req.body || {};
    if (!paymentId) return res.status(400).json({ error: 'paymentId is required' });

    const db = ledger.getDB();
    if (!db) return res.status(503).json({ error: 'DB unavailable' });

    const row = ledger.getPayment(db, paymentId);
    if (!row)                             return res.status(404).json({ error: 'Payment not found' });
    if (row.user_id !== req.user?.userId) return res.status(403).json({ error: 'Forbidden' });

    let fullReceipt = null;
    if (row.x402_receipt_json) {
      try { fullReceipt = JSON.parse(row.x402_receipt_json); }
      catch (_) { /* corrupt JSON — treat as no receipt */ }
    }

    // Truly settled = row says settled AND receipt says facilitator succeeded.
    const facilitatorSettled = fullReceipt?.settlement?.success === true;
    const trulySettled       = row.status === 'settled' && facilitatorSettled;

    if (trulySettled) {
      return res.json({
        confirmed: true,
        status:    'settled',
        paymentId,
        receipt: {
          paymentId,
          merchant:     row.merchant_name,
          bank:         row.bank_name,
          amountVnd:    row.amount_vnd,       // v1 field name
          amountLocal:  row.amount_vnd,       // generic alias
          currency:     row.currency,
          amountAud:    row.amount_aud,
          commission:   fullReceipt?.source?.commission  ?? null,
          proof:        fullReceipt?.txSignature
                        || fullReceipt?.receiptId
                        || null,
          settledAt:    row.settled_at,
          reference:    row.reference,
          full:         fullReceipt,
        },
      });
    }

    // Errored (Stripe decline, facilitator hard-fail, etc.)
    if (row.status === 'error' || row.status === 'verify_failed') {
      return res.json({
        confirmed: false,
        status:    'failed',
        paymentId,
        message:   row.error || 'Payment failed',
      });
    }

    // DB says settled but facilitator didn't confirm — charged, queued.
    if (row.status === 'settled' && !facilitatorSettled) {
      return res.json({
        confirmed: false,
        status:    'pending',
        paymentId,
        message:   fullReceipt?.settlement?.error
                   ? `Card charged, settlement queued (${fullReceipt.settlement.error})`
                   : 'Card charged, settlement queued (facilitator offline)',
        offline:   !!fullReceipt?.settlement?.offline,
      });
    }

    // Any other in-flight state
    return res.json({
      confirmed:      false,
      status:         'pending',
      paymentId,
      message:        row.status === 'stripe_charged'
                      ? 'Card charged — awaiting facilitator settlement'
                      : 'Still settling',
      internalStatus: row.status,
    });
  });

  console.log('[KURO::PAY] v1 shim mounted at /api/pay/x402/{quote,create,confirm}');
}

module.exports = { mountShimRoutes };
