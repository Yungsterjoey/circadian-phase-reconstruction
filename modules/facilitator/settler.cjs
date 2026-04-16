'use strict';

// KURO Facilitator — scheme → rail dispatch

const verifier = require('./verifier.cjs');
const baseRail   = require('./rails/base_usdc.cjs');
const solanaRail = require('./rails/solana_usdc.cjs');
const fiatRail   = require('./rails/fiat_sea.cjs');

const CRYPTO_DISPATCH = {
  'exact-evm-base':   baseRail,
  'exact-svm-solana': solanaRail,
};

function railFor(scheme) {
  if (CRYPTO_DISPATCH[scheme]) return CRYPTO_DISPATCH[scheme];
  if (fiatRail.SCHEME_TO_NETWORK[scheme]) return fiatRail;
  return null;
}

async function settle(payload) {
  if (!verifier.isSupported(payload.scheme)) {
    return {
      success:   false,
      error:     'unsupported_scheme',
      supported: verifier.supportedSchemes(),
    };
  }
  const rail = railFor(payload.scheme);
  if (!rail) {
    return { success: false, error: 'no_rail_adapter' };
  }
  return rail.settle(payload);
}

module.exports = { settle, railFor };
