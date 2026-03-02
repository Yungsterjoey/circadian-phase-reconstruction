'use strict';

const axios = require('axios');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const BASE = 'https://au-api.basiq.io';
const API_KEY = process.env.BASIQ_API_KEY || '';
const MOCK = !API_KEY;

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_ACCOUNTS = [
  {
    id: 'acc-mock-cba-001',
    name: 'Smart Access',
    institution: 'AU00000',
    institutionName: 'Commonwealth Bank',
    accountNo: 'xxxx4321',
    balance: '8420.35',
    currency: 'AUD',
    class: { type: 'transaction', product: 'Smart Access' },
    status: 'available',
    lastUpdated: '2026-03-01T08:00:00Z',
  },
  {
    id: 'acc-mock-cba-002',
    name: 'NetBank Saver',
    institution: 'AU00000',
    institutionName: 'Commonwealth Bank',
    accountNo: 'xxxx8765',
    balance: '15200.00',
    currency: 'AUD',
    class: { type: 'savings', product: 'NetBank Saver' },
    status: 'available',
    lastUpdated: '2026-03-01T08:00:00Z',
  },
];

const MOCK_TRANSACTIONS = [
  {
    id: 'txn-mock-001',
    type: 'debit',
    status: 'posted',
    description: 'WOOLWORTHS 1234 SYDNEY',
    amount: '-45.30',
    currency: 'AUD',
    postDate: '2026-03-01',
    transactionDate: '2026-02-28',
    category: 'groceries',
    account: 'acc-mock-cba-001',
  },
  {
    id: 'txn-mock-002',
    type: 'debit',
    status: 'posted',
    description: 'UBER *TRIP HELP.UBER.COM',
    amount: '-18.50',
    currency: 'AUD',
    postDate: '2026-02-28',
    transactionDate: '2026-02-28',
    category: 'transport',
    account: 'acc-mock-cba-001',
  },
  {
    id: 'txn-mock-003',
    type: 'credit',
    status: 'posted',
    description: 'SALARY EMPLOYER PTY LTD',
    amount: '3200.00',
    currency: 'AUD',
    postDate: '2026-02-27',
    transactionDate: '2026-02-27',
    category: 'income',
    account: 'acc-mock-cba-001',
  },
  {
    id: 'txn-mock-004',
    type: 'debit',
    status: 'posted',
    description: 'NETFLIX.COM',
    amount: '-22.99',
    currency: 'AUD',
    postDate: '2026-02-26',
    transactionDate: '2026-02-26',
    category: 'entertainment',
    account: 'acc-mock-cba-001',
  },
  {
    id: 'txn-mock-005',
    type: 'debit',
    status: 'posted',
    description: 'COLES EXPRESS 5678',
    amount: '-65.00',
    currency: 'AUD',
    postDate: '2026-02-25',
    transactionDate: '2026-02-25',
    category: 'fuel',
    account: 'acc-mock-cba-001',
  },
];

/* ------------------------------------------------------------------ */
/*  OAuth2 Token                                                      */
/* ------------------------------------------------------------------ */

let tokenData = null; // { access_token, expires_at }

async function getToken() {
  if (MOCK) return 'mock-token';

  if (tokenData && Date.now() < tokenData.expires_at) {
    return tokenData.access_token;
  }

  const { data } = await axios.post(
    `${BASE}/token`,
    'scope=SERVER_ACCESS',
    {
      headers: {
        Authorization: `Basic ${API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'basiq-version': '3.0',
      },
    }
  );

  tokenData = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000, // renew 60s before expiry
  };

  return tokenData.access_token;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'basiq-version': '3.0',
  };
}

/* ------------------------------------------------------------------ */
/*  API Functions                                                     */
/* ------------------------------------------------------------------ */

async function getAccounts(userId) {
  if (MOCK) return MOCK_ACCOUNTS;

  const token = await getToken();
  const { data } = await axios.get(`${BASE}/users/${userId}/accounts`, {
    headers: authHeaders(token),
  });

  return data.data || data;
}

async function getTransactions(userId, limit = 10) {
  if (MOCK) return MOCK_TRANSACTIONS.slice(0, limit);

  const token = await getToken();
  const { data } = await axios.get(`${BASE}/users/${userId}/transactions`, {
    headers: authHeaders(token),
    params: { limit },
  });

  return data.data || data;
}

module.exports = {
  getToken,
  getAccounts,
  getTransactions,
  MOCK,
};
