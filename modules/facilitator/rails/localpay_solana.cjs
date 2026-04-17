'use strict';

// KURO Facilitator — LocalPay-pattern Solana USDT rail.
// Replicates on-chain what the LocalPay mobile app does when paying a VN
// merchant: send USDT on Solana to the merchant's LocalPay settlement
// address, plus a small fee transfer to LocalPay's fee collector. LocalPay's
// off-chain infra picks up the deposit and pushes VND over NAPAS to the
// merchant's bank account — no API call from us, just a signed SPL transfer.
//
// Reference tx (mart downstairs, HDBank 025704070057555):
//   3NTi1hydtZ1XoLKmoCx2tWsWDA3p4Q2Vwg2D4ukbRhDgQPFxxzXHYFUmjvzn2ShGMMxakFX4MfDXaDTpWTWWzD3C
// From that tx:
//   settlement → 6wKZjEWkPxo5fRbfD1t1k2ZC2dj3gJygf2zZX7FXkgM5 (95% of USDT)
//   fee        → EptTb2YUJGV8LwXCpBANaFaB8bDNpbStyUyxSZdtXrnK (5%)

const {
  Connection, PublicKey, Keypair, Transaction, VersionedTransaction,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress, createTransferCheckedInstruction,
} = require('@solana/spl-token');
const axios = require('axios');
const bs58 = require('bs58');

const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_DECIMALS = 6;

const JUPITER_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_SWAP  = 'https://lite-api.jup.ag/swap/v1/swap';

const DEFAULT_FEE_WALLET = 'EptTb2YUJGV8LwXCpBANaFaB8bDNpbStyUyxSZdtXrnK';
const DEFAULT_FEE_RATE   = 0.05;

function loadKeypair() {
  const raw = (process.env.KURO_LOCALPAY_SOL_PRIVKEY || '').trim();
  if (!raw) return { kp: null, configured: false };
  // Accept base58 (LocalPay/Phantom export default) or JSON array [n,n,...].
  try {
    const kp = raw.startsWith('[')
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
      : Keypair.fromSecretKey(bs58.decode(raw));
    return { kp, configured: true };
  } catch (e) {
    return { kp: null, configured: true, error: `localpay_bad_privkey:${e.message}` };
  }
}

// Settlement addresses are keyed by VN bank account number. Populate via env
// KURO_LOCALPAY_SOL_MART_<ACCTNO>=<solana_address>. The mart downstairs is
// seeded from the reference tx.
function resolveMerchantSolAddress(vnAccountNumber) {
  const key = 'KURO_LOCALPAY_SOL_MART_' + String(vnAccountNumber || '').replace(/[^0-9A-Za-z]/g, '');
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  if (String(vnAccountNumber) === '025704070057555') {
    return '6wKZjEWkPxo5fRbfD1t1k2ZC2dj3gJygf2zZX7FXkgM5';
  }
  return null;
}

// ── Auto-swap USDC → USDT via Jupiter when the USDT balance is short ─
// LocalPay's app does this transparently; we replicate it server-side so a
// wallet holding mostly USDC can still settle VN merchant USDT txs.
async function ensureUsdtBalance(conn, kp, neededBase) {
  const srcUsdtAta = await getAssociatedTokenAddress(USDT_MINT, kp.publicKey);
  const bal = await conn.getTokenAccountBalance(srcUsdtAta).catch(() => null);
  const haveBase = BigInt(bal?.value?.amount || '0');
  if (haveBase >= neededBase) return { swapped: false, haveBase };

  const shortfallBase = neededBase - haveBase;
  // 2% headroom so rounding / tiny rate moves between quote and settle
  // don't leave us 1 lamport short after the swap lands.
  const targetOutBase = (shortfallBase * 102n) / 100n;

  const quoteResp = await axios.get(JUPITER_QUOTE, {
    params: {
      inputMint:   USDC_MINT.toBase58(),
      outputMint:  USDT_MINT.toBase58(),
      amount:      String(targetOutBase),
      slippageBps: 50,
      swapMode:    'ExactOut',
    },
    timeout:        30_000,
    validateStatus: null,
  });
  if (quoteResp.status >= 400 || !quoteResp.data?.outAmount) {
    throw new Error(`jupiter_quote_${quoteResp.status}:${JSON.stringify(quoteResp.data).slice(0, 200)}`);
  }
  const quote = quoteResp.data;

  // Pre-flight: confirm USDC balance covers the swap input.
  const srcUsdcAta = await getAssociatedTokenAddress(USDC_MINT, kp.publicKey);
  const usdcBal = await conn.getTokenAccountBalance(srcUsdcAta).catch(() => null);
  const haveUsdcBase = BigInt(usdcBal?.value?.amount || '0');
  if (haveUsdcBase < BigInt(quote.inAmount)) {
    throw new Error(`localpay_insufficient_usdc:have=${haveUsdcBase},need=${quote.inAmount}`);
  }

  const swapResp = await axios.post(JUPITER_SWAP, {
    quoteResponse:          quote,
    userPublicKey:          kp.publicKey.toBase58(),
    wrapAndUnwrapSol:       true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 'auto',
  }, { timeout: 30_000, validateStatus: null });
  if (swapResp.status >= 400 || !swapResp.data?.swapTransaction) {
    throw new Error(`jupiter_swap_${swapResp.status}:${JSON.stringify(swapResp.data).slice(0, 200)}`);
  }

  const swapTx = VersionedTransaction.deserialize(
    Buffer.from(swapResp.data.swapTransaction, 'base64'),
  );
  swapTx.sign([kp]);
  const sig = await conn.sendTransaction(swapTx, { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');

  return {
    swapped:   true,
    signature: sig,
    inUsdc:    Number(quote.inAmount)  / 10 ** USDT_DECIMALS,
    outUsdt:   Number(quote.outAmount) / 10 ** USDT_DECIMALS,
  };
}

async function settle(payload) {
  const { kp, configured, error: keyError } = loadKeypair();
  if (!configured) return { configured: false };
  if (!kp)         return { configured: true, success: false, error: keyError };

  const recipientAddr = resolveMerchantSolAddress(payload.recipient);
  if (!recipientAddr) {
    return { configured: true, success: false, error: 'localpay_merchant_sol_unknown' };
  }

  const feeWallet = new PublicKey(
    process.env.KURO_LOCALPAY_SOL_FEE_WALLET || DEFAULT_FEE_WALLET,
  );  // Token account (not wallet owner).
  const feeRate   = Number(process.env.KURO_LOCALPAY_FEE_RATE || DEFAULT_FEE_RATE);

  // VND amount → USDT amount. We charge 1 USD ≈ 25000 VND as default; override
  // with KURO_LOCALPAY_USDT_VND so ops can tune as spot moves.
  const vndPerUsdt = Number(process.env.KURO_LOCALPAY_USDT_VND || 25000);
  const vndAmount  = Number(payload.amount);
  if (!Number.isFinite(vndAmount) || vndAmount <= 0) {
    return { configured: true, success: false, error: 'localpay_bad_amount' };
  }
  const grossUsdt = vndAmount / vndPerUsdt;
  const feeUsdt   = grossUsdt * feeRate;
  const netUsdt   = grossUsdt - feeUsdt;

  const toBase = (n) => BigInt(Math.round(n * 10 ** USDT_DECIMALS));
  const netBase = toBase(netUsdt);
  const feeBase = toBase(feeUsdt);

  const rpcUrl = process.env.KURO_FACILITATOR_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const conn   = new Connection(rpcUrl, 'confirmed');

  try {
    // Merchant + fee destinations from the reference tx are raw USDT token
    // accounts, not wallet owners — use them directly. Only the sender's ATA
    // is derived (owner + mint → PDA).
    const dstAta = new PublicKey(recipientAddr);
    const feeAta = feeWallet;
    const srcAta = await getAssociatedTokenAddress(USDT_MINT, kp.publicKey);

    // Top up USDT via Jupiter if short (auto-swaps from USDC balance).
    let swapInfo = null;
    try {
      swapInfo = await ensureUsdtBalance(conn, kp, netBase + feeBase);
    } catch (e) {
      return {
        configured: true, success: false,
        error: e.message.startsWith('localpay_') ? e.message : `localpay_swap_failed:${e.message}`,
        detail: { vndAmount, vndPerUsdt, needUsdt: netUsdt + feeUsdt },
      };
    }

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
    tx.add(createTransferCheckedInstruction(
      srcAta, USDT_MINT, dstAta, kp.publicKey, netBase, USDT_DECIMALS,
    ));
    tx.add(createTransferCheckedInstruction(
      srcAta, USDT_MINT, feeAta, kp.publicKey, feeBase, USDT_DECIMALS,
    ));

    const sig = await conn.sendTransaction(tx, [kp], { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');

    return {
      configured: true, success: true,
      signature:       sig,
      netUsdt, feeUsdt, vndAmount,
      vndPerUsdt,
      merchantAddress: recipientAddr,
      swap: swapInfo && swapInfo.swapped ? {
        signature: swapInfo.signature,
        inUsdc:    swapInfo.inUsdc,
        outUsdt:   swapInfo.outUsdt,
      } : null,
    };
  } catch (e) {
    return {
      configured: true, success: false,
      error: `localpay_solana_exception:${e.message || e.name || 'unknown'}`,
      detail: { stack: (e.stack || '').split('\n').slice(0, 5).join(' | ') },
    };
  }
}

module.exports = { settle };
