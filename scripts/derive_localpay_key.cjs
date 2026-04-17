#!/usr/bin/env node
'use strict';

// Local-only. Converts a BIP39 recovery phrase (your LocalPay seed) into
// the base58-encoded Solana secret key for the wallet, and writes it into
// .env under KURO_LOCALPAY_SOL_PRIVKEY — ONLY if the derived public key
// matches the expected wallet address.
//
// Usage:
//   node scripts/derive_localpay_key.cjs
//   (follow the prompt; paste the phrase into the terminal, NOT the chat)
//
// Security:
// - The phrase is read from stdin via readline, never logged, never sent
//   anywhere over the network. Derivation is pure-local crypto.
// - We print only the first 8 chars of the derived pubkey for confirmation.
// - If the derived pubkey does not match EXPECTED_PUBKEY, the script aborts
//   without touching .env.

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const bip39    = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const EXPECTED_PUBKEY = 'AH4hATTwDj9FW6Bzr2m84TL7dKJGtQ9V695mXMoL1D3F';
const ENV_PATH = path.resolve(__dirname, '..', '.env');
const ENV_KEY  = 'KURO_LOCALPAY_SOL_PRIVKEY';

// Solana wallet apps (Phantom, Solflare, LocalPay, Backpack) all use the
// BIP44 Solana path with hardened account index. Most wallets default to
// account 0; we try a few standard paths in order.
const CANDIDATE_PATHS = [
  "m/44'/501'/0'/0'",
  "m/44'/501'/0'",
  "m/44'/501'/1'/0'",
  "m/44'/501'/2'/0'",
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans); });
  });
}

function deriveKeypair(mnemonic, pathStr) {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const { key } = derivePath(pathStr, seed.toString('hex'));
  return Keypair.fromSeed(key);
}

(async () => {
  console.log('\nDerive Solana key from LocalPay recovery phrase');
  console.log('────────────────────────────────────────────────');
  console.log(`Expected wallet: ${EXPECTED_PUBKEY}`);
  console.log('Phrase is read locally, never logged or transmitted.\n');

  const phrase = (await ask('Paste recovery phrase (12 or 24 words): ')).trim();
  if (!bip39.validateMnemonic(phrase)) {
    console.error('\n❌ Invalid BIP39 mnemonic. Check word count and spelling.');
    process.exit(1);
  }

  let match = null;
  for (const p of CANDIDATE_PATHS) {
    const kp = deriveKeypair(phrase, p);
    const pub = kp.publicKey.toBase58();
    console.log(`  ${p.padEnd(22)} → ${pub.slice(0, 8)}...${pub.slice(-4)}`);
    if (pub === EXPECTED_PUBKEY) { match = { path: p, kp }; break; }
  }

  if (!match) {
    console.error(`\n❌ None of the standard derivation paths produced ${EXPECTED_PUBKEY}.`);
    console.error('   The wallet may be on a non-standard path, or this phrase is for');
    console.error('   a different account. Nothing was written.');
    process.exit(2);
  }

  console.log(`\n✓ Match on path ${match.path}`);
  const b58Priv = bs58.encode(match.kp.secretKey);

  const confirm = (await ask(`Write ${ENV_KEY} to ${ENV_PATH}? [y/N]: `)).trim().toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    console.log('Aborted. .env untouched.');
    process.exit(0);
  }

  let envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${ENV_KEY}=${b58Priv}`;
  const re   = new RegExp(`^${ENV_KEY}=.*$`, 'm');
  envText = re.test(envText) ? envText.replace(re, line) : (envText.trimEnd() + '\n' + line + '\n');
  fs.writeFileSync(ENV_PATH, envText, { mode: 0o600 });

  console.log(`\n✓ Wrote ${ENV_KEY} to .env (permissions 0600).`);
  console.log('  Now restart kuro-core:');
  console.log('  set -a && . ./.env && set +a && pm2 restart kuro-core --update-env\n');
})().catch(e => { console.error('Fatal:', e.message); process.exit(3); });
