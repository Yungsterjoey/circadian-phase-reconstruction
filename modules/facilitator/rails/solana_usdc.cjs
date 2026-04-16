'use strict';

// KURO Facilitator — Solana USDC settler (scheme: exact-svm-solana)
// Signs + broadcasts an SPL-token transfer from the KURO settlement wallet
// to payload.recipient. Secret key lives in KURO_SOLANA_WALLET_PRIVKEY_HEX
// (kuro-secrets.txt — never in .env).

const web3 = require('@solana/web3.js');

const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPC_URL = process.env.KURO_FACILITATOR_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

// SPL Token Program constants — avoid the @solana/spl-token dep.
const TOKEN_PROGRAM_ID            = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC_DECIMALS = 6;

let _connection = null;
let _payer = null;

function connection() {
  if (!_connection) _connection = new web3.Connection(RPC_URL, 'confirmed');
  return _connection;
}

function payer() {
  if (_payer) return _payer;
  const hex = process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX || '';
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) {
    throw new Error('KURO_SOLANA_WALLET_PRIVKEY_HEX missing or malformed (expect 128 hex chars = 64 bytes)');
  }
  _payer = web3.Keypair.fromSecretKey(Buffer.from(hex, 'hex'));
  return _payer;
}

function getATA(owner, mint) {
  return web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// Build a minimal SPL-Token Transfer instruction (TransferChecked, opcode 12).
function transferCheckedIx(source, mint, dest, owner, amountRaw, decimals) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);                  // TransferChecked
  data.writeBigUInt64LE(BigInt(amountRaw), 1);
  data.writeUInt8(decimals, 9);
  return new web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true  },
      { pubkey: mint,   isSigner: false, isWritable: false },
      { pubkey: dest,   isSigner: false, isWritable: true  },
      { pubkey: owner,  isSigner: true,  isWritable: false },
    ],
    data,
  });
}

async function settle(payload) {
  try {
    const conn   = connection();
    const signer = payer();

    if ((payload.currency || '').toUpperCase() !== 'USDC') {
      return { success: false, error: `solana rail only supports USDC, got ${payload.currency}`, network: 'solana' };
    }
    const recipient = new web3.PublicKey(payload.recipient);
    const mint      = new web3.PublicKey(USDC_MINT_MAINNET);

    const srcAta = getATA(signer.publicKey, mint);
    const dstAta = getATA(recipient,        mint);

    // amount: accept either USDC float ("1.25") or raw integer micro-units ("1250000").
    // Payloads should use raw to avoid precision loss.
    const amountRaw = /^\d+$/.test(String(payload.amount))
      ? BigInt(payload.amount)
      : BigInt(Math.round(Number(payload.amount) * 10 ** USDC_DECIMALS));

    const ix = transferCheckedIx(srcAta, mint, dstAta, signer.publicKey, amountRaw, USDC_DECIMALS);
    const tx = new web3.Transaction().add(ix);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(signer);

    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');

    return { success: true, transaction: sig, network: 'solana', payer: signer.publicKey.toBase58() };
  } catch (e) {
    return { success: false, error: e.message, network: 'solana' };
  }
}

module.exports = {
  name:    () => 'exact-svm-solana',
  network: () => 'solana',
  settle,
};
