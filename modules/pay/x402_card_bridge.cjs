'use strict';

/**
 * KURO::PAY x402 Card Bridge
 * Links Aus debit card → USDC on Solana → local currency payout
 * Zero pre-load. Card charged at moment of payment.
 *
 * QR standards supported:
 *   VietQR      — EMVCo AID A000000775  (VND, Vietnam)
 *   QR Ph       — EMVCo AID A000000632  (PHP, Philippines interbank)
 *   GCash       — URL deep-link         (PHP, Philippines)
 *   Maya        — URL deep-link         (PHP, Philippines)
 *   PromptPay   — EMVCo AID A000000677  (THB, Thailand)
 *   DuitNow     — EMVCo AID A000000680  (MYR, Malaysia)
 *   QRIS        — EMVCo ID.CO.QRIS      (IDR, Indonesia)
 */

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────
const SOLANA_RPC             = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const USDC_MINT              = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC SPL mainnet
const KURO_COMMISSION_RATE   = 0.012; // 1.2% per transaction
const KURO_SETTLEMENT_WALLET = process.env.KURO_SOLANA_WALLET;

// ── CRC16/CCITT (EMVCo QR checksum) ───────────────────────────────
/**
 * Compute CRC16-CCITT (poly 0x1021, init 0xFFFF) over a string.
 * EMVCo QR spec §8.2 — applied to all bytes before tag 63.
 * @param {string} str
 * @returns {string} 4-char uppercase hex
 */
function crc16ccitt(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i);
    for (let b = 0; b < 8; b++) {
      const mixed = (crc ^ (byte << (8 + b))) & 0x8000;
      crc = ((crc << 1) & 0xFFFF) ^ (mixed ? 0x1021 : 0);
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Validate EMVCo CRC. Returns true if valid or if CRC tag absent.
 * @param {string} qr — full QR string
 */
function validateEMVCoCRC(qr) {
  const crcIdx = qr.lastIndexOf('6304');
  if (crcIdx < 0) return true; // No CRC tag — skip (some static QRs omit it)
  const payload  = qr.slice(0, crcIdx + 4); // Include tag+length of CRC field
  const expected = crc16ccitt(payload);
  const actual   = qr.slice(crcIdx + 4, crcIdx + 8).toUpperCase();
  return expected === actual;
}

// ── TLV parser ─────────────────────────────────────────────────────
/**
 * Walk an EMVCo TLV string. Returns a Map<tag, value[]> to handle
 * duplicate tags (e.g., multiple tag-26 entries in some QRs).
 * Bounds-checked — throws on malformed input.
 *
 * @param {string} str — TLV string
 * @returns {Map<string, string[]>}
 */
function parseTLV(str) {
  const map = new Map();
  let i = 0;
  while (i < str.length) {
    if (i + 4 > str.length) break; // Not enough bytes for tag+length
    const tag = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > str.length) break; // Malformed
    const val = str.slice(i + 4, i + 4 + len);
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag).push(val);
    i += 4 + len;
  }
  return map;
}

/**
 * Get first value for a tag (compatibility helper).
 * @param {Map} map
 * @param {string} tag
 * @returns {string|null}
 */
function tlvGet(map, tag) {
  const vals = map.get(tag);
  return vals && vals.length > 0 ? vals[0] : null;
}

// ── Currency map (ISO 4217 numeric → alpha) ────────────────────────
const CURRENCY_MAP = {
  '704': 'VND',
  '360': 'IDR',
  '764': 'THB',
  '608': 'PHP',
  '458': 'MYR',
  '840': 'USD',
  '036': 'AUD',
};

// ── EMVCo standard detector ────────────────────────────────────────
/**
 * Detect the specific national standard from an EMVCo QR.
 * Checks tag-26 and tag-38 (bilateral merchant info) for known AIDs.
 * @param {string} qr
 * @returns {'vietqr'|'qrph'|'promptpay'|'duitnow'|'qris'|'emvco_generic'}
 */
function detectEMVCoStandard(qr) {
  // VietQR — AID A000000775
  if (qr.includes('A000000775')) return 'vietqr';
  // QRIS (Indonesia) — MUST come before QR Ph: A000000632010395 contains A000000632
  if (qr.includes('ID.CO.QRIS') || qr.includes('A000000632010395')) return 'qris';
  // QR Ph (InstaPay/PESONet) — AID A000000632
  if (qr.includes('A000000632')) return 'qrph';
  // PromptPay (individual CT21 or corporate CT14)
  if (qr.includes('A000000677010111') || qr.includes('A000000677010114') ||
      qr.includes('A000000677010115')) return 'promptpay';
  // DuitNow (Malaysia)
  if (qr.includes('A000000680') || qr.includes('DuitNow')) return 'duitnow';
  return 'emvco_generic';
}

// ── Sub-tag extractors ─────────────────────────────────────────────
/**
 * Extract VietQR destination from tag-26 sub-TLV.
 * Sub-tags: 00=AID, 01=bank BIN (6 digits), 02=account number.
 * @param {string} tag26val — raw value of tag 26
 * @returns {{ aidVariant: string|null, bankBin: string|null, accountNumber: string|null }}
 */
function extractVietQRTag26(tag26val) {
  const sub = parseTLV(tag26val);
  return {
    aidVariant:    tlvGet(sub, '00'),
    bankBin:       tlvGet(sub, '01'),
    accountNumber: tlvGet(sub, '02'),
  };
}

/**
 * Extract PromptPay destination from tag-26 sub-TLV.
 * Sub-tags: 00=AID, 01=destination (phone or tax ID).
 * Phone: +66XXXXXXXXX → national billing number
 * Tax ID: 13-digit corporation identifier
 * @param {string} tag26val
 * @returns {{ aidVariant: string|null, destination: string|null, destType: 'phone'|'taxid'|'unknown' }}
 */
function extractPromptPayTag26(tag26val) {
  const sub  = parseTLV(tag26val);
  const aid  = tlvGet(sub, '00');
  const dest = tlvGet(sub, '01') || tlvGet(sub, '02');
  let destType = 'unknown';
  if (dest) {
    if (/^\+?66\d{9}$/.test(dest) || /^0\d{9}$/.test(dest) || /^006\d{9}$/.test(dest)) destType = 'phone';
    else if (/^\d{13}$/.test(dest)) destType = 'taxid';
  }
  return { aidVariant: aid, destination: dest, destType };
}

/**
 * Extract QR Ph destination from tag-26 sub-TLV.
 * Sub-tags: 00=AID, 01=mobile number or account, 02=reference.
 */
function extractQRPhTag26(tag26val) {
  const sub = parseTLV(tag26val);
  return {
    aidVariant:    tlvGet(sub, '00'),
    mobileOrAcct:  tlvGet(sub, '01'),
    reference:     tlvGet(sub, '02'),
  };
}

// ── Core EMVCo parser ──────────────────────────────────────────────
/**
 * Parse an EMVCo TLV QR string into a structured object.
 * Validates CRC. Extracts sub-tags for known standards.
 *
 * @param {string} qr
 * @param {'vietqr'|'qrph'|'promptpay'|'duitnow'|'qris'|'emvco_generic'} standard
 * @returns {object}
 */
function parseEMVCo(qr, standard) {
  if (!validateEMVCoCRC(qr)) {
    throw new Error(`CRC validation failed for ${standard} QR — data may be corrupted`);
  }

  const tags = parseTLV(qr);

  // Collect all tag-26 instances (some QRs have multiple)
  const merchantInfoTags = tags.get('26') || [];

  // Base result
  const result = {
    standard,
    merchantName: tlvGet(tags, '59'),
    merchantCity: tlvGet(tags, '60'),
    amount:       tlvGet(tags, '54') ? parseFloat(tlvGet(tags, '54')) : null,
    currencyCode: tlvGet(tags, '53'),
    currency:     CURRENCY_MAP[tlvGet(tags, '53')] || tlvGet(tags, '53'),
    countryCode:  tlvGet(tags, '58'),
    reference:    tlvGet(tags, '05') || tlvGet(tags, '62'), // additional data
    crcValid:     true,
    raw_tags:     Object.fromEntries([...tags.entries()].map(([k, v]) => [k, v.length === 1 ? v[0] : v])),
  };

  // Standard-specific sub-tag extraction
  if (standard === 'vietqr' && merchantInfoTags.length > 0) {
    result.vietqr = extractVietQRTag26(merchantInfoTags[0]);
    if (merchantInfoTags.length > 1) {
      result.vietqr_secondary = extractVietQRTag26(merchantInfoTags[1]);
    }
  }

  if (standard === 'promptpay' && merchantInfoTags.length > 0) {
    result.promptpay = extractPromptPayTag26(merchantInfoTags[0]);
  }

  if (standard === 'qrph' && merchantInfoTags.length > 0) {
    result.qrph = extractQRPhTag26(merchantInfoTags[0]);
  }

  return result;
}

// ── GCash parser ───────────────────────────────────────────────────
/**
 * Parse GCash URL QR code.
 * Supports: https://pay.gcash.com/..., https://gcash.com/pay/...,
 *           gcash://pay?...
 */
function parseGCash(rawQR) {
  // Normalise gcash:// deep-link to https for URL parsing
  const normalized = rawQR.replace(/^gcash:\/\//i, 'https://gcash.fake/');
  let u;
  try { u = new URL(normalized); }
  catch (_) { return { standard: 'gcash', raw_url: rawQR, merchantName: null, amount: null, currency: '608', gcash_ref: null }; }

  return {
    standard:     'gcash',
    merchantName: u.searchParams.get('merchant') || u.searchParams.get('name') || null,
    amount:       u.searchParams.get('amount') ? parseFloat(u.searchParams.get('amount')) : null,
    currency:     '608', // PHP
    currencyCode: '608',
    countryCode:  'PH',
    gcash_ref:    u.searchParams.get('ref') || u.searchParams.get('qr') || null,
    raw_url:      rawQR,
  };
}

// ── Maya parser ────────────────────────────────────────────────────
function parseMaya(rawQR) {
  const normalized = rawQR.replace(/^maya:\/\//i, 'https://maya.fake/');
  let u;
  try { u = new URL(normalized); }
  catch (_) { return { standard: 'maya', raw_url: rawQR, merchantName: null, amount: null, currency: '608', maya_ref: null }; }

  return {
    standard:     'maya',
    merchantName: u.searchParams.get('merchant') || u.searchParams.get('name') || null,
    amount:       u.searchParams.get('amount') ? parseFloat(u.searchParams.get('amount')) : null,
    currency:     '608',
    currencyCode: '608',
    countryCode:  'PH',
    maya_ref:     u.searchParams.get('ref') || u.pathname.split('/').filter(Boolean).pop() || null,
    raw_url:      rawQR,
  };
}

// ── DuitNow parser ─────────────────────────────────────────────────
function parseDuitNow(qr) {
  const standard = 'duitnow';
  if (/^000201/.test(qr)) {
    return parseEMVCo(qr, standard);
  }
  // Fallback: plain text DuitNow (less common)
  return { standard, raw: qr, currency: '458', currencyCode: '458' };
}

// ── Master QR dispatcher ───────────────────────────────────────────
/**
 * Parse any supported Southeast Asian QR code.
 *
 * @param {string} rawQR
 * @returns {object} Parsed QR with { standard, merchantName, amount, currency, ... }
 * @throws {Error} If QR format is unrecognised or CRC fails
 */
function parseQR(rawQR) {
  if (!rawQR || typeof rawQR !== 'string') throw new Error('Invalid QR input');
  const qr = rawQR.trim();

  // ── EMVCo family (starts with 000201) ──
  if (/^000201/.test(qr)) {
    const standard = detectEMVCoStandard(qr);
    return parseEMVCo(qr, standard);
  }

  // ── PromptPay (AID check without 000201 prefix — some app-rendered QRs) ──
  if (qr.includes('A000000677010111') || qr.includes('A000000677010114') ||
      qr.includes('A000000677010115')) {
    return parseEMVCo(qr, 'promptpay');
  }

  // ── GCash URL formats ──
  if (/^https?:\/\/(pay\.|www\.)?gcash\.com/i.test(qr) || /^gcash:\/\//i.test(qr)) {
    return parseGCash(qr);
  }

  // ── Maya/PayMaya URL formats ──
  if (/^https?:\/\/(www\.)?maya\.ph/i.test(qr) || /^maya:\/\//i.test(qr) ||
      /^https?:\/\/(www\.)?paymaya\.com/i.test(qr)) {
    return parseMaya(qr);
  }

  // ── DuitNow non-EMVCo format ──
  if (qr.includes('A000000680') || /duitnow/i.test(qr)) {
    return parseDuitNow(qr);
  }

  throw new Error(`Unrecognised QR standard — not EMVCo/VietQR/QR Ph/PromptPay/GCash/Maya/DuitNow`);
}

// ── Stripe: create payment intent (card charge) ────────────────────
async function stripeCreateIntent({ amountAUD, userId, paymentMethodId, metadata }) {
  const stripe      = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const amountCents = Math.round(amountAUD * 100);
  const intent      = await stripe.paymentIntents.create({
    amount:         amountCents,
    currency:       'aud',
    payment_method: paymentMethodId,
    confirm:        true,
    return_url:     (process.env.KURO_BASE_URL || 'http://localhost:3000') + '/api/pay/x402/return',
    metadata:       { userId, ...metadata },
  });
  return intent;
}

// ── Coinbase Commerce: AUD → USDC charge ──────────────────────────
async function coinbaseCreateCharge({ amountUSD, userId, description }) {
  const resp = await fetch('https://api.commerce.coinbase.com/charges', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-CC-Api-Key':  process.env.COINBASE_COMMERCE_KEY,
      'X-CC-Version':  '2018-03-22',
    },
    body: JSON.stringify({
      name:          'KURO::PAY',
      description,
      pricing_type:  'fixed_price',
      local_price:   { amount: amountUSD.toFixed(2), currency: 'USD' },
      metadata:      { userId },
    }),
  });
  if (!resp.ok) throw new Error('Coinbase Commerce charge creation failed: ' + resp.status);
  return resp.json();
}

// ── Solana: verify USDC tx confirmation ───────────────────────────
async function verifySolanaUSDCTx(txSignature, expectedAmountUSDC) {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const tx = await connection.getTransaction(txSignature, {
    commitment:                     'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx)         throw new Error('Transaction not found on-chain');
  if (tx.meta.err) throw new Error('Transaction failed on-chain');
  // Verify USDC mint is involved
  const accountKeys = tx.transaction.message.getAccountKeys();
  const keys        = accountKeys.staticAccountKeys.map(k => k.toBase58());
  if (!keys.includes(USDC_MINT)) throw new Error('USDC mint not involved in tx');
  return { confirmed: true, slot: tx.slot, blockTime: tx.blockTime };
}

// ── FX rate fetch (mid-market) ─────────────────────────────────────
async function getFXRate(fromCurrency, toCurrency) {
  const resp = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
  if (!resp.ok) throw new Error('FX rate fetch failed');
  const data = await resp.json();
  if (!data.rates[toCurrency]) throw new Error(`No rate for ${toCurrency}`);
  return data.rates[toCurrency];
}

// ── Commission calculation ─────────────────────────────────────────
function calcCommission(grossAUD) {
  const commission = grossAUD * KURO_COMMISSION_RATE;
  const net        = grossAUD - commission;
  return { grossAUD, commission, net, rate: KURO_COMMISSION_RATE };
}

module.exports = {
  parseQR,
  parseEMVCo,
  validateEMVCoCRC,
  parseTLV,
  CURRENCY_MAP,
  stripeCreateIntent,
  coinbaseCreateCharge,
  verifySolanaUSDCTx,
  getFXRate,
  calcCommission,
};
