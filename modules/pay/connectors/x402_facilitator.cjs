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

module.exports = { initiate, getStatus };
