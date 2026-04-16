'use strict';

// KURO Facilitator — Base USDC settler (scheme: exact-evm-base)
// STUB: Base EVM signer is not yet provisioned. Returns a
// deterministic NOT_PROVISIONED error so /settle fails loudly
// instead of silently misbehaving. See roadmap flag #4.

const SIGNER_KEY = process.env.KURO_FACILITATOR_BASE_PRIVKEY_HEX || '';
const RPC_URL    = process.env.KURO_FACILITATOR_BASE_RPC        || '';

async function settle(payload) {
  if (!SIGNER_KEY || !RPC_URL) {
    return {
      success: false,
      network: 'base',
      error:   'base_usdc_rail_not_provisioned',
    };
  }
  // TODO: implement once EVM signer is provisioned. Deliberately left
  // unimplemented rather than mocked — CLAUDE.md §10 (no silent mocks).
  return {
    success: false,
    network: 'base',
    error:   'base_usdc_rail_unimplemented',
  };
}

module.exports = {
  name:    () => 'exact-evm-base',
  network: () => 'base',
  settle,
};
