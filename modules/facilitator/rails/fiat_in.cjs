'use strict';

// KURO Facilitator — India fiat rail (scheme: fiat-upi / NPCI UPI)
// Same pattern as fiat_sea.cjs. Fails loud until operator creds provisioned.
// Env:
//   KURO_FACILITATOR_RAIL_URL_FIAT_UPI
//   KURO_FACILITATOR_RAIL_CRED_FIAT_UPI
//   KURO_FACILITATOR_RAIL_SECRET_FIAT_UPI  (HMAC, used by verifier)

const axios = require('axios');

const SCHEME_TO_NETWORK = {
  'fiat-upi': 'upi',
};

function envKey(prefix, scheme) {
  return `${prefix}_${scheme.toUpperCase().replace(/-/g, '_')}`;
}

async function settle(payload) {
  const scheme = payload.scheme;
  const net    = SCHEME_TO_NETWORK[scheme];
  if (!net) {
    return { success: false, network: null, error: `unsupported_in_scheme:${scheme}` };
  }
  const url  = process.env[envKey('KURO_FACILITATOR_RAIL_URL',  scheme)];
  const cred = process.env[envKey('KURO_FACILITATOR_RAIL_CRED', scheme)];
  if (!url || !cred) {
    return { success: false, network: net, error: `rail_not_provisioned:${scheme}` };
  }

  try {
    const body = {
      scheme,
      amount:    payload.amount,
      currency:  payload.currency,
      recipient: payload.recipient,
      reference: payload.extra?.reference || payload.nonce,
      nonce:     payload.nonce,
      ts:        payload.ts,
    };
    const resp = await axios.post(url, body, {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cred}`,
        'X-x402-Version': '2',
      },
      timeout:        15_000,
      validateStatus: null,
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = resp.data || {};
      return {
        success:     true,
        transaction: data.reference || data.id || data.txRef,
        network:     net,
        payer:       data.payer || null,
      };
    }
    return { success: false, network: net, error: resp.data?.error || `rail_http_${resp.status}` };
  } catch (e) {
    return { success: false, network: net, error: e.message };
  }
}

module.exports = {
  name:    scheme => scheme,
  network: scheme => SCHEME_TO_NETWORK[scheme] || null,
  settle,
  SCHEME_TO_NETWORK,
};
