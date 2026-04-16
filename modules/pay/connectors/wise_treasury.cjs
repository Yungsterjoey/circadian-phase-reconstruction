'use strict';

// INTERNAL ONLY — commission treasury payouts to KURO's Wise account.
// DO NOT require() this from user-facing paths.
//
// Guard: throws at module load if imported from a denied path.
// Deny-list: modules/pay/rails/*, modules/pay/core/rail_router*, modules/pay/core/quote_engine*
// Allow-list: modules/pay/scheduler/*, modules/pay/admin/*
//
// The throw is intentional fail-fast. A silent error here means commission
// could be routed to user destinations. Fail loudly is the only safe choice.

(function guardImportPath() {
  const caller = module?.parent?.filename || '';
  if (!caller) return; // loaded as entry point — allow

  const DENY = [
    /modules[/\\]pay[/\\]rails[/\\]/,
    /modules[/\\]pay[/\\]core[/\\]rail_router/,
    /modules[/\\]pay[/\\]core[/\\]quote_engine/,
  ];

  for (const pattern of DENY) {
    if (pattern.test(caller)) {
      throw new Error(
        `wise_treasury imported from user path: ${caller}\n` +
        'wise_treasury is INTERNAL ONLY. Only scheduler/* and admin/* may import it.'
      );
    }
  }
})();

const axios = require('axios');

const TOKEN        = process.env.WISE_API_TOKEN                || '';
const PROFILE_ID   = process.env.WISE_PROFILE_ID               || '';
const DEST_ACCOUNT = process.env.WISE_DESTINATION_ACCOUNT_ID   || '';
const SANDBOX      = process.env.WISE_SANDBOX === 'true';

const BASE = SANDBOX
  ? 'https://api.sandbox.transferwise.tech'
  : 'https://api.wise.com';

function headers() {
  return {
    Authorization:  `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// Transfer accumulated commission to KURO's Wise AUD account.
// Returns { transferId, status }.
async function transfer(amountAUD) {
  if (!TOKEN || !PROFILE_ID || !DEST_ACCOUNT) {
    throw new Error('wise_treasury not configured (WISE_API_TOKEN, WISE_PROFILE_ID, or WISE_DESTINATION_ACCOUNT_ID missing)');
  }

  const quoteResp = await axios.post(
    `${BASE}/v3/profiles/${PROFILE_ID}/quotes`,
    {
      sourceCurrency:      'AUD',
      targetCurrency:      'AUD',
      sourceAmount:        amountAUD,
      targetAccount:       parseInt(DEST_ACCOUNT, 10),
      payOut:              'BANK_TRANSFER',
    },
    { headers: headers(), timeout: 15_000 }
  );

  const quoteId = quoteResp.data.id;

  const transferResp = await axios.post(
    `${BASE}/v1/transfers`,
    {
      targetAccount:       parseInt(DEST_ACCOUNT, 10),
      quoteUuid:           quoteId,
      customerTransactionId: `KURO-COMM-${Date.now().toString(36).toUpperCase()}`,
      details: { reference: 'KURO::PAY commission payout' },
    },
    { headers: headers(), timeout: 15_000 }
  );

  return {
    transferId: transferResp.data.id,
    status:     transferResp.data.status,
    amountAUD,
  };
}

module.exports = { transfer };
