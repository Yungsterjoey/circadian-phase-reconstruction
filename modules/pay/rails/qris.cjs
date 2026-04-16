'use strict';

// UNTESTED AGAINST LIVE RAIL — EMVCo structure + CRC verified only.
// First real scan validates real-world compatibility.
//
// QRIS — Indonesia (ID / IDR)
// EMVCo country code: 360
// AID: A000000775015545
// Note: A000000775 prefix is shared with VietQR (A000000775010111).
// This adapter checks for the FULL QRIS AID to avoid false positives.

const { validateCRC } = require('../core/emv_crc.cjs');
const registry = require('../core/rail_registry.cjs');

const AID = 'A000000775015545';

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

function extractMerchantPAN(qr) {
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

  const crcValid  = validateCRC(input);
  const pan       = extractMerchantPAN(input);
  const baseCRC   = crcValid ? 0.91 : 0.4;
  const panBonus  = pan ? 0.07 : 0;
  const confidence = Math.min(0.97, baseCRC + (crcValid ? panBonus : 0));

  const tags    = parseTLV(input);
  const merchant = tags.get('59') || null;
  const parsed  = { pan, merchant, country: 'ID', currency: 'IDR', standard: 'qris' };
  return { matches: true, confidence, parsed };
}

function parse(input) {
  const pan      = extractMerchantPAN(input);
  const tags     = parseTLV(input);
  const merchant = tags.get('59') || null;
  return {
    destination: { type: 'qris', pan, country: 'ID' },
    displayName: merchant || (pan ? `QRIS: ${pan}` : 'QRIS merchant'),
    metadata:    { standard: 'qris', currency: 'IDR' },
  };
}

async function quote({ sourceAmount }) {
  const indicativeRate = 10300; // 1 AUD ≈ 10,300 IDR (indicative)
  return {
    fxRate:              indicativeRate,
    destinationAmount:   parseFloat((sourceAmount * indicativeRate).toFixed(0)),
    destinationCurrency: 'IDR',
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
  return callConnector('x402', 'nium', { stripePaymentIntentId, destination, userId, amountAUD, reference, rail: 'qris' });
}

async function status(payoutId) {
  const { connectorStatus } = require('./_connector_dispatch.cjs');
  return connectorStatus(payoutId);
}

const adapter = {
  id:                 'qris',
  country:            'ID',
  currency:           'IDR',
  identifierTypes:    ['emvco_qr'],
  preferredConnector: 'x402',
  fallbackConnector:  'nium',
  detect, parse, quote, initiate, status,
};

require('./_interface.cjs').validate(adapter);
registry.register(adapter);

module.exports = adapter;
