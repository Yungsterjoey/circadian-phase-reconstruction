'use strict';

const axios = require('axios');
const crypto = require('crypto');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const BASE = 'https://api.independentreserve.com';
const API_KEY = process.env.IR_API_KEY || '';
const API_SECRET = process.env.IR_API_SECRET || '';
const MOCK = !API_KEY;

/* ------------------------------------------------------------------ */
/*  HMAC Auth Helper                                                  */
/* ------------------------------------------------------------------ */

function signRequest(url, params) {
  const nonce = Date.now();
  const paramEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));

  // Message: url,apiKey,nonce,param1=val1,param2=val2,...
  const messageParts = [url, API_KEY, String(nonce)];
  for (const [key, value] of paramEntries) {
    messageParts.push(`${key}=${value}`);
  }
  const message = messageParts.join(',');

  const signature = crypto
    .createHmac('sha256', Buffer.from(API_SECRET, 'utf8'))
    .update(message)
    .digest('hex')
    .toUpperCase();

  return {
    apiKey: API_KEY,
    nonce,
    signature,
  };
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_ORDER_BOOK = {
  BuyOrders: [
    { Price: 99850.0, Volume: 0.12 },
    { Price: 99800.0, Volume: 0.35 },
    { Price: 99750.0, Volume: 0.58 },
    { Price: 99600.0, Volume: 1.2 },
  ],
  SellOrders: [
    { Price: 99900.0, Volume: 0.08 },
    { Price: 99950.0, Volume: 0.25 },
    { Price: 100000.0, Volume: 0.42 },
    { Price: 100200.0, Volume: 0.9 },
  ],
  CreatedTimestampUtc: new Date().toISOString(),
  PrimaryCurrencyCode: 'Xbt',
  SecondaryCurrencyCode: 'Aud',
};

const MOCK_ACCOUNTS_DATA = [
  {
    CurrencyCode: 'Aud',
    TotalBalance: 15000,     // 150.00 AUD in cents
    AvailableBalance: 15000,
  },
  {
    CurrencyCode: 'Xbt',
    TotalBalance: 500000,    // 0.005 BTC in satoshi
    AvailableBalance: 500000,
  },
];

const MOCK_ORDER = {
  OrderGuid: 'order-mock-ir-001',
  CreatedTimestampUtc: new Date().toISOString(),
  Type: 'MarketBid',
  Volume: 0.001,
  Outstanding: 0,
  Price: 99900.0,
  AvgPrice: 99900.0,
  Status: 'Filled',
  PrimaryCurrencyCode: 'Xbt',
  SecondaryCurrencyCode: 'Aud',
};

const MOCK_WITHDRAWAL = {
  WithdrawalGuid: 'wd-mock-ir-001',
  Status: 'Pending',
  Amount: 0.001,
  Currency: 'Xbt',
  DestinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  CreatedTimestampUtc: new Date().toISOString(),
};

const MOCK_CLOSED_ORDERS = [
  {
    OrderGuid: 'order-mock-ir-closed-001',
    CreatedTimestampUtc: '2026-02-28T12:00:00Z',
    Type: 'MarketBid',
    Volume: 0.002,
    Price: 98500.0,
    AvgPrice: 98500.0,
    Status: 'Filled',
    PrimaryCurrencyCode: 'Xbt',
    SecondaryCurrencyCode: 'Aud',
  },
  {
    OrderGuid: 'order-mock-ir-closed-002',
    CreatedTimestampUtc: '2026-02-25T09:30:00Z',
    Type: 'MarketOffer',
    Volume: 0.001,
    Price: 99200.0,
    AvgPrice: 99200.0,
    Status: 'Filled',
    PrimaryCurrencyCode: 'Xbt',
    SecondaryCurrencyCode: 'Aud',
  },
];

/* ------------------------------------------------------------------ */
/*  Public endpoints (no auth)                                        */
/* ------------------------------------------------------------------ */

async function getOrderBook(primary = 'Xbt', secondary = 'Aud') {
  const key = `ir:orderbook:${primary}:${secondary}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE}/Public/GetOrderBook`, {
      params: { primaryCurrencyCode: primary, secondaryCurrencyCode: secondary },
    });
    cache.set(key, data, 30_000); // 30s
    return data;
  } catch (err) {
    // Fallback to mock if live API is unreachable
    return MOCK_ORDER_BOOK;
  }
}

/* ------------------------------------------------------------------ */
/*  Private endpoints (HMAC auth)                                     */
/* ------------------------------------------------------------------ */

async function privatePost(endpoint, params = {}) {
  const url = `${BASE}${endpoint}`;
  const auth = signRequest(url, params);

  const { data } = await axios.post(url, {
    ...params,
    apiKey: auth.apiKey,
    nonce: auth.nonce,
    signature: auth.signature,
  });

  return data;
}

async function getAccounts() {
  if (MOCK) return MOCK_ACCOUNTS_DATA;
  return privatePost('/Private/GetAccounts');
}

async function placeMarketBuyOrder(volume, primary = 'Xbt', secondary = 'Aud') {
  if (MOCK) {
    return {
      ...MOCK_ORDER,
      Volume: volume,
      PrimaryCurrencyCode: primary,
      SecondaryCurrencyCode: secondary,
    };
  }

  return privatePost('/Private/PlaceMarketOrder', {
    primaryCurrencyCode: primary,
    secondaryCurrencyCode: secondary,
    orderType: 'MarketBid',
    volume,
  });
}

async function withdrawDigitalCurrency(address, currency = 'Xbt', amount) {
  if (MOCK) {
    return {
      ...MOCK_WITHDRAWAL,
      Amount: amount,
      Currency: currency,
      DestinationAddress: address,
    };
  }

  return privatePost('/Private/RequestWithdrawal', {
    amount,
    withdrawalCurrencyCode: currency,
    destinationAddress: address,
  });
}

async function getClosedOrders(primary, secondary) {
  if (MOCK) return MOCK_CLOSED_ORDERS;

  const params = {};
  if (primary) params.primaryCurrencyCode = primary;
  if (secondary) params.secondaryCurrencyCode = secondary;

  return privatePost('/Private/GetClosedOrders', params);
}

module.exports = {
  getOrderBook,
  getAccounts,
  placeMarketBuyOrder,
  withdrawDigitalCurrency,
  getClosedOrders,
  signRequest,
  MOCK,
};
