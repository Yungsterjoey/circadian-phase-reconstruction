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

// ── GPS bounding boxes (ISO country code → {latMin, latMax, lngMin, lngMax}) ─
const GPS_BBOX = {
  VN: { latMin: 8,    latMax: 24,  lngMin: 102, lngMax: 110 },
  TH: { latMin: 5,    latMax: 21,  lngMin: 97,  lngMax: 106 },
  PH: { latMin: 4,    latMax: 21,  lngMin: 116, lngMax: 127 },
  ID: { latMin: -11,  latMax: 6,   lngMin: 95,  lngMax: 141 },
  MY: { latMin: 1,    latMax: 7,   lngMin: 99,  lngMax: 119 },
  SG: { latMin: 1.1,  latMax: 1.5, lngMin: 103, lngMax: 104 },
  KH: { latMin: 10,   latMax: 15,  lngMin: 102, lngMax: 108 },
  LA: { latMin: 13,   latMax: 23,  lngMin: 100, lngMax: 108 },
};

// ── Standard → expected country (for GPS cross-check) ─────────────
const STANDARD_COUNTRY = {
  vietqr:    'VN',
  promptpay: 'TH',
  qris:      'ID',
  duitnow:   'MY',
  qrph:      'PH',
  gcash:     'PH',
  maya:      'PH',
};

function gpsCountryFromCoords(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  for (const iso of Object.keys(GPS_BBOX)) {
    const b = GPS_BBOX[iso];
    if (lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax) {
      return iso;
    }
  }
  return null;
}

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

// ── ATM QR detection ──────────────────────────────────────────────
// Heuristics:
//   1. Tag 62 sub-tag 01 contains 'ATM' or 'CASH' (case-insensitive)
//   2. Merchant name contains 'ATM'
//   3. Account number matches a known ATM pool pattern
//      (Vietnamese major-bank ATM pool accounts begin '9704' with length 11-13)
function detectATM({ addDataSubTag01, merchantName, accountNumber }) {
  const a = (addDataSubTag01 || '').toUpperCase();
  if (a.includes('ATM') || a.includes('CASH')) return true;
  if (merchantName && /\bATM\b/i.test(merchantName)) return true;
  if (accountNumber && /^9704\d{7,9}$/.test(accountNumber)) return true;
  return false;
}

// ── Main parse function ───────────────────────────────────────────
/**
 * Parse an EMVCo QR string.
 * @param {string} qr — raw QR string
 * @param {object} [opts]
 * @param {number} [opts.lat] — device latitude (optional, enables GPS bias)
 * @param {number} [opts.lng] — device longitude (optional, enables GPS bias)
 * @returns {object} parsed result
 */
function parseEMVQR(qr, opts = {}) {
  if (!qr || typeof qr !== 'string') throw new Error('QR must be a non-empty string');
  const { lat, lng } = opts || {};

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
  let addDataSubTag01 = null;
  const addData = tags.get('62');
  if (addData) {
    const addSub = parseTLV(addData);
    reference       = addSub.get('05') || addSub.get('01') || null;
    addDataSubTag01 = addSub.get('01') || null;
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

  // ── Weighted confidence: C = (w1·G + w2·E + w3·V) / (w1 + w2 + w3) ──
  const w1 = 0.3, w2 = 0.4, w3 = 0.3;

  // G — GPS bias
  const gpsCountry      = gpsCountryFromCoords(lat, lng);
  const standardCountry = STANDARD_COUNTRY[standard] || null;
  let G;
  if (gpsCountry == null)              G = 0.5;            // no GPS provided (or unknown region) — neutral
  else if (standardCountry == null)    G = 0.5;            // standard not country-specific — neutral
  else if (gpsCountry === standardCountry) G = 1.0;        // GPS confirms detected standard
  else                                 G = 0.0;            // GPS contradicts detected standard
  const gpsMatch = (gpsCountry != null && standardCountry != null && gpsCountry === standardCountry);

  // E — CRC valid
  const E = crcValid ? 1.0 : 0.0;

  // V — both critical tags 00 (payload format) AND 01 (initiation method) present
  const V = (tags.has('00') && tags.has('01')) ? 1.0 : 0.0;

  const confidence = parseFloat(((w1 * G + w2 * E + w3 * V) / (w1 + w2 + w3)).toFixed(2));

  let routable, flag;
  if (confidence >= 0.85)      { routable = true;  flag = null; }
  else if (confidence >= 0.5)  { routable = false; flag = 'manual_review'; }
  else                         { routable = false; flag = 'unsupported'; }

  if (!routable) warnings.push(`Confidence ${confidence} — ${flag}`);

  // ── QR type classification (merchant | personal | atm) ──
  const isATM = detectATM({ addDataSubTag01, merchantName, accountNumber });
  let qrType;
  if (isATM)                                qrType = 'atm';
  else if (merchantName)                    qrType = 'merchant';
  else                                      qrType = 'personal';

  return {
    standard,
    qrType,
    gpsCountry,
    gpsMatch,
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
    confidence,
    routable,
    flag,
    warnings,
    crcValid,
  };
}

// ── parseQR — public alias with explicit GPS-aware signature ─────
function parseQR(qrString, opts = {}) {
  return parseEMVQR(qrString, opts);
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
  parseQR,
  getBankFromBin,
  isRoutable,
  validateCRC,
  gpsCountryFromCoords,
  VIETQR_BIN_MAP,
  SUPPORTED_COUNTRIES,
  CURRENCY_MAP,
  GPS_BBOX,
  STANDARD_COUNTRY,
};
