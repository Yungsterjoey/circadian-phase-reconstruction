'use strict';

/**
 * KURO::PAY — x402 Payment Protocol
 *
 * Implements x402 v2 payment required / submit / receipt cycle.
 * The facilitator (x402.org or custom) receives the payment payload,
 * converts AUD → VND, and settles to the merchant bank account.
 *
 * No Wise API calls here. Settlement is the facilitator's job.
 * Stripe = funding only. x402 = settlement protocol.
 */

const crypto = require('crypto');
const axios  = require('axios');
const { x402Version } = require('@x402/core');

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org';
const COMMISSION_RATE = parseFloat(process.env.KURO_PAY_COMMISSION || '0.012');
const X402_VERSION    = 2;

// ── buildPaymentRequired ──────────────────────────────────────────
/**
 * Construct an x402 PaymentRequired object describing what the
 * facilitator must do: receive AUD from Stripe, settle VND to
 * the merchant's bank account.
 *
 * @param {object} parsedQR     — output of parseEMVQR()
 * @param {number} amountAUD    — gross AUD charge amount
 * @param {number} amountVND    — local currency amount
 * @param {string} stripeIntentId — Stripe PaymentIntent ID (proof of funding)
 * @param {string} ref          — unique payment reference
 */
function buildPaymentRequired(parsedQR, amountAUD, amountVND, stripeIntentId, ref) {
  const commission = parseFloat((amountAUD * COMMISSION_RATE).toFixed(4));
  const netAUD     = parseFloat((amountAUD - commission).toFixed(4));

  return {
    version:       X402_VERSION,
    x402Version:   x402Version,
    scheme:        'exact',
    network:       parsedQR.standard || 'vietqr',
    facilitatorUrl: FACILITATOR_URL,
    description:   `KURO::PAY — ${parsedQR.bankName || parsedQR.bankBin} ${parsedQR.accountNumber}`,

    // What to charge (funded via Stripe)
    source: {
      type:              'stripe',
      currency:          'AUD',
      grossAmount:       amountAUD,
      netAmount:         netAUD,
      commission:        commission,
      commissionRate:    COMMISSION_RATE,
      stripeIntentId,
    },

    // Where to pay out (merchant's bank account from QR)
    payTo: {
      type:          'bank_account',
      currency:      parsedQR.currency || 'VND',
      amount:        amountVND,
      merchantName:  parsedQR.merchantName || '',
      accountNumber: parsedQR.accountNumber,
      bankBin:       parsedQR.bankBin,
      bankName:      parsedQR.bankName,
      bankShortName: parsedQR.bankShortName,
      bankSwift:     parsedQR.bankSwift,
      country:       parsedQR.countryCode || 'VN',
      standard:      parsedQR.standard,
    },

    reference:  ref,
    timestamp:  Math.floor(Date.now() / 1000),
  };
}

// ── verifyPayment ─────────────────────────────────────────────────
/**
 * Submit the payment payload to the x402 facilitator.
 * Returns the settlement confirmation.
 *
 * @param {object} paymentRequired — from buildPaymentRequired()
 * @returns {object} settlement response
 */
async function verifyPayment(paymentRequired) {
  const startTime = Date.now();
  try {
    const resp = await axios.post(
      `${FACILITATOR_URL}/verify`,
      paymentRequired,
      {
        headers:        { 'Content-Type': 'application/json', 'X-x402-Version': String(X402_VERSION) },
        timeout:        15000,
        validateStatus: null, // handle all status codes ourselves
      }
    );
    const settlementLatencyMs = Date.now() - startTime;
    const data = resp.data || {};
    const txSignature = data.txSignature || data.transaction_id || data.txHash || null;
    const network     = data.network || paymentRequired.network || 'base';

    if (resp.status === 200 || resp.status === 201) {
      return {
        success: true,
        facilitatorResponse: data,
        settlementLatencyMs,
        txSignature,
        network,
      };
    }

    // Facilitator responded with error — store response for audit
    return {
      success:             false,
      facilitatorStatus:   resp.status,
      facilitatorResponse: data,
      error:               data.error || `Facilitator returned HTTP ${resp.status}`,
      settlementLatencyMs,
      txSignature,
      network,
    };
  } catch (err) {
    // Network error or facilitator unreachable — record locally, flag for retry
    return {
      success:             false,
      error:               err.message,
      offline:             true,
      settlementLatencyMs: Date.now() - startTime,
      txSignature:         null,
      network:             paymentRequired.network || 'base',
    };
  }
}

// Alias used by new ATM flow (semantically clearer for the submit-and-await path)
async function submitPayment(paymentRequired) {
  return verifyPayment(paymentRequired);
}

// ── generateReceipt ───────────────────────────────────────────────
/**
 * Build an x402 audit receipt.
 * Called after verifyPayment — stores full audit trail.
 *
 * @param {string} paymentId           — internal KURO payment ID
 * @param {object} paymentRequired     — from buildPaymentRequired()
 * @param {object} settlementResponse  — from verifyPayment()
 */
function generateReceipt(paymentId, paymentRequired, settlementResponse) {
  return {
    receiptId:  crypto.randomUUID(),
    paymentId,
    x402Version: X402_VERSION,
    timestamp:  new Date().toISOString(),
    network:    paymentRequired.network,

    source: {
      currency:      paymentRequired.source.currency,
      grossAmount:   paymentRequired.source.grossAmount,
      netAmount:     paymentRequired.source.netAmount,
      commission:    paymentRequired.source.commission,
      stripeIntentId: paymentRequired.source.stripeIntentId,
    },

    merchant: {
      accountNumber: paymentRequired.payTo.accountNumber,
      bankBin:       paymentRequired.payTo.bankBin,
      bankName:      paymentRequired.payTo.bankName,
      bankSwift:     paymentRequired.payTo.bankSwift,
      merchantName:  paymentRequired.payTo.merchantName,
      country:       paymentRequired.payTo.country,
    },

    payout: {
      currency: paymentRequired.payTo.currency,
      amount:   paymentRequired.payTo.amount,
    },

    settlement: {
      success:             settlementResponse.success,
      facilitatorUrl:      FACILITATOR_URL,
      facilitatorResponse: settlementResponse.facilitatorResponse || null,
      offline:             settlementResponse.offline || false,
      error:               settlementResponse.error  || null,
    },

    settlementLatencyMs: settlementResponse.settlementLatencyMs ?? null,
    txSignature:         settlementResponse.txSignature ?? null,
    network:             settlementResponse.network || paymentRequired.network || 'base',

    reference: paymentRequired.reference,
    status:    settlementResponse.success ? 'settled' : 'pending_settlement',
  };
}

module.exports = {
  buildPaymentRequired,
  verifyPayment,
  submitPayment,
  generateReceipt,
  FACILITATOR_URL,
  X402_VERSION,
};
