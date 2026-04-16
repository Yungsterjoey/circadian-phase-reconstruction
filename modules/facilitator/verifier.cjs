'use strict';

// KURO x402 Facilitator — verifier
// Validates scheme support, payload freshness, nonce uniqueness, and
// per-scheme signature. Does NOT perform FX, settlement, or side-effects
// beyond claiming the nonce.
//
// PaymentPayload (x402-native shape, scheme-agnostic fields only):
// {
//   scheme:   string,               // canonical scheme id
//   network:  string,               // 'base' | 'solana' | 'napas247' | ...
//   payer:    string,               // address (0x.. / base58) or rail operator id
//   amount:   string|number,        // settlement amount in rail's smallest unit
//   currency: string,               // 'USDC' | 'VND' | 'THB' | ...
//   recipient:string,               // destination address / merchant handle
//   nonce:    string,               // per-payload unique id (hex or b58)
//   ts:       number,               // unix seconds
//   extra:    object,               // scheme-specific fields
//   signature:string                // hex or b58, per scheme
// }

const crypto                     = require('crypto');
const { secp256k1 }              = require('@noble/curves/secp256k1');
const { keccak_256 }             = require('@noble/hashes/sha3');
const nacl                       = require('tweetnacl');
const bs58                       = require('bs58');

const replay                     = require('./replay.cjs');

const SUPPORTED_CRYPTO_SCHEMES = new Set([
  'exact-evm-base',
  'exact-svm-solana',
]);

const SUPPORTED_FIAT_SCHEMES = new Set([
  'fiat-napas247',
  'fiat-promptpay',
  'fiat-instapay',
  'fiat-duitnow',
  'fiat-bifast',
]);

function supportedSchemes() {
  return [...SUPPORTED_CRYPTO_SCHEMES, ...SUPPORTED_FIAT_SCHEMES];
}

function isSupported(scheme) {
  return SUPPORTED_CRYPTO_SCHEMES.has(scheme) || SUPPORTED_FIAT_SCHEMES.has(scheme);
}

function canonicalJSON(obj) {
  // Stable stringify — keys sorted, excluding `signature`.
  const keys = Object.keys(obj).filter(k => k !== 'signature').sort();
  const entries = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + entries.join(',') + '}';
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function digestMessage(payload) {
  return Buffer.from(canonicalJSON(payload), 'utf8');
}

// ── EVM (Base) signature verification ─────────────────────────────
// The payer string is the 0x-prefixed 20-byte address. Signature is
// 65 bytes hex: r(32) || s(32) || v(1). We recover the pubkey and
// derive the address via keccak256.
function verifyEvmBase(payload) {
  const { payer, signature } = payload;
  if (!/^0x[0-9a-fA-F]{40}$/.test(payer || '')) {
    return { ok: false, reason: 'bad_payer_format' };
  }
  const sigHex = (signature || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{130}$/.test(sigHex)) {
    return { ok: false, reason: 'bad_signature_format' };
  }
  const msg = digestMessage(payload);
  const msgHash = keccak_256(msg);

  const r = BigInt('0x' + sigHex.slice(0, 64));
  const s = BigInt('0x' + sigHex.slice(64, 128));
  let v = parseInt(sigHex.slice(128, 130), 16);
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) return { ok: false, reason: 'bad_recovery_id' };

  let pubKey;
  try {
    const sig = new secp256k1.Signature(r, s).addRecoveryBit(v);
    pubKey = sig.recoverPublicKey(msgHash).toRawBytes(false); // 65 bytes 04||X||Y
  } catch (_) {
    return { ok: false, reason: 'recover_failed' };
  }
  // Ethereum address = last 20 bytes of keccak256(pubkey[1:]).
  const addr = '0x' + Buffer.from(keccak_256(pubKey.slice(1))).slice(-20).toString('hex');
  if (addr.toLowerCase() !== payer.toLowerCase()) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

// ── Solana (Ed25519) signature verification ───────────────────────
function verifySvmSolana(payload) {
  const { payer, signature } = payload;
  let pubKey, sigBytes;
  try {
    pubKey   = bs58.decode(payer);
    sigBytes = bs58.decode(signature);
  } catch (_) {
    return { ok: false, reason: 'bad_base58' };
  }
  if (pubKey.length !== 32)   return { ok: false, reason: 'bad_pubkey_length' };
  if (sigBytes.length !== 64) return { ok: false, reason: 'bad_signature_length' };

  const msg = digestMessage(payload);
  const ok  = nacl.sign.detached.verify(new Uint8Array(msg), sigBytes, pubKey);
  return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

// ── Fiat HMAC-SHA256 receipts from rail operators ─────────────────
// The rail operator shares a symmetric key with us out-of-band. The
// payload.signature is hex(HMAC-SHA256(canonical(payload), key)).
// Keys are looked up via env: KURO_FACILITATOR_RAIL_SECRET_<SCHEME_UPPER>
//   e.g. KURO_FACILITATOR_RAIL_SECRET_FIAT_NAPAS247
function verifyFiatHmac(payload) {
  const envKey = 'KURO_FACILITATOR_RAIL_SECRET_' +
                 payload.scheme.toUpperCase().replace(/-/g, '_');
  const key    = process.env[envKey] || '';
  if (!key) return { ok: false, reason: `rail_secret_missing:${envKey}` };

  const sigHex = (payload.signature || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(sigHex)) {
    return { ok: false, reason: 'bad_hmac_format' };
  }
  const expected = crypto.createHmac('sha256', key)
                         .update(canonicalJSON(payload))
                         .digest('hex');
  const ok = crypto.timingSafeEqual(
    Buffer.from(sigHex,   'hex'),
    Buffer.from(expected, 'hex'),
  );
  return ok ? { ok: true } : { ok: false, reason: 'hmac_mismatch' };
}

function verifySignature(payload) {
  if (SUPPORTED_CRYPTO_SCHEMES.has(payload.scheme)) {
    return payload.scheme === 'exact-evm-base'
      ? verifyEvmBase(payload)
      : verifySvmSolana(payload);
  }
  if (SUPPORTED_FIAT_SCHEMES.has(payload.scheme)) {
    return verifyFiatHmac(payload);
  }
  return { ok: false, reason: 'unsupported_scheme' };
}

// ── Top-level verify ──────────────────────────────────────────────
function verify(payload, _requirements) {
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, invalidReason: 'missing_payload' };
  }
  const { scheme, nonce, ts, payer } = payload;

  if (!scheme || !isSupported(scheme)) {
    return { isValid: false, invalidReason: 'unsupported_scheme', payer };
  }
  if (!nonce || typeof nonce !== 'string') {
    return { isValid: false, invalidReason: 'missing_nonce', payer };
  }
  if (!replay.isFresh(Number(ts))) {
    return { isValid: false, invalidReason: 'stale_or_future_ts', payer };
  }

  const sigCheck = verifySignature(payload);
  if (!sigCheck.ok) {
    return { isValid: false, invalidReason: sigCheck.reason, payer };
  }

  if (!replay.claim(nonce, scheme)) {
    return { isValid: false, invalidReason: 'nonce_replay', payer };
  }
  return { isValid: true, payer };
}

module.exports = {
  verify,
  supportedSchemes,
  isSupported,
  canonicalJSON,
  // exported for unit tests
  _verifyEvmBase:    verifyEvmBase,
  _verifySvmSolana:  verifySvmSolana,
  _verifyFiatHmac:   verifyFiatHmac,
};
