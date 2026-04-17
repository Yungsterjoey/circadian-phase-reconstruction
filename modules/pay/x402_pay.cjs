'use strict';

/**
 * KURO::PAY — x402 settlement client.
 *
 * Posts to KURO's own x402 facilitator (modules/facilitator). The facilitator
 * verifies the HMAC-signed payload, claims the nonce, then dispatches to the
 * rail (fiat-napas247 → Ant International / x402 Foundation fiat rail operator).
 *
 * Stripe funds the AUD leg. x402 is the settlement protocol.
 */

const crypto = require('crypto');
const axios  = require('axios');

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'http://127.0.0.1:3000/api/facilitator';
const SVC_KEY         = process.env.KURO_FACILITATOR_SECRET || '';
const COMMISSION_RATE = parseFloat(process.env.KURO_PAY_COMMISSION || '0.012');
const X402_VERSION    = 2;

const QR_STANDARD_TO_SCHEME = {
  vietqr:    'fiat-napas247',
  napas:     'fiat-napas247',
  napas247:  'fiat-napas247',
  promptpay: 'fiat-promptpay',
  qris:      'fiat-bifast',
  qrph:      'fiat-instapay',
  duitnow:   'fiat-duitnow',
};

const SCHEME_TO_NETWORK = {
  'fiat-napas247':  'napas247',
  'fiat-promptpay': 'promptpay',
  'fiat-instapay':  'instapay',
  'fiat-duitnow':   'duitnow',
  'fiat-bifast':    'bifast',
};

function canonicalJSON(obj) {
  const keys = Object.keys(obj).filter((k) => k !== 'signature').sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function schemeFor(parsedQR) {
  const raw = (parsedQR.standard || '').toLowerCase();
  return QR_STANDARD_TO_SCHEME[raw] || 'fiat-napas247';
}

function newNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function signPayload(payload, scheme) {
  const envKey = 'KURO_FACILITATOR_RAIL_SECRET_' + scheme.toUpperCase().replace(/-/g, '_');
  const key = process.env[envKey] || '';
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(canonicalJSON(payload)).digest('hex');
}

function buildPaymentRequired(parsedQR, amountAUD, amountVND, stripeIntentId, ref) {
  const scheme = schemeFor(parsedQR);
  const network = SCHEME_TO_NETWORK[scheme] || parsedQR.standard || 'napas247';
  const commission = parseFloat((amountAUD * COMMISSION_RATE).toFixed(4));
  const netAUD     = parseFloat((amountAUD - commission).toFixed(4));

  const payload = {
    scheme,
    network,
    payer:     stripeIntentId,
    amount:    String(amountVND),
    currency:  parsedQR.currency || 'VND',
    recipient: parsedQR.accountNumber,
    nonce:     newNonce(),
    ts:        Math.floor(Date.now() / 1000),
    extra: {
      reference:     ref,
      bankBin:       parsedQR.bankBin,
      bankName:      parsedQR.bankName,
      bankShortName: parsedQR.bankShortName,
      bankSwift:     parsedQR.bankSwift,
      merchantName:  parsedQR.merchantName || '',
      country:       parsedQR.countryCode || 'VN',
      standard:      parsedQR.standard,
      source: {
        type:           'stripe',
        currency:       'AUD',
        grossAmount:    amountAUD,
        netAmount:      netAUD,
        commission,
        commissionRate: COMMISSION_RATE,
        stripeIntentId,
      },
    },
  };

  const sig = signPayload(payload, scheme);
  if (sig) payload.signature = sig;

  return {
    version:        X402_VERSION,
    x402Version:    X402_VERSION,
    scheme,
    network,
    facilitatorUrl: FACILITATOR_URL,
    description:    `KURO::PAY ${parsedQR.bankName || parsedQR.bankBin || ''} ${parsedQR.accountNumber}`.trim(),
    paymentPayload: payload,
    paymentRequirements: {
      scheme,
      network,
      recipient: parsedQR.accountNumber,
      currency:  parsedQR.currency || 'VND',
      amount:    String(amountVND),
    },
    source: {
      type:           'stripe',
      currency:       'AUD',
      grossAmount:    amountAUD,
      netAmount:      netAUD,
      commission,
      commissionRate: COMMISSION_RATE,
      stripeIntentId,
    },
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
    reference: ref,
    timestamp: payload.ts,
  };
}

async function verifyPayment(paymentRequired) {
  const startTime = Date.now();
  const body = {
    paymentPayload:      paymentRequired.paymentPayload,
    paymentRequirements: paymentRequired.paymentRequirements,
  };
  const idempotencyKey = paymentRequired.paymentPayload?.nonce || newNonce();

  try {
    const resp = await axios.post(`${FACILITATOR_URL}/settle`, body, {
      headers: {
        'Content-Type':     'application/json',
        'X-x402-Version':   String(X402_VERSION),
        'X-KURO-Svc-Key':   SVC_KEY,
        'Idempotency-Key':  idempotencyKey,
      },
      timeout:        20_000,
      validateStatus: null,
    });

    const settlementLatencyMs = Date.now() - startTime;
    const data = resp.data || {};
    const txSignature = data.transaction || data.txSignature || data.txHash || null;
    const network     = data.network || paymentRequired.network || null;

    if (resp.status === 200 && data.success) {
      return {
        success:             true,
        facilitatorResponse: data,
        settlementLatencyMs,
        txSignature,
        network,
      };
    }

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
    return {
      success:             false,
      error:               err.message,
      offline:             true,
      settlementLatencyMs: Date.now() - startTime,
      txSignature:         null,
      network:             paymentRequired.network || null,
    };
  }
}

async function submitPayment(paymentRequired) {
  return verifyPayment(paymentRequired);
}

function generateReceipt(paymentId, paymentRequired, settlementResponse) {
  return {
    receiptId:   crypto.randomUUID(),
    paymentId,
    x402Version: X402_VERSION,
    timestamp:   new Date().toISOString(),
    scheme:      paymentRequired.scheme,
    network:     settlementResponse.network || paymentRequired.network,

    source: {
      currency:       paymentRequired.source.currency,
      grossAmount:    paymentRequired.source.grossAmount,
      netAmount:      paymentRequired.source.netAmount,
      commission:     paymentRequired.source.commission,
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
  schemeFor,
};
