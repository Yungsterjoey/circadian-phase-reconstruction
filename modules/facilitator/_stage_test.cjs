'use strict';

// KURO Facilitator — stage tests. Run:
//   node modules/facilitator/_stage_test.cjs
// Prints PASS/FAIL per stage. Non-zero exit on any FAIL.

const crypto = require('crypto');
const nacl   = require('tweetnacl');
const bs58   = require('bs58');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');

// Force in-memory DB overlay before loading facilitator modules.
process.env.KURO_FACILITATOR_SECRET = process.env.KURO_FACILITATOR_SECRET || 'test-secret-' + crypto.randomBytes(8).toString('hex');

const verifier = require('./verifier.cjs');
const settler  = require('./settler.cjs');
const ledger   = require('./ledger.cjs');
const replay   = require('./replay.cjs');

let fails = 0;
function stage(name, ok, info) {
  const tag = ok ? 'PASS' : 'FAIL';
  if (!ok) fails++;
  console.log(`${tag}  ${name}${info ? '  — ' + info : ''}`);
}

// ── 1. schema ─────────────────────────────────────────────────────
try {
  ledger.initSchema();
  const db = require('../../layers/auth/db.cjs').db;
  const hasEvents = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='kuro_facilitator_events'`).get();
  const hasNonces = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='kuro_facilitator_nonces'`).get();
  stage('schema', !!hasEvents && !!hasNonces, `events=${!!hasEvents} nonces=${!!hasNonces}`);
} catch (e) {
  stage('schema', false, e.message);
}

// ── 2. verifier (Solana Ed25519 roundtrip) ────────────────────────
try {
  const kp = nacl.sign.keyPair();
  const payer = bs58.encode(Buffer.from(kp.publicKey));
  const payload = {
    scheme:    'exact-svm-solana',
    network:   'solana',
    payer,
    amount:    '1250000',
    currency:  'USDC',
    recipient: payer,
    nonce:     crypto.randomBytes(16).toString('hex'),
    ts:        Math.floor(Date.now() / 1000),
    extra:     { reference: 'stage-test' },
  };
  const msg = Buffer.from(verifier.canonicalJSON(payload), 'utf8');
  const sig = nacl.sign.detached(new Uint8Array(msg), kp.secretKey);
  payload.signature = bs58.encode(Buffer.from(sig));
  const v = verifier.verify(payload);
  stage('verifier', v.isValid === true, v.invalidReason || 'ed25519 ok');
} catch (e) {
  stage('verifier', false, e.message);
}

// ── 3. verifier (EVM secp256k1 roundtrip) ─────────────────────────
try {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub  = secp256k1.getPublicKey(priv, false); // 65 bytes 04||X||Y
  const addr = '0x' + Buffer.from(keccak_256(pub.slice(1))).slice(-20).toString('hex');
  const payload = {
    scheme:    'exact-evm-base',
    network:   'base',
    payer:     addr,
    amount:    '1250000',
    currency:  'USDC',
    recipient: addr,
    nonce:     crypto.randomBytes(16).toString('hex'),
    ts:        Math.floor(Date.now() / 1000),
  };
  const msg  = Buffer.from(verifier.canonicalJSON(payload), 'utf8');
  const hash = keccak_256(msg);
  const sig  = secp256k1.sign(hash, priv);
  const sigHex = sig.toCompactHex() + sig.recovery.toString(16).padStart(2, '0');
  payload.signature = '0x' + sigHex;
  const v = verifier.verify(payload);
  stage('verifier-evm', v.isValid === true, v.invalidReason || 'secp256k1 ok');
} catch (e) {
  stage('verifier-evm', false, e.message);
}

// ── 4. settler-crypto (Solana not provisioned privkey → error surfaces)
(async () => {
  try {
    const origKey = process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX;
    process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX = '';
    const r = await settler.settle({
      scheme: 'exact-svm-solana', network: 'solana',
      payer: 'ArxUF4Tes48MQV7WQtuG7Xh23Uqq3ufJCdSPahPsJQz2',
      amount: '1', currency: 'USDC',
      recipient: 'ArxUF4Tes48MQV7WQtuG7Xh23Uqq3ufJCdSPahPsJQz2',
      nonce: 'n', ts: 0,
    });
    process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX = origKey;
    stage('settler-crypto', r.success === false && /PRIVKEY|missing|malformed/i.test(r.error || ''), r.error);
  } catch (e) {
    stage('settler-crypto', false, e.message);
  }

  // ── 5. settler-fiat-stub (no rail env → not provisioned) ─────────
  try {
    const r = await settler.settle({
      scheme: 'fiat-napas247', amount: '1000000', currency: 'VND',
      recipient: '9704000000000000', nonce: 'n2', ts: 0,
    });
    stage('settler-fiat-stub', r.success === false && /not_provisioned|unsupported/.test(r.error || ''), r.error);
  } catch (e) {
    stage('settler-fiat-stub', false, e.message);
  }

  // ── 6. replay (same nonce twice = second rejected) ──────────────
  try {
    const n = crypto.randomBytes(16).toString('hex');
    const first  = replay.claim(n, 'test');
    const second = replay.claim(n, 'test');
    stage('replay', first === true && second === false, `first=${first} second=${second}`);
  } catch (e) {
    stage('replay', false, e.message);
  }

  // ── 7. idempotency (same key on settle ledger is unique) ────────
  try {
    const key = 'idem-' + crypto.randomBytes(8).toString('hex');
    const id1 = ledger.recordSettle({
      scheme: 'exact-svm-solana', idempotencyKey: key,
      payer: 'p', status: 'ok', payload: {a:1}, requestTs: 0,
    });
    let dupThrew = false;
    try {
      ledger.recordSettle({
        scheme: 'exact-svm-solana', idempotencyKey: key,
        payer: 'p', status: 'ok', payload: {a:2}, requestTs: 0,
      });
    } catch (_) { dupThrew = true; }
    const found = ledger.findByIdempotencyKey(key);
    stage('idempotency', !!id1 && dupThrew && found?.id === id1, `id1=${id1} dup_threw=${dupThrew}`);
  } catch (e) {
    stage('idempotency', false, e.message);
  }

  // ── 8. mount (index exports mountFacilitator fn) ────────────────
  try {
    const mod = require('./index.cjs');
    stage('mount', typeof mod.mountFacilitator === 'function');
  } catch (e) {
    stage('mount', false, e.message);
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL(S)`);
  process.exit(fails === 0 ? 0 : 1);
})();
