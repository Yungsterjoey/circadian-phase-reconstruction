'use strict';

const axios = require('axios');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const BASE = 'https://api.frankfurter.app';
const CACHE_TTL = 3_600_000; // 1 hour

/* ------------------------------------------------------------------ */
/*  API Functions                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get latest exchange rates from ECB via Frankfurter.
 * @param {string}   base    - Base currency, e.g. 'AUD'
 * @param {string[]} symbols - Target currencies
 * @returns {{ base, date, rates: { USD: number, EUR: number, ... } }}
 */
async function getRates(base = 'AUD', symbols = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY']) {
  const key = `fx:latest:${base}:${symbols.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE}/latest`, {
      params: {
        base,
        symbols: symbols.join(','),
      },
      timeout: 10_000,
    });

    cache.set(key, data, CACHE_TTL);
    return data;
  } catch (err) {
    const stale = cache.get(key);
    if (stale) return stale;
    throw err;
  }
}

/**
 * Get historical exchange rates for a specific date.
 * @param {string}   date    - ISO date, e.g. '2026-02-28'
 * @param {string}   base    - Base currency
 * @param {string[]} symbols - Target currencies
 * @returns {{ base, date, rates }}
 */
async function getHistorical(date, base = 'AUD', symbols = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY']) {
  const key = `fx:hist:${date}:${base}:${symbols.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE}/${date}`, {
      params: {
        base,
        symbols: symbols.join(','),
      },
      timeout: 10_000,
    });

    cache.set(key, data, CACHE_TTL);
    return data;
  } catch (err) {
    const stale = cache.get(key);
    if (stale) return stale;
    throw err;
  }
}

module.exports = {
  getRates,
  getHistorical,
};
