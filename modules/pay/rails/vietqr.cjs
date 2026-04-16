'use strict';

// VietQR rail adapter — wraps the LIVE v2 flow.
// parse/detect delegate to the proven vietqr_parser.cjs.
// initiate() calls x402_pay.cjs (Stripe + facilitator settlement).
// This is a wrapper, not a rewrite. Identical behaviour to existing production flow.

const parser = require('../vietqr_parser.cjs');
const { validateCRC } = require('../core/emv_crc.cjs');
const registry = require('../core/rail_registry.cjs');

const AID = 'A000000775010111';

// ── Adapter implementation ────────────────────────────────────────

function detect(input) {
  if (!input || typeof input !== 'string') return { matches: false, confidence: 0 };

  const hasAID = input.includes(AID) || (input.includes('A000000775') && !input.includes('A000000775015545'));
  if (!hasAID) return { matches: false, confidence: 0 };

  const crcValid = validateCRC(input);
  let parsed;
  try { parsed = parser.parseEMVQR(input); } catch (_) { return { matches: false, confidence: 0 }; }

  if (parsed.standard !== 'vietqr') return { matches: false, confidence: 0 };

  const confidence = crcValid ? Math.min(0.97, 0.91 + (parsed.bankBin ? 0.04 : 0) + (parsed.accountNumber ? 0.02 : 0)) : 0.4;
  return { matches: true, confidence, parsed };
}

function parse(input) {
  const parsed = parser.parseEMVQR(input);
  return {
    destination: {
      type:          'bank_account',
      bankBin:       parsed.bankBin,
      bankName:      parsed.bankName,
      bankShortName: parsed.bankShortName,
      bankSwift:     parsed.bankSwift,
      accountNumber: parsed.accountNumber,
      country:       'VN',
    },
    displayName: parsed.merchantName || parsed.bankName || 'Vietnam merchant',
    metadata:    { standard: 'vietqr', currency: 'VND', amount: parsed.amount },
  };
}

async function quote({ sourceAmount, sourceCurrency: _sc, destination }) {
  // Indicative: 1 AUD ≈ 16500 VND. Real rate is quoted by facilitator at settlement.
  const indicativeRate = 16500;
  const destinationAmount = parseFloat((sourceAmount * indicativeRate).toFixed(0));
  return {
    fxRate:            indicativeRate,
    destinationAmount,
    destinationCurrency: 'VND',
    fee:               0,
    feeCapped:         false,
    net:               sourceAmount,
    eta:               '< 30s',
    ratesExact:        false,
    note:              'Rate confirmed by facilitator at settlement',
  };
}

async function initiate({ stripePaymentIntentId, destination, userId, amountAUD, amountLocal, reference }) {
  const x402   = require('../x402_pay.cjs');
  const ledger = require('../pay_ledger.cjs');
  const db     = ledger.getDB();

  const fakeQRParsed = {
    standard:      'vietqr',
    bankBin:       destination.bankBin,
    bankName:      destination.bankName,
    bankShortName: destination.bankShortName,
    bankSwift:     destination.bankSwift,
    accountNumber: destination.accountNumber,
    merchantName:  destination.merchantName || '',
    currency:      'VND',
    countryCode:   'VN',
  };

  const paymentRequired  = x402.buildPaymentRequired(fakeQRParsed, amountAUD, amountLocal, stripePaymentIntentId, reference);
  const settlementResult = await x402.verifyPayment(paymentRequired);
  const receipt          = x402.generateReceipt(userId, paymentRequired, settlementResult);

  return {
    payoutId: receipt.receiptId,
    status:   settlementResult.success ? 'settled' : 'pending',
    receipt,
  };
}

async function status(payoutId) {
  const ledger = require('../pay_ledger.cjs');
  const db     = ledger.getDB();
  if (!db) return { status: 'unknown' };
  const row = db.prepare(`SELECT status, settled_at, x402_receipt_json FROM kuro_pay_payments WHERE id=?`).get(payoutId);
  if (!row) return { status: 'not_found' };
  const proof = row.x402_receipt_json ? JSON.parse(row.x402_receipt_json) : null;
  return { status: row.status, settledAt: row.settled_at, proof };
}

const adapter = {
  id:                 'vietqr',
  country:            'VN',
  currency:           'VND',
  identifierTypes:    ['emvco_qr'],
  preferredConnector: 'x402',
  fallbackConnector:  'nium',
  detect, parse, quote, initiate, status,
};

require('../rails/_interface.cjs').validate(adapter);
registry.register(adapter);

module.exports = adapter;
