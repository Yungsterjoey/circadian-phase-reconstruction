'use strict';

const axios = require('axios');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const BASE = 'https://api.coingecko.com/api/v3';
const CACHE_TTL = 120_000; // 2 minutes

/* ------------------------------------------------------------------ */
/*  Rate limiter: token bucket 25 req/min                             */
/* ------------------------------------------------------------------ */

const bucket = {
  tokens: 25,
  max: 25,
  refillRate: 25 / 60_000, // tokens per ms
  lastRefill: Date.now(),
};

function acquireToken() {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(bucket.max, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
}

async function rateLimitedGet(url, params = {}) {
  if (!acquireToken()) {
    // Wait a bit and retry once
    await new Promise((r) => setTimeout(r, 2500));
    if (!acquireToken()) {
      throw new Error('CoinGecko rate limit exceeded');
    }
  }

  return axios.get(url, { params, timeout: 10_000 });
}

/* ------------------------------------------------------------------ */
/*  API Functions                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get current prices for given coin IDs.
 * @param {string[]} ids - e.g. ['bitcoin', 'monero']
 * @param {string[]} vs  - e.g. ['aud', 'usd']
 * @returns {Object} e.g. { bitcoin: { aud: 99850, usd: 64200, aud_24h_change: 1.23 }, ... }
 */
async function getPrices(ids = ['bitcoin', 'monero'], vs = ['aud', 'usd']) {
  const key = `cg:prices:${ids.join(',')}:${vs.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await rateLimitedGet(`${BASE}/simple/price`, {
      ids: ids.join(','),
      vs_currencies: vs.join(','),
      include_24hr_change: true,
    });

    cache.set(key, data, CACHE_TTL);
    return data;
  } catch (err) {
    // Fallback to cache if available (even expired), otherwise throw
    const stale = cache.get(key);
    if (stale) return stale;
    throw err;
  }
}

/**
 * Get sparkline / market chart for a coin.
 * @param {string} id   - e.g. 'bitcoin'
 * @param {number} days - e.g. 7
 * @returns {number[][]} Array of [timestamp, price] pairs
 */
async function getSparkline(id, days = 7) {
  const key = `cg:spark:${id}:${days}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await rateLimitedGet(`${BASE}/coins/${id}/market_chart`, {
      vs_currency: 'aud',
      days,
    });

    const prices = data.prices || [];
    cache.set(key, prices, CACHE_TTL);
    return prices;
  } catch (err) {
    const stale = cache.get(key);
    if (stale) return stale;
    throw err;
  }
}

module.exports = {
  getPrices,
  getSparkline,
};
