'use strict';

const axios = require('axios');
const crypto = require('crypto');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const SANDBOX = process.env.WISE_SANDBOX === 'true';
const BASE = SANDBOX
  ? 'https://api.sandbox.transferwise.tech'
  : 'https://api.wise.com';
const TOKEN = process.env.WISE_API_TOKEN || '';
const MOCK = !TOKEN;

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_PROFILE_ID = 12345678;

const MOCK_BALANCES = [
  {
    id: 100001,
    currency: 'AUD',
    amount: { value: 1250.0, currency: 'AUD' },
    type: 'STANDARD',
  },
  {
    id: 100002,
    currency: 'USD',
    amount: { value: 320.5, currency: 'USD' },
    type: 'STANDARD',
  },
];

const MOCK_ACCOUNT_DETAILS = [
  {
    currency: 'AUD',
    bankDetails: {
      bsb: '062-000',
      accountNumber: '12345678',
      accountHolderName: 'Kuro Pay',
    },
  },
];

const MOCK_TRANSACTIONS = [
  {
    type: 'CREDIT',
    date: '2026-02-28T10:30:00Z',
    amount: { value: 500.0, currency: 'AUD' },
    details: { description: 'Incoming transfer', senderName: 'John D.' },
    referenceNumber: 'TXN-001',
    runningBalance: { value: 1250.0, currency: 'AUD' },
  },
  {
    type: 'DEBIT',
    date: '2026-02-27T14:20:00Z',
    amount: { value: -80.0, currency: 'AUD' },
    details: { description: 'Payment to vendor' },
    referenceNumber: 'TXN-002',
    runningBalance: { value: 750.0, currency: 'AUD' },
  },
  {
    type: 'CREDIT',
    date: '2026-02-26T09:00:00Z',
    amount: { value: 830.0, currency: 'AUD' },
    details: { description: 'Salary deposit', senderName: 'Employer Pty Ltd' },
    referenceNumber: 'TXN-003',
    runningBalance: { value: 830.0, currency: 'AUD' },
  },
];

const MOCK_QUOTE = {
  id: 'quote-uuid-mock-001',
  sourceCurrency: 'AUD',
  targetCurrency: 'AUD',
  sourceAmount: 100.0,
  targetAmount: 100.0,
  rate: 1.0,
  fee: 0.65,
  createdTime: new Date().toISOString(),
};

const MOCK_RECIPIENT = {
  id: 90001,
  currency: 'AUD',
  type: 'australian',
  details: { bsb: '062-000', accountNumber: '12345678', legalType: 'PRIVATE' },
  accountHolderName: 'Test Recipient',
};

const MOCK_TRANSFER = {
  id: 70001,
  targetAccount: 90001,
  quoteUuid: 'quote-uuid-mock-001',
  status: 'incoming_payment_waiting',
  reference: 'KURO-PAY',
  created: new Date().toISOString(),
};

const MOCK_FUND = {
  type: 'BALANCE',
  status: 'COMPLETED',
  errorCode: null,
};

/* ------------------------------------------------------------------ */
/*  Live API functions                                                */
/* ------------------------------------------------------------------ */

let cachedProfileId = null;

async function getProfiles() {
  if (MOCK) return [{ id: MOCK_PROFILE_ID, type: 'personal' }];

  const key = 'wise:profiles';
  const cached = cache.get(key);
  if (cached) return cached;

  const { data } = await axios.get(`${BASE}/v1/profiles`, { headers: headers() });
  cache.set(key, data, 300_000); // 5 min

  const personal = data.find((p) => p.type === 'personal');
  if (personal) cachedProfileId = personal.id;

  return data;
}

async function getBalances(profileId) {
  if (MOCK) return MOCK_BALANCES;

  const { data } = await axios.get(`${BASE}/v4/profiles/${profileId}/balances?types=STANDARD`, {
    headers: headers(),
  });
  return data;
}

async function getAccountDetails(profileId) {
  if (MOCK) return MOCK_ACCOUNT_DETAILS;

  const { data } = await axios.get(`${BASE}/v1/profiles/${profileId}/account-details`, {
    headers: headers(),
  });
  return data;
}

async function getTransactions(profileId, currency = 'AUD') {
  if (MOCK) return MOCK_TRANSACTIONS;

  // First get the borderless account id
  const { data: accounts } = await axios.get(
    `${BASE}/v1/borderless-accounts?profileId=${profileId}`,
    { headers: headers() }
  );

  const account = accounts[0];
  if (!account) return [];

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data } = await axios.get(
    `${BASE}/v3/profiles/${profileId}/borderless-accounts/${account.id}/statement.json`,
    {
      headers: headers(),
      params: {
        currency,
        intervalStart: threeMonthsAgo.toISOString(),
        intervalEnd: now.toISOString(),
      },
    }
  );

  return data.transactions || [];
}

async function createQuote(profileId, source, target, amount) {
  if (MOCK) {
    return {
      ...MOCK_QUOTE,
      sourceCurrency: source,
      targetCurrency: target,
      sourceAmount: amount / 100,
      targetAmount: amount / 100,
    };
  }

  const { data } = await axios.post(
    `${BASE}/v3/profiles/${profileId}/quotes`,
    {
      sourceCurrency: source,
      targetCurrency: target,
      sourceAmount: amount / 100, // convert cents to dollars for API
      targetAmount: null,
    },
    { headers: headers() }
  );
  return data;
}

async function createRecipient(profileId, currency, bsb, accountNumber, name) {
  if (MOCK) {
    return {
      ...MOCK_RECIPIENT,
      currency,
      details: { ...MOCK_RECIPIENT.details, bsb, accountNumber },
      accountHolderName: name,
    };
  }

  const { data } = await axios.post(
    `${BASE}/v1/accounts`,
    {
      profile: profileId,
      accountHolderName: name,
      currency,
      type: 'australian',
      details: {
        legalType: 'PRIVATE',
        bsb: bsb.replace('-', ''),
        accountNumber,
      },
    },
    { headers: headers() }
  );
  return data;
}

async function createTransfer(targetAccountId, quoteUuid, reference) {
  if (MOCK) {
    return {
      ...MOCK_TRANSFER,
      targetAccount: targetAccountId,
      quoteUuid,
      reference,
    };
  }

  const { data } = await axios.post(
    `${BASE}/v1/transfers`,
    {
      targetAccount: targetAccountId,
      quoteUuid,
      customerTransactionId: crypto.randomUUID(),
      details: { reference: reference || 'KURO-PAY' },
    },
    { headers: headers() }
  );
  return data;
}

async function fundTransfer(profileId, transferId) {
  if (MOCK) return MOCK_FUND;

  const { data } = await axios.post(
    `${BASE}/v3/profiles/${profileId}/transfers/${transferId}/payments`,
    { type: 'BALANCE' },
    { headers: headers() }
  );
  return data;
}

async function getExchangeRate(source, target) {
  const key = `wise:rate:${source}:${target}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // Rate endpoint is public, no auth needed, works even in mock mode
  try {
    const { data } = await axios.get(`${BASE}/v1/rates`, {
      params: { source, target },
    });
    cache.set(key, data, 120_000); // 2 min
    return data;
  } catch (err) {
    // Fallback for mock or error
    return [{ source, target, rate: 1.0, time: new Date().toISOString() }];
  }
}

function validateWebhook(rawBody, signature) {
  if (!process.env.WISE_WEBHOOK_PUBLIC_KEY) return false;

  try {
    const publicKey = process.env.WISE_WEBHOOK_PUBLIC_KEY;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(rawBody);
    return verifier.verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

module.exports = {
  getProfiles,
  getBalances,
  getAccountDetails,
  getTransactions,
  createQuote,
  createRecipient,
  createTransfer,
  fundTransfer,
  getExchangeRate,
  validateWebhook,
  MOCK,
};
