'use strict';

const axios = require('axios');

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const RPC_URL = process.env.XMR_RPC_URL || '';
const RPC_USER = process.env.XMR_RPC_USER || '';
const RPC_PASS = process.env.XMR_RPC_PASS || '';
const MOCK = !RPC_URL;

const PICONERO = 1_000_000_000_000; // 1 XMR = 10^12 piconero

let xmrOnline = false;

/* ------------------------------------------------------------------ */
/*  Mock data                                                         */
/* ------------------------------------------------------------------ */

const MOCK_ADDRESS = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRJ5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';
const MOCK_BALANCE = 2_500_000_000_000; // 2.5 XMR in piconero

const MOCK_TRANSFERS = {
  in: [
    {
      txid: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
      amount: 1_000_000_000_000,
      height: 3100000,
      timestamp: 1709100000,
      confirmations: 150,
      type: 'in',
    },
  ],
  out: [
    {
      txid: '11223344556677881122334455667788112233445566778811223344556677aa',
      amount: 500_000_000_000,
      fee: 30_000_000,
      height: 3099500,
      timestamp: 1709050000,
      confirmations: 650,
      type: 'out',
    },
  ],
  pending: [],
};

/* ------------------------------------------------------------------ */
/*  JSON-RPC helper                                                   */
/* ------------------------------------------------------------------ */

async function rpcCall(method, params = {}) {
  if (MOCK) return mockRpc(method, params);

  const config = {
    method: 'POST',
    url: `${RPC_URL}/json_rpc`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      jsonrpc: '2.0',
      id: '0',
      method,
      params,
    },
  };

  if (RPC_USER) {
    config.auth = { username: RPC_USER, password: RPC_PASS };
  }

  const { data } = await axios(config);

  if (data.error) {
    throw new Error(`XMR RPC error ${data.error.code}: ${data.error.message}`);
  }

  return data.result;
}

function mockRpc(method, params) {
  switch (method) {
    case 'get_balance':
      return {
        balance: MOCK_BALANCE,
        unlocked_balance: MOCK_BALANCE,
        multisig_import_needed: false,
      };
    case 'get_address':
      return {
        address: MOCK_ADDRESS,
        addresses: [{ address: MOCK_ADDRESS, address_index: 0, label: 'Primary', used: true }],
      };
    case 'transfer':
      return {
        amount: params.destinations?.[0]?.amount || 0,
        fee: 30_000_000,
        tx_hash: 'mock_tx_' + Date.now().toString(16),
        tx_key: 'mock_key_' + Date.now().toString(16),
      };
    case 'get_transfers':
      return MOCK_TRANSFERS;
    case 'validate_address':
      return {
        valid: typeof params.address === 'string' && params.address.length >= 95,
        integrated: false,
        subaddress: false,
        nettype: 'mainnet',
        openalias_address: '',
      };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Init: test connection                                             */
/* ------------------------------------------------------------------ */

async function init() {
  if (MOCK) {
    xmrOnline = false;
    return;
  }

  try {
    await rpcCall('get_version');
    xmrOnline = true;
  } catch {
    xmrOnline = false;
  }
}

// Fire-and-forget init on load
init().catch(() => {});

/* ------------------------------------------------------------------ */
/*  Exported functions                                                */
/* ------------------------------------------------------------------ */

function offlineGuard() {
  if (!MOCK && !xmrOnline) return { error: 'XMR_OFFLINE' };
  return null;
}

async function getBalance() {
  const guard = offlineGuard();
  if (guard) return guard;
  return rpcCall('get_balance', { account_index: 0 });
}

async function getPrimaryAddress() {
  const guard = offlineGuard();
  if (guard) return guard;
  return rpcCall('get_address', { account_index: 0 });
}

async function transfer(address, amountPiconero, priority = 1) {
  const guard = offlineGuard();
  if (guard) return guard;

  return rpcCall('transfer', {
    destinations: [{ amount: amountPiconero, address }],
    priority,
    ring_size: 16,
    get_tx_key: true,
  });
}

async function getTransfers() {
  const guard = offlineGuard();
  if (guard) return guard;

  return rpcCall('get_transfers', {
    in: true,
    out: true,
    pending: true,
    account_index: 0,
  });
}

async function validateAddress(address) {
  const guard = offlineGuard();
  if (guard) return guard;
  return rpcCall('validate_address', { address });
}

function isOnline() {
  return xmrOnline;
}

module.exports = {
  rpcCall,
  getBalance,
  getPrimaryAddress,
  transfer,
  getTransfers,
  validateAddress,
  isOnline,
  MOCK,
  PICONERO,
};
