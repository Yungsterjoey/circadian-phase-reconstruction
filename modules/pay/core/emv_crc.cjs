'use strict';

// CRC-CCITT 0x1021, init 0xFFFF — standard for EMVCo QR payloads.
// Tag 63 (4 bytes) in EMVCo carries a 4-hex-digit CRC over everything up to
// and including the tag+length fields of tag 63 itself (i.e. "6304").
// This implementation matches the algorithm in vietqr_parser.cjs exactly.

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

// Returns true if the CRC tag is absent (some static QRs omit it — treated as valid)
// or if the computed CRC matches the embedded value.
function validateCRC(qr) {
  const idx = qr.lastIndexOf('6304');
  if (idx < 0) return true;
  const payload  = qr.slice(0, idx + 4);
  const expected = crc16(payload);
  const actual   = qr.slice(idx + 4, idx + 8).toUpperCase();
  return expected === actual;
}

// Flip one bit in the CRC suffix — useful for generating known-bad test vectors.
function corruptCRC(qr) {
  const idx = qr.lastIndexOf('6304');
  if (idx < 0) return qr;
  const suffix = qr.slice(idx + 4, idx + 8);
  const flipped = ((parseInt(suffix, 16) ^ 0x0001) & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  return qr.slice(0, idx + 4) + flipped + qr.slice(idx + 8);
}

module.exports = { crc16, validateCRC, corruptCRC };
