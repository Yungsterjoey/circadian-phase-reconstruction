'use strict';

// KURO x402 Facilitator — mount entrypoint
// Call from server.cjs:  mountFacilitator(app, auth.required, requireAdmin)

const ledger = require('./ledger.cjs');
const { mountRoutes } = require('./routes.cjs');

function mountFacilitator(app, requireAuth, requireAdmin) {
  ledger.initSchema();

  const gateStatus = [];
  if (!process.env.KURO_FACILITATOR_SECRET) gateStatus.push('KURO_FACILITATOR_SECRET missing (receipt signing disabled)');
  if (!process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX) gateStatus.push('KURO_SOLANA_WALLET_PRIVKEY_HEX missing (Solana rail will fail at settle time)');
  if (gateStatus.length) {
    console.warn('[FACILITATOR]', gateStatus.join('; '));
  }

  mountRoutes(app, requireAuth, requireAdmin);
}

module.exports = { mountFacilitator };
