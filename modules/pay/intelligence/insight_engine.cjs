'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');

const payBrain      = require('./pay_brain.cjs');
const addictionMirror = require('./addiction_mirror.cjs');
const ledger        = require('../core/ledger.cjs');
const events        = require('../core/events.cjs');
const cache         = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  KURO::PAY — Insight Engine                                         */
/*  15-minute interval insight generation cycle.                       */
/* ------------------------------------------------------------------ */

const CYCLE_MS          = 15 * 60 * 1000;   // 15 minutes
const COINGECKO_URL     = 'https://api.coingecko.com/api/v3/simple/price';
const FRANKFURTER_URL   = 'https://api.frankfurter.app/latest';
const PRICE_CACHE_KEY   = 'pay:insight:prices';
const FOREX_CACHE_KEY   = 'pay:insight:forex';
const CACHE_TTL         = 10 * 60 * 1000;   // 10 min

let _intervalId = null;

/* ------------------------------------------------------------------ */
/*  Data fetchers                                                      */
/* ------------------------------------------------------------------ */

async function fetchPrices() {
  const cached = cache.get(PRICE_CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await axios.get(COINGECKO_URL, {
      params: { ids: 'bitcoin,monero', vs_currencies: 'aud' },
      timeout: 15_000,
    });
    const data = {
      btc_price_aud: res.data.bitcoin  && res.data.bitcoin.aud  || 0,
      xmr_price_aud: res.data.monero   && res.data.monero.aud   || 0,
    };
    cache.set(PRICE_CACHE_KEY, data, CACHE_TTL);
    return data;
  } catch (_) {
    return { btc_price_aud: 0, xmr_price_aud: 0 };
  }
}

async function fetchForex() {
  const cached = cache.get(FOREX_CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await axios.get(FRANKFURTER_URL, {
      params: { from: 'AUD', to: 'USD' },
      timeout: 15_000,
    });
    const rate = res.data.rates && res.data.rates.USD || 0;
    const data = { aud_usd: rate };
    cache.set(FOREX_CACHE_KEY, data, CACHE_TTL);
    return data;
  } catch (_) {
    return { aud_usd: 0 };
  }
}

function getPortfolioComposition() {
  const cached = cache.get('pay:portfolio_summary');
  if (cached) return cached;

  // Fallback: pull last 50 ledger entries and summarise
  try {
    const rows = ledger.getLedger(50, 0);
    const totals = {};
    for (const row of rows) {
      const cur = row.currency || 'AUD';
      totals[cur] = (totals[cur] || 0) + (row.amount_minor || 0);
    }
    // Convert minor units to major
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
/*  Cycle generator                                                    */
/* ------------------------------------------------------------------ */

async function generateCycleInsight() {
  try {
    const [prices, forex] = await Promise.all([fetchPrices(), fetchForex()]);
    const portfolio   = getPortfolioComposition();
    const sessionStats = addictionMirror.getStats('__global__');

    const context = {
      btc_price_aud: prices.btc_price_aud,
      xmr_price_aud: prices.xmr_price_aud,
      aud_usd:       forex.aud_usd,
      portfolio,
      session_stats: sessionStats,
    };

    const insight = await payBrain.generateInsight(context);
    const insightId = randomUUID();

    // Persist to database
    ledger.saveInsight(insightId, 'deep', insight);

    // Emit on event bus
    events.emit('insight_ready', { id: insightId, insight });

    return insight;
  } catch (err) {
    // Swallow — insight generation must never crash the server
    console.error('[PAY::InsightEngine] cycle error:', err.message || err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

function start() {
  if (_intervalId) return;   // already running
  // Run once immediately, then every 15 min
  generateCycleInsight();
  _intervalId = setInterval(generateCycleInsight, CYCLE_MS);
  if (_intervalId.unref) _intervalId.unref();
}

function stop() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

function getLatest() {
  return ledger.getInsight();
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  start,
  stop,
  getLatest,
  generateCycleInsight,
};
