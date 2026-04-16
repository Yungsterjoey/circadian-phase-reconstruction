'use strict';

// UNTESTED AGAINST LIVE RAIL — EMVCo structure + CRC verified only.
// First real scan validates real-world compatibility.
//
// PromptPay — Thailand (TH / THB)
// EMVCo country code: 764
// AID: A000000677010111
// Identifier types: mobile number (13-digit with country code), national ID (13-digit),
//                   tax ID (13-digit), e-wallet proxy

const { validateCRC } = require('../core/emv_crc.cjs');
const registry = require('../core/rail_registry.cjs');

const AID = 'A000000677010111';

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

// Extract PromptPay proxy from merchant account info tags 26-45.
// PromptPay sub-tag 01 = phone/NID/tax, sub-tag 02 = tax ID.
function extractProxy(qr) {
  const tags = parseTLV(qr);
  for (let t = 26; t <= 45; t++) {
    const tagId = t.toString().padStart(2, '0');
    const val   = tags.get(tagId);
    if (val && val.includes('A000000677')) {
      const sub = parseTLV(val);
      return sub.get('01') || sub.get('02') || null;
    }
  }
  return null;
}

function detect(input) {
  if (!input || typeof input !== 'string') return { matches: false, confidence: 0 };
  if (!input.includes(AID)) return { matches: false, confidence: 0 };

  const crcValid = validateCRC(input);
  const proxy    = extractProxy(input);

  const baseCRC  = crcValid ? 0.91 : 0.4;
  const proxyBonus = proxy ? 0.07 : 0;
  const confidence = Math.min(0.97, baseCRC + (crcValid ? proxyBonus : 0));

  const parsed = { proxy, country: 'TH', currency: 'THB', standard: 'promptpay' };
  return { matches: true, confidence, parsed };
}

function parse(input) {
  const proxy = extractProxy(input);
  return {
    destination: { type: 'promptpay_proxy', proxy, country: 'TH' },
    displayName: proxy ? `PromptPay: ${proxy}` : 'PromptPay merchant',
    metadata:    { standard: 'promptpay', currency: 'THB' },
  };
}

async function quote({ sourceAmount }) {
  const indicativeRate = 23.5; // 1 AUD ≈ 23.5 THB (indicative)
  return {
    fxRate:              indicativeRate,
    destinationAmount:   parseFloat((sourceAmount * indicativeRate).toFixed(2)),
    destinationCurrency: 'THB',
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
  return callConnector('x402', 'nium', { stripePaymentIntentId, destination, userId, amountAUD, reference, rail: 'promptpay' });
}

async function status(payoutId) {
  const { connectorStatus } = require('./_connector_dispatch.cjs');
  return connectorStatus(payoutId);
}

const adapter = {
  id:                 'promptpay',
  country:            'TH',
  currency:           'THB',
  identifierTypes:    ['emvco_qr', 'promptpay_proxy'],
  preferredConnector: 'x402',
  fallbackConnector:  'nium',
  detect, parse, quote, initiate, status,
};

require('./_interface.cjs').validate(adapter);
registry.register(adapter);

module.exports = adapter;
