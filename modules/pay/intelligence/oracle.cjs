'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');

const payBrain = require('./pay_brain.cjs');
const ledger   = require('../core/ledger.cjs');
const cache    = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  KURO::PAY — Sovereign Oracle                                       */
/*  On-demand deep analysis via sovereign AI profile.                  */
/* ------------------------------------------------------------------ */

const COINGECKO_MARKET_URL = 'https://api.coingecko.com/api/v3/coins';
const FRANKFURTER_URL      = 'https://api.frankfurter.app/latest';
const CACHE_TTL            = 10 * 60 * 1000;   // 10 min

/* ------------------------------------------------------------------ */
/*  Data gatherers                                                     */
/* ------------------------------------------------------------------ */

async function fetch7DayPrices() {
  const cacheKey = 'pay:oracle:prices_7d';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [btcRes, xmrRes] = await Promise.all([
      axios.get(`${COINGECKO_MARKET_URL}/bitcoin/market_chart`, {
        params: { vs_currency: 'aud', days: 7 },
        timeout: 15_000,
      }),
      axios.get(`${COINGECKO_MARKET_URL}/monero/market_chart`, {
        params: { vs_currency: 'aud', days: 7 },
        timeout: 15_000,
      }),
    ]);

    const data = {
      btc_aud_7d: (btcRes.data.prices || []).map(([ts, p]) => ({ ts, price: p })),
      xmr_aud_7d: (xmrRes.data.prices || []).map(([ts, p]) => ({ ts, price: p })),
    };
    cache.set(cacheKey, data, CACHE_TTL);
    return data;
  } catch (_) {
    return { btc_aud_7d: [], xmr_aud_7d: [] };
  }
}

async function fetchForexRates() {
  const cacheKey = 'pay:oracle:forex';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(FRANKFURTER_URL, {
      params: { from: 'AUD', to: 'USD,EUR,GBP,JPY' },
      timeout: 15_000,
    });
    const rates = res.data.rates || {};
    cache.set(cacheKey, rates, CACHE_TTL);
    return rates;
  } catch (_) {
    return {};
  }
}

function getPortfolioComposition() {
  const cached = cache.get('pay:portfolio_summary');
  if (cached) return cached;

  try {
    const rows = ledger.getLedger(50, 0);
    const totals = {};
    for (const row of rows) {
      const cur = row.currency || 'AUD';
      totals[cur] = (totals[cur] || 0) + (row.amount_minor || 0);
    }
    const portfolio = {};
    for (const [cur, minor] of Object.entries(totals)) {
      portfolio[cur] = minor / 100;
    }
    cache.set('pay:portfolio_summary', portfolio, CACHE_TTL);
    return portfolio;
  } catch (_) {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  queryOracle                                                        */
/* ------------------------------------------------------------------ */

async function queryOracle(sessionId) {
  try {
    const [prices7d, forexRates] = await Promise.all([
      fetch7DayPrices(),
      fetchForexRates(),
    ]);
    const portfolio = getPortfolioComposition();

    const context = {
      prices_7d: prices7d,
      forex_rates: forexRates,
      portfolio_composition: portfolio,
    };

    const oracleResponse = await payBrain.generateOracle(context);
    const insightId = randomUUID();

    // Persist with sovereign profile tag
    ledger.saveInsight(insightId, 'sovereign', oracleResponse);

    return oracleResponse;
  } catch (err) {
    console.error('[PAY::Oracle] query error:', err.message || err);
    return {
      analysis: 'Oracle unavailable — fallback active.',
      recommendations: [],
      macro_note: 'Insufficient data for macro analysis.',
      disclaimer: 'Signals only. Not financial advice.',
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = { queryOracle };
