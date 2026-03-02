'use strict';

const express = require('express');
const router = express.Router();

const wise = require('../connectors/wise.cjs');
const basiq = require('../connectors/basiq.cjs');
const ir = require('../connectors/independent_reserve.cjs');
const xmr = require('../connectors/xmr.cjs');
const coingecko = require('../connectors/coingecko.cjs');
const frankfurter = require('../connectors/frankfurter.cjs');
const addictionMirror = require('../intelligence/addiction_mirror.cjs');
const ledger = require('../core/ledger.cjs');
const cache = require('../core/cache.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const SUMMARY_CACHE_KEY = 'pay:accounts:summary';
const SUMMARY_CACHE_TTL = 30_000; // 30 seconds

/* ------------------------------------------------------------------ */
/*  GET /accounts/summary                                              */
/* ------------------------------------------------------------------ */

router.get('/summary', async (req, res) => {
  try {
    const cached = cache.get(SUMMARY_CACHE_KEY);
    if (cached) {
      return res.json({ ok: true, cached: true, data: cached });
    }

    /* ---- Resolve IDs for Wise ---- */
    let wiseProfileId = null;
    try {
      const profiles = await wise.getProfiles();
      const personal = profiles.find((p) => p.type === 'personal');
      wiseProfileId = personal ? personal.id : (profiles[0] && profiles[0].id) || null;
    } catch (_) {
      // Will handle in allSettled
    }

    /* ---- Resolve session ID for addiction mirror ---- */
    const sessionId = (req.user && req.user.userId) || req.ip || '__anonymous__';

    /* ---- Parallel fetch all data sources ---- */
    const results = await Promise.allSettled([
      wiseProfileId ? wise.getBalances(wiseProfileId) : Promise.reject(new Error('no_profile')),
      wiseProfileId ? wise.getAccountDetails(wiseProfileId) : Promise.reject(new Error('no_profile')),
      basiq.getAccounts(process.env.BASIQ_USER_ID),
      basiq.getTransactions(process.env.BASIQ_USER_ID),
      ir.getAccounts(),
      xmr.getBalance(),
      xmr.getPrimaryAddress(),
      coingecko.getPrices(),
      frankfurter.getRates(),
    ]);

    const extract = (r) => (r.status === 'fulfilled' ? r.value : null);

    const summary = {
      wise: {
        balances: extract(results[0]),
        account_details: extract(results[1]),
      },
      basiq: {
        accounts: extract(results[2]),
        transactions: extract(results[3]),
      },
      independent_reserve: {
        accounts: extract(results[4]),
      },
      xmr: {
        balance: extract(results[5]),
        primary_address: extract(results[6]),
      },
      market: {
        crypto_prices: extract(results[7]),
        forex_rates: extract(results[8]),
      },
      awareness: addictionMirror.getStats(sessionId),
      errors: results
        .map((r, i) => (r.status === 'rejected' ? { index: i, reason: r.reason && r.reason.message || String(r.reason) } : null))
        .filter(Boolean),
      fetched_at: new Date().toISOString(),
    };

    cache.set(SUMMARY_CACHE_KEY, summary, SUMMARY_CACHE_TTL);

    return res.json({ ok: true, cached: false, data: summary });
  } catch (err) {
    console.error('[PAY::Accounts] summary error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /accounts/history?limit=20&offset=0                            */
/* ------------------------------------------------------------------ */

router.get('/history', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const rows = ledger.getLedger(limit, offset);

    return res.json({
      ok: true,
      data: rows,
      pagination: { limit, offset, count: rows.length },
    });
  } catch (err) {
    console.error('[PAY::Accounts] history error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

module.exports = router;
