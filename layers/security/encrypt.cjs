'use strict';
/**
 * KURO::Encrypt — Phase 8 Enterprise Hardening, Commit 4
 *
 * AES-256-GCM symmetric encryption for at-rest data.
 *
 * Feature flags:
 *   KURO_ENCRYPT_AT_REST=true   — enable encryption (default: off)
 *   KURO_ENCRYPT_KEY            — 64-char hex string (32 bytes = 256-bit key)
 *
 * If KURO_ENCRYPT_AT_REST is false, encrypt/decrypt are transparent no-ops
 * so callers need not branch on the flag.
 *
 * Wire format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 * All parts are hex-encoded; the separator is ':'.
 */

const crypto = require('crypto');

const ENABLED   = (process.env.KURO_ENCRYPT_AT_REST ?? 'false').toLowerCase() === 'true';
const KEY_HEX   = process.env.KURO_ENCRYPT_KEY || '';
const ALGO      = 'aes-256-gcm';
const IV_BYTES  = 12; // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;

// ── Key validation ────────────────────────────────────────────────────────────
let _key = null;

function _getKey() {
  if (_key) return _key;
  if (!ENABLED) return null;
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error(
      'KURO_ENCRYPT_AT_REST=true requires KURO_ENCRYPT_KEY to be a 64-char hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  _key = Buffer.from(KEY_HEX, 'hex');
  return _key;
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 string.
 * Returns the original string unchanged if encryption is disabled.
 * @param {string} plaintext
 * @returns {string}
 */
function encrypt(plaintext) {
  if (!ENABLED) return plaintext;
  const key = _getKey();
  const iv  = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

/**
 * Decrypt a string produced by encrypt().
 * Returns the original string unchanged if encryption is disabled.
 * Throws on tampered / malformed ciphertext.
 * @param {string} ciphertext
 * @returns {string}
 */
function decrypt(ciphertext) {
  if (!ENABLED) return ciphertext;
  const key = _getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload: expected iv:tag:ct');
  const [ivHex, tagHex, ctHex] = parts;
  const iv      = Buffer.from(ivHex,  'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const ct      = Buffer.from(ctHex,  'hex');
  if (iv.length !== IV_BYTES)  throw new Error('Invalid IV length');
  if (tag.length !== TAG_BYTES) throw new Error('Invalid auth tag length');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Convenience: encrypt an object as JSON.
 * @param {*} obj
 * @returns {string}
 */
function encryptJson(obj) {
  return encrypt(JSON.stringify(obj));
}

/**
 * Convenience: decrypt and parse JSON.
 * @param {string} ciphertext
 * @returns {*}
 */
function decryptJson(ciphertext) {
  return JSON.parse(decrypt(ciphertext));
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson, ENABLED };
