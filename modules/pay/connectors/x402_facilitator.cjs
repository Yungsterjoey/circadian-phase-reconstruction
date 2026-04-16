'use strict';

// x402 facilitator connector.
// Signs requests with HMAC-SHA256 (key: KURO_X402_SIGNING_KEY).
// The facilitator receives AUD and settles to the destination bank account.

const crypto = require('crypto');
const axios  = require('axios');

const URL         = process.env.X402_FACILITATOR_URL  || '';
const SIGNING_KEY = process.env.KURO_X402_SIGNING_KEY || '';
const RECEIVE_ADDR = process.env.KURO_X402_RECEIVE_ADDRESS || '';

function sign(body) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(JSON.stringify(body)).digest('hex');
}

async function initiate({ stripePaymentIntentId, destination, userId, amountAUD, reference, rail }) {
  if (!URL || !SIGNING_KEY) {
    return { payoutId: null, status: 'failed', error: 'x402_facilitator not configured (X402_FACILITATOR_URL or KURO_X402_SIGNING_KEY missing)' };
  }

  const body = {
    stripePaymentIntentId,
    destination,
    userId,
    amountAUD,
    reference: reference || `KURO-${Date.now().toString(36).toUpperCase()}`,
    rail,
    receiveAddress: RECEIVE_ADDR,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const resp = await axios.post(`${URL}/initiate`, body, {
    headers: {
      'Content-Type':  'application/json',
      'X-KURO-Sig':    sign(body),
      'X-x402-Version': '2',
    },
    timeout: 10_000,
    validateStatus: null,
  });

  if (resp.status === 200 || resp.status === 201) {
    const data = resp.data || {};
    return { payoutId: data.payoutId || data.id, status: 'pending', raw: data };
  }

  return {
    payoutId: null,
    status:   'failed',
    error:    resp.data?.error || `facilitator HTTP ${resp.status}`,
  };
}

async function getStatus(payoutId) {
  if (!URL || !SIGNING_KEY) return { status: 'unknown' };
  const resp = await axios.get(`${URL}/status/${payoutId}`, {
    headers: { 'X-KURO-Sig': sign({ payoutId }) },
    timeout: 8_000,
    validateStatus: null,
  });
  const data = resp.data || {};
  return { status: data.status || 'unknown', settledAt: data.settledAt, proof: data };
}

// Ask the facilitator for its current exchange rate (local currency → AUD).
// Falls back to KURO_PAY_FX_RATE_<CURRENCY> env var, then hardcoded floor.
const FALLBACK_RATES = { VND: 16500, THB: 23.5, IDR: 10300, PHP: 36.5, MYR: 3.05 };

async function getRate(fromCurrency) {
  const envKey = `KURO_PAY_FX_RATE_${fromCurrency.toUpperCase()}`;
  if (!URL || !SIGNING_KEY) {
    const rate = parseFloat(process.env[envKey]) || FALLBACK_RATES[fromCurrency] || null;
    return { rate, source: process.env[envKey] ? 'env' : 'fallback', currency: fromCurrency };
  }
  try {
    const body = { from: fromCurrency, to: 'AUD', timestamp: Math.floor(Date.now() / 1000) };
    const resp  = await axios.get(`${URL}/rate`, {
      params:  body,
      headers: { 'X-KURO-Sig': sign(body) },
      timeout: 5_000,
      validateStatus: null,
    });
    if (resp.status === 200 && resp.data?.rate > 0) {
      return { rate: resp.data.rate, source: 'facilitator', currency: fromCurrency, fetchedAt: Date.now() };
    }
  } catch (_) {}
  const rate = parseFloat(process.env[envKey]) || FALLBACK_RATES[fromCurrency] || null;
  return { rate, source: process.env[envKey] ? 'env' : 'fallback', currency: fromCurrency };
}

module.exports = { initiate, getStatus, getRate, FALLBACK_RATES };
