'use strict';

/**
 * KURO::PAY — VietQR / EMVCo QR Parser
 * Parses EMV TLV QR strings for VietQR, PromptPay, QRIS, DuitNow, QR Ph.
 * Returns structured merchant data and confidence score.
 */

// ── ISO 4217 numeric → alpha ──────────────────────────────────────
const CURRENCY_MAP = {
  '704': 'VND',  // Vietnam
  '764': 'THB',  // Thailand
  '360': 'IDR',  // Indonesia
  '458': 'MYR',  // Malaysia
  '608': 'PHP',  // Philippines
  '702': 'SGD',  // Singapore
  '036': 'AUD',
  '840': 'USD',
  '978': 'EUR',
};

// ── Point of Initiation ───────────────────────────────────────────
const INITIATION = { '11': 'static', '12': 'dynamic' };

// ── Vietnamese bank BIN table (NAPAS official list) ───────────────
const VIETQR_BIN_MAP = {
  '970436': { name: 'Vietcombank',          shortName: 'VCB',   swift: 'BFTVVNVX' },
  '970418': { name: 'BIDV',                  shortName: 'BIDV',  swift: 'BIDVVNVX' },
  '970415': { name: 'VietinBank',            shortName: 'CTG',   swift: 'ICBVVNVX' },
  '970405': { name: 'Agribank',              shortName: 'AGB',   swift: 'VBAAVNVX' },
  '970422': { name: 'MBBank',                shortName: 'MB',    swift: 'MSCBVNVX' },
  '970407': { name: 'Techcombank',           shortName: 'TCB',   swift: 'VTCBVNVX' },
  '970432': { name: 'VPBank',                shortName: 'VPB',   swift: 'VPBKVNVX' },
  '970423': { name: 'TPBank',                shortName: 'TPB',   swift: 'TPBVVNVX' },
  '970431': { name: 'Eximbank',              shortName: 'EIB',   swift: 'EBVIVNVX' },
  '970426': { name: 'MSB',                   shortName: 'MSB',   swift: 'MCOBVNVX' },
  '970441': { name: 'VIB',                   shortName: 'VIB',   swift: 'VIBSVNVX' },
  '970416': { name: 'ACB',                   shortName: 'ACB',   swift: 'ASCBVNVX' },
  '970424': { name: 'Shinhan Vietnam',        shortName: 'SHBVN', swift: 'SHBKVNVX' },
  '970448': { name: 'OCB',                   shortName: 'OCB',   swift: 'ORCOVNVX' },
  '970454': { name: 'VietBank',              shortName: 'VBB',   swift: 'VNTTVNVX' },
  '970433': { name: 'VietCapital Bank',       shortName: 'BVCB',  swift: 'VCBCVNVX' },
  '970440': { name: 'SeABank',               shortName: 'SSB',   swift: 'SEAVVNVX' },
  '970449': { name: 'LPBank',                shortName: 'LPB',   swift: 'LVBKVNVX' },
  '970425': { name: 'ABBank',                shortName: 'ABB',   swift: 'ABBKVNVX' },
  '970452': { name: 'KienlongBank',          shortName: 'KLB',   swift: 'KLBKVNVX' },
  '970458': { name: 'BaoViet Bank',          shortName: 'BAOVIET', swift: 'BVBDVNVX' },
  '970406': { name: 'DongA Bank',            shortName: 'DAB',   swift: 'EACBVNVX' },
  '970442': { name: 'Hong Leong Vietnam',    shortName: 'HLBVN', swift: 'HLBBVNVX' },
  '970457': { name: 'Woori Vietnam',         shortName: 'WVN',   swift: 'HVBKVNVX' },
  '970419': { name: 'NCB',                   shortName: 'NCB',   swift: 'NCBAVNVX' },
  '970403': { name: 'Saigonbank',            shortName: 'SGB',   swift: 'SGTTVNVX' },
  '970429': { name: 'SCB',                   shortName: 'SCB',   swift: 'SACLVNVX' },
  '970437': { name: 'HDBank',                shortName: 'HDB',   swift: 'HDBCVNVX' },
  '970427': { name: 'VietABank',             shortName: 'VAB',   swift: 'VTNAMVNVX' },
  '970428': { name: 'NamABank',              shortName: 'NAB',   swift: 'NAMAVNVX' },
  '970443': { name: 'BVBank',                shortName: 'BVB',   swift: 'BVBVVNVX' },
  '970444': { name: 'CBBank',                shortName: 'CBB',   swift: 'COBBVNVX' },
  '970439': { name: 'PublicBank Vietnam',    shortName: 'PVB',   swift: 'PUBAVNVX' },
  '970434': { name: 'Indovina Bank',         shortName: 'IVB',   swift: 'IDICVNVX' },
  '970456': { name: 'VBSP',                  shortName: 'VBSP',  swift: 'VBSPVNVX' },
  '970462': { name: 'KBank Vietnam',         shortName: 'KBANK', swift: 'KASIVNVX' },
  '970460': { name: 'BanKha',               shortName: 'BK',    swift: '' },
  '970463': { name: 'UBank (VPBank Digital)', shortName: 'UB',   swift: '' },
  '970466': { name: 'CAKE by VPBank',        shortName: 'CAKE',  swift: '' },
  '970464': { name: 'ViettelMoney',          shortName: 'VTM',   swift: '' },
};

// ── Countries served ──────────────────────────────────────────────
const SUPPORTED_COUNTRIES = ['VN', 'TH', 'ID', 'MY', 'PH'];

// ── CRC16-CCITT (poly 0x1021, init 0xFFFF) ────────────────────────
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i);
    for (let b = 0; b < 8; b++) {
      const mix = (crc ^ (byte << (8 + b))) & 0x8000;
      crc = ((crc << 1) & 0xFFFF) ^ (mix ? 0x1021 : 0);
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function validateCRC(qr) {
  const idx = qr.lastIndexOf('6304');
  if (idx < 0) return true; // no CRC tag — some static QRs omit it
  const payload  = qr.slice(0, idx + 4);
  const expected = crc16(payload);
  const actual   = qr.slice(idx + 4, idx + 8).toUpperCase();
  return expected === actual;
}

// ── EMV TLV walker ────────────────────────────────────────────────
// Returns Map of { tag -> value } from a flat TLV string.
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

// ── QR standard detection ─────────────────────────────────────────
function detectStandard(qr) {
  if (qr.includes('A000000775')) return 'vietqr';
  if (qr.includes('A000000677')) return 'promptpay';
  if (qr.includes('ID.CO.QRIS')) return 'qris';
  if (qr.includes('A000000680')) return 'duitnow';
  if (qr.includes('A000000632')) return 'qrph';
  // GCash / Maya deep-links
  if (/gcash\.com/i.test(qr)) return 'gcash';
  if (/paymaya\.com|maya\.ph/i.test(qr)) return 'maya';
  return 'emvco_generic';
}

// ── VietQR merchant account extractor ────────────────────────────
// Tag 26-45: Merchant Account Information (sub-TLV)
// VietQR sub-tags: 00=GUID, 01=bank BIN, 02=account number
function extractVietQRAccount(merchantInfoValue) {
  const sub = parseTLV(merchantInfoValue);
  return {
    bin:     sub.get('01') || null,
    account: sub.get('02') || null,
  };
}

// ── Main parse function ───────────────────────────────────────────
/**
 * Parse an EMVCo QR string.
 * @param {string} qr — raw QR string
 * @returns {object} parsed result
 */
function parseEMVQR(qr) {
  if (!qr || typeof qr !== 'string') throw new Error('QR must be a non-empty string');

  const warnings = [];
  const crcValid = validateCRC(qr);
  if (!crcValid) warnings.push('CRC checksum mismatch — QR may be corrupted');

  const tags    = parseTLV(qr);
  const standard = detectStandard(qr);

  // Initiation method
  const initCode = tags.get('01') || '';
  const isStatic  = initCode === '11';
  const isDynamic = initCode === '12';
  if (!initCode) warnings.push('Missing initiation method tag (01)');

  // Currency
  const currencyCode = tags.get('53') || '';
  const currency     = CURRENCY_MAP[currencyCode] || currencyCode || null;
  if (!currency) warnings.push('Unknown or missing currency tag (53)');

  // Amount (tag 54 — only present in dynamic QRs)
  const amountStr = tags.get('54') || null;
  const amount    = amountStr ? parseFloat(amountStr) : null;

  // Merchant info
  const merchantName = tags.get('59') || null;
  const merchantCity = tags.get('60') || null;
  const countryCode  = tags.get('58') || null;

  // Transaction reference (tag 62, sub-tag 05 = reference label)
  let reference = null;
  const addData = tags.get('62');
  if (addData) {
    const addSub = parseTLV(addData);
    reference = addSub.get('05') || addSub.get('01') || null;
  }

  // Bank account extraction (merchant account info tags 26–45)
  let bankBin      = null;
  let accountNumber = null;
  for (let t = 26; t <= 45; t++) {
    const tagId = t.toString().padStart(2, '0');
    const val   = tags.get(tagId);
    if (!val) continue;
    if (standard === 'vietqr' || val.includes('A000000775')) {
      const acct = extractVietQRAccount(val);
      if (acct.bin)     bankBin       = acct.bin;
      if (acct.account) accountNumber = acct.account;
      break;
    }
    // PromptPay: sub-tag 01 = mobile/NID, sub-tag 02 = tax ID
    if (standard === 'promptpay') {
      const sub = parseTLV(val);
      accountNumber = sub.get('01') || sub.get('02') || accountNumber;
      break;
    }
    // Fallback: try sub-TLV
    const sub = parseTLV(val);
    if (!bankBin)       bankBin       = sub.get('01') || null;
    if (!accountNumber) accountNumber = sub.get('02') || null;
  }

  // Bank lookup
  const bank = bankBin ? (VIETQR_BIN_MAP[bankBin] || null) : null;
  if (bankBin && !bank) warnings.push(`Unknown bank BIN: ${bankBin}`);

  // Confidence score
  let confidence = 0;
  if (bank)           confidence += 0.40;
  if (accountNumber)  confidence += 0.40;
  if (merchantName)   confidence += 0.15;
  if (crcValid)       confidence += 0.05;
  confidence = Math.min(1, confidence);

  if (confidence < 0.5) warnings.push('Low confidence — manual review recommended');

  return {
    standard,
    bankBin:       bankBin       || null,
    bankName:      bank?.name    || null,
    bankShortName: bank?.shortName || null,
    bankSwift:     bank?.swift   || null,
    accountNumber: accountNumber || null,
    merchantName:  merchantName  || null,
    merchantCity:  merchantCity  || null,
    countryCode:   countryCode   || null,
    currency:      currency      || null,
    currencyCode:  currencyCode  || null,
    amount:        amount,
    isStatic:      !isDynamic && amount === null,
    isDynamic:     isDynamic || amount !== null,
    reference:     reference,
    confidence:    parseFloat(confidence.toFixed(2)),
    warnings,
    crcValid,
  };
}

// ── getBankFromBin ────────────────────────────────────────────────
function getBankFromBin(bin) {
  return VIETQR_BIN_MAP[bin] || null;
}

// ── isRoutable ────────────────────────────────────────────────────
// A QR is routable if we know the bank and have an account number.
function isRoutable(parsed) {
  return !!(parsed.bankBin && VIETQR_BIN_MAP[parsed.bankBin] && parsed.accountNumber);
}

module.exports = {
  parseEMVQR,
  getBankFromBin,
  isRoutable,
  validateCRC,
  VIETQR_BIN_MAP,
  SUPPORTED_COUNTRIES,
  CURRENCY_MAP,
};
