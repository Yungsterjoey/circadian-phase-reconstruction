'use strict';

// UNTESTED AGAINST LIVE RAIL — EMVCo structure + CRC verified only.
// First real scan validates real-world compatibility.
//
// DuitNow QR — Malaysia (MY / MYR)
// EMVCo country code: 458
// AID: A000000615020215
// Identifier types: mobile number, NRIC/passport, business registration, virtual account

const { validateCRC } = require('../core/emv_crc.cjs');
const registry = require('../core/rail_registry.cjs');

const AID = 'A000000615020215';

function parseTLV(str) {
  const map = new Map();
  let i = 0;
  while (i + 4 <= str.length) {
    const tag = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > str.length) break;
    map.set(tag, str.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return map;
}

function extractProxy(qr) {
  const tags = parseTLV(qr);
  for (let t = 26; t <= 45; t++) {
    const tagId = t.toString().padStart(2, '0');
    const val   = tags.get(tagId);
    if (val && val.includes(AID)) {
      const sub = parseTLV(val);
      return sub.get('02') || sub.get('01') || null;
    }
  }
  return null;
}

function detect(input) {
  if (!input || typeof input !== 'string') return { matches: false, confidence: 0 };
  if (!input.includes(AID)) return { matches: false, confidence: 0 };

  const crcValid   = validateCRC(input);
  const proxy      = extractProxy(input);
  const baseCRC    = crcValid ? 0.91 : 0.4;
  const proxyBonus = proxy ? 0.07 : 0;
  const confidence = Math.min(0.97, baseCRC + (crcValid ? proxyBonus : 0));

  const tags    = parseTLV(input);
  const merchant = tags.get('59') || null;
  const parsed  = { proxy, merchant, country: 'MY', currency: 'MYR', standard: 'duitnow' };
  return { matches: true, confidence, parsed };
}

function parse(input) {
  const proxy    = extractProxy(input);
  const tags     = parseTLV(input);
  const merchant = tags.get('59') || null;
  return {
    destination: { type: 'duitnow_proxy', proxy, country: 'MY' },
    displayName: merchant || (proxy ? `DuitNow: ${proxy}` : 'DuitNow merchant'),
    metadata:    { standard: 'duitnow', currency: 'MYR' },
  };
}

async function quote({ sourceAmount }) {
  const indicativeRate = 3.05; // 1 AUD ≈ 3.05 MYR (indicative)
  return {
    fxRate:              indicativeRate,
    destinationAmount:   parseFloat((sourceAmount * indicativeRate).toFixed(2)),
    destinationCurrency: 'MYR',
    fee:                 0,
    feeCapped:           false,
    net:                 sourceAmount,
    eta:                 '< 60s',
    ratesExact:          false,
    note:                'Rate confirmed by connector at settlement',
  };
}

async function initiate({ stripePaymentIntentId, destination, userId, amountAUD, reference }) {
  const { callConnector } = require('./_connector_dispatch.cjs');
  return callConnector('x402', 'nium', { stripePaymentIntentId, destination, userId, amountAUD, reference, rail: 'duitnow' });
}

async function status(payoutId) {
  const { connectorStatus } = require('./_connector_dispatch.cjs');
  return connectorStatus(payoutId);
}

const adapter = {
  id:                 'duitnow',
  country:            'MY',
  currency:           'MYR',
  identifierTypes:    ['emvco_qr', 'duitnow_proxy'],
  preferredConnector: 'x402',
  fallbackConnector:  'nium',
  detect, parse, quote, initiate, status,
};

require('./_interface.cjs').validate(adapter);
registry.register(adapter);

module.exports = adapter;
