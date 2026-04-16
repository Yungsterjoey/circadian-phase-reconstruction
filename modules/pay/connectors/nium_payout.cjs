'use strict';

// Nium payout connector — fallback for TH/PH/MY/ID rails.
// Uses Nium's Payouts API to deliver local currency to merchant accounts.

const axios = require('axios');

const NIUM_URL       = process.env.NIUM_API_URL    || 'https://api.nium.com';
const NIUM_KEY       = process.env.NIUM_API_KEY    || '';
const NIUM_CLIENT_ID = process.env.NIUM_CLIENT_ID  || '';

function headers() {
  return {
    'x-api-key':    NIUM_KEY,
    'x-client-id':  NIUM_CLIENT_ID,
    'Content-Type': 'application/json',
  };
}

async function initiate({ stripePaymentIntentId, destination, userId, amountAUD, reference, rail }) {
  if (!NIUM_KEY || !NIUM_CLIENT_ID) {
    return { payoutId: null, status: 'failed', error: 'nium_payout not configured (NIUM_API_KEY or NIUM_CLIENT_ID missing)' };
  }

  const body = {
    uniqueTransactionCode: reference || `KURO-NIUM-${Date.now().toString(36).toUpperCase()}`,
    amount:                amountAUD,
    sourceCurrency:        'AUD',
    destinationCurrency:   destination.currency || 'USD',
    destination:           {
      type:    destination.type,
      proxy:   destination.proxy   || null,
      pan:     destination.pan     || null,
      account: destination.account || null,
      country: destination.country,
    },
    metadata: { userId, stripePaymentIntentId, rail },
  };

  const resp = await axios.post(`${NIUM_URL}/v1/payouts`, body, {
    headers: headers(),
    timeout: 10_000,
    validateStatus: null,
  });

  if (resp.status === 200 || resp.status === 201 || resp.status === 202) {
    const data = resp.data || {};
    return { payoutId: data.transactionId || data.uniqueTransactionCode, status: 'pending', raw: data };
  }

  return {
    payoutId: null,
    status:   'failed',
    error:    resp.data?.message || `nium HTTP ${resp.status}`,
  };
}

async function getStatus(payoutId) {
  if (!NIUM_KEY) return { status: 'unknown' };
  const resp = await axios.get(`${NIUM_URL}/v1/payouts/${payoutId}`, {
    headers: headers(),
    timeout: 8_000,
    validateStatus: null,
  });
  const data = resp.data || {};
  return { status: data.status || 'unknown', settledAt: data.completedAt, proof: data };
}

module.exports = { initiate, getStatus };
