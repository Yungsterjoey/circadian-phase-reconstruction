'use strict';

const express = require('express');

const webhooksRouter = require('./routes/webhooks.cjs');
const accountsRouter = require('./routes/accounts.cjs');
const opsRouter      = require('./routes/ops.cjs');
const insightsRouter = require('./routes/insights.cjs');
const auditRouter    = require('./routes/audit_routes.cjs');
const vaultsRouter   = require('./routes/vaults.cjs');

const ledger          = require('./core/ledger.cjs');
const insightEngine   = require('./intelligence/insight_engine.cjs');
const xmr             = require('./connectors/xmr.cjs');
const commissionCron  = require('./scheduler/commission_payout_hourly.cjs');

/* ------------------------------------------------------------------ */
/*  Router assembly                                                    */
/* ------------------------------------------------------------------ */

const router = express.Router();

/*
 * IMPORTANT: Webhook routes receive express.raw() bodies for signature
 * verification. Mount with raw body parser BEFORE any JSON parsing.
 */
router.use(
  '/webhook',
  express.raw({ type: 'application/json' }),
  webhooksRouter
);

/* Standard JSON-parsed sub-routers */
router.use('/accounts', express.json(), accountsRouter);
router.use('/ops',      express.json(), opsRouter);
router.use('/insights', express.json(), insightsRouter);
router.use('/audit',    express.json(), auditRouter);
router.use('/vaults',   express.json(), vaultsRouter);

/* ------------------------------------------------------------------ */
/*  initPayModule                                                      */
/* ------------------------------------------------------------------ */

async function initPayModule() {
  ledger.initSchema();
  console.log('[KURO::PAY] Database schema initialized');

  insightEngine.start();
  console.log('[KURO::PAY] Insight engine started');

  try {
    if (!xmr.MOCK) {
      const balance = await xmr.getBalance();
      if (balance.error) {
        console.warn('[KURO::PAY] XMR node offline:', balance.error);
      } else {
        console.log('[KURO::PAY] XMR node connected, balance:', (balance.balance / xmr.PICONERO).toFixed(6), 'XMR');
      }
    } else {
      console.log('[KURO::PAY] XMR running in mock mode');
    }
  } catch (err) {
    console.warn('[KURO::PAY] XMR connection test failed:', err.message || err);
  }

  commissionCron.start();

  return function shutdown() {
    insightEngine.stop();
    commissionCron.stop();
    console.log('[KURO::PAY] Shutdown complete');
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

// v1 API shim — re-exported here so server.cjs can mount the plan's
// /api/pay/x402/{quote,create,confirm} routes without reviving the
// deprecated v1 router above. The shim wraps v2 internals only.
const { mountShimRoutes } = require('./shim_v1_routes.cjs');

module.exports = { router, initPayModule, mountShimRoutes };
