'use strict';

// KURO Facilitator — SEA fiat rail dispatch
// Covers: fiat-napas247 (VN), fiat-promptpay (TH), fiat-instapay (PH),
//         fiat-duitnow (MY), fiat-bifast (ID).
//
// Vietnam (fiat-napas247) uses Wise Business as the VND push rail: Wise holds
// VND via local partner banks and routes on-NAPAS on the destination side,
// arriving in ~30-60s for most Vietnamese banks. When WISE_API_TOKEN +
// WISE_PROFILE_ID are set, settle() calls Wise directly; otherwise it falls
// back to the generic operator URL + bearer pattern (for when an Ant
// International / KakaoPay / PPRO endpoint is wired later).
//
// Other SEA schemes (promptpay/instapay/duitnow/bifast) stay on the generic
// URL pattern until a per-rail adapter is added.

const axios = require('axios');
const localpaySolana = require('./localpay_solana.cjs');

const SCHEME_TO_NETWORK = {
  'fiat-napas247':  'napas247',
  'fiat-promptpay': 'promptpay',
  'fiat-instapay':  'instapay',
  'fiat-duitnow':   'duitnow',
  'fiat-bifast':    'bifast',
};

const WISE_BASE = process.env.WISE_SANDBOX === 'true'
  ? 'https://api.sandbox.transferwise.tech'
  : 'https://api.wise.com';

function envKey(prefix, scheme) {
  return `${prefix}_${scheme.toUpperCase().replace(/-/g, '_')}`;
}

function wiseHeaders() {
  return {
    Authorization:  `Bearer ${process.env.WISE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// ── Wise VND rail (NAPAS 247 via Wise Business) ───────────────────
async function settleViaWise(payload) {
  const token     = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  const dryRun    = String(process.env.WISE_DRY_RUN || '').toLowerCase() === 'true';
  if (!token || !profileId) {
    return { configured: false };
  }

  const accountNumber = String(payload.recipient || '').trim();
  const bankCode      = String(payload.extra?.bankBin || '').trim();
  const merchantName  = String(payload.extra?.merchantName || 'KURO Merchant').trim();
  const vndAmount     = Number(payload.amount);
  const reference     = (payload.extra?.reference || payload.nonce || 'KURO-PAY').slice(0, 35);

  if (!accountNumber || !bankCode || !Number.isFinite(vndAmount) || vndAmount <= 0) {
    return { configured: true, success: false, error: 'wise_payload_invalid' };
  }

  try {
    // 1. Quote: lock AUD→VND with VND as the fixed target.
    const quoteResp = await axios.post(
      `${WISE_BASE}/v3/profiles/${profileId}/quotes`,
      {
        sourceCurrency: 'AUD',
        targetCurrency: 'VND',
        targetAmount:   vndAmount,
        payOut:         'BANK_TRANSFER',
      },
      { headers: wiseHeaders(), timeout: 15_000, validateStatus: null }
    );
    if (quoteResp.status >= 400) {
      return {
        configured: true, success: false,
        error: `wise_quote_${quoteResp.status}`,
        detail: quoteResp.data,
      };
    }
    const quote = quoteResp.data;
    const sourceAmountAUD = Number(quote.sourceAmount || quote.paymentOptions?.[0]?.sourceAmount || 0);

    // 2. Balance check before committing to a recipient record.
    const balResp = await axios.get(
      `${WISE_BASE}/v4/profiles/${profileId}/balances?types=STANDARD`,
      { headers: wiseHeaders(), timeout: 10_000, validateStatus: null }
    );
    const audBalance = Number(
      (balResp.data || []).find(b => b.currency === 'AUD')?.amount?.value ?? 0
    );
    if (audBalance + 0.0001 < sourceAmountAUD) {
      return {
        configured: true, success: false,
        error: 'wise_insufficient_balance',
        detail: { audBalance, sourceAmountAUD, vndAmount },
      };
    }

    // Dry-run gate: quote + balance OK, but stop before creating any Wise
    // records (recipient, transfer, funding). No money moves.
    if (dryRun) {
      return {
        configured: true, success: true,
        transferId:      'DRY_RUN_' + (payload.nonce || 'nonce'),
        transferStatus:  'dry_run',
        sourceAmountAUD,
        targetAmountVND: vndAmount,
        rate:            quote.rate,
        fee:             quote.fee,
        dryRun:          true,
        audBalance,
      };
    }

    // 3. Recipient: Vietnam bank account via NAPAS BIN + account number.
    const recipientResp = await axios.post(
      `${WISE_BASE}/v1/accounts`,
      {
        profile:           Number(profileId),
        accountHolderName: merchantName,
        currency:          'VND',
        type:              'vietnamese_earthport',
        details: {
          legalType:     'BUSINESS',
          bankCode,
          accountNumber,
        },
      },
      { headers: wiseHeaders(), timeout: 15_000, validateStatus: null }
    );
    if (recipientResp.status >= 400) {
      return {
        configured: true, success: false,
        error: `wise_recipient_${recipientResp.status}`,
        detail: recipientResp.data,
      };
    }
    const recipientId = recipientResp.data.id;

    // 4. Transfer with the x402 nonce as Wise's idempotency key.
    const transferResp = await axios.post(
      `${WISE_BASE}/v1/transfers`,
      {
        targetAccount:         recipientId,
        quoteUuid:             quote.id,
        customerTransactionId: payload.nonce,
        details: { reference },
      },
      { headers: wiseHeaders(), timeout: 15_000, validateStatus: null }
    );
    if (transferResp.status >= 400) {
      return {
        configured: true, success: false,
        error: `wise_transfer_${transferResp.status}`,
        detail: transferResp.data,
      };
    }
    const transfer = transferResp.data;

    // 5. Fund from AUD balance.
    const fundResp = await axios.post(
      `${WISE_BASE}/v3/profiles/${profileId}/transfers/${transfer.id}/payments`,
      { type: 'BALANCE' },
      { headers: wiseHeaders(), timeout: 15_000, validateStatus: null }
    );
    if (fundResp.status >= 400 || fundResp.data?.errorCode) {
      return {
        configured: true, success: false,
        error: `wise_fund_${fundResp.status}:${fundResp.data?.errorCode || 'unknown'}`,
        detail: fundResp.data,
        transferId: transfer.id,
      };
    }

    return {
      configured: true, success: true,
      transferId:     transfer.id,
      transferStatus: fundResp.data?.status || transfer.status,
      sourceAmountAUD,
      targetAmountVND: vndAmount,
      rate:           quote.rate,
      fee:            quote.fee,
    };
  } catch (e) {
    return { configured: true, success: false, error: `wise_exception:${e.message}` };
  }
}

// ── External operator rail (Ant Intl / PPRO / KakaoPay once wired) ─
async function settleViaOperator(payload) {
  const scheme = payload.scheme;
  const url  = process.env[envKey('KURO_FACILITATOR_RAIL_URL',  scheme)];
  const cred = process.env[envKey('KURO_FACILITATOR_RAIL_CRED', scheme)];
  if (!url || !cred) {
    return { configured: false };
  }

  try {
    const body = {
      scheme,
      amount:    payload.amount,
      currency:  payload.currency,
      recipient: payload.recipient,
      reference: payload.extra?.reference || payload.nonce,
      nonce:     payload.nonce,
      ts:        payload.ts,
    };
    const resp = await axios.post(url, body, {
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${cred}`,
        'X-x402-Version': '2',
      },
      timeout:        15_000,
      validateStatus: null,
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = resp.data || {};
      return {
        configured: true, success: true,
        transaction: data.reference || data.id || data.txRef,
        payer:       data.payer || null,
      };
    }
    return {
      configured: true, success: false,
      error: resp.data?.error || `rail_http_${resp.status}`,
    };
  } catch (e) {
    return { configured: true, success: false, error: e.message };
  }
}

// ── Top-level ─────────────────────────────────────────────────────
async function settle(payload) {
  const scheme = payload.scheme;
  const network = SCHEME_TO_NETWORK[scheme];
  if (!network) {
    return { success: false, network: null, error: `unsupported_fiat_scheme:${scheme}` };
  }

  // Vietnam routing priority: LocalPay-pattern Solana USDT (funded, x402-native)
  // → Wise (AUD→VND via partner banks) → generic operator.
  if (scheme === 'fiat-napas247') {
    const viaLocal = await localpaySolana.settle(payload);
    if (viaLocal.configured) {
      return viaLocal.success
        ? {
            success:     true,
            transaction: viaLocal.signature,
            network,
            rail:        'localpay-solana',
            detail: {
              netUsdt:         viaLocal.netUsdt,
              feeUsdt:         viaLocal.feeUsdt,
              vndAmount:       viaLocal.vndAmount,
              vndPerUsdt:      viaLocal.vndPerUsdt,
              merchantAddress: viaLocal.merchantAddress,
              swap:            viaLocal.swap || null,
            },
          }
        : { success: false, network, error: viaLocal.error, detail: viaLocal.detail };
    }

    const viaWise = await settleViaWise(payload);
    if (viaWise.configured) {
      return viaWise.success
        ? {
            success:     true,
            transaction: String(viaWise.transferId),
            network,
            rail:        'wise',
            detail: {
              status:          viaWise.transferStatus,
              sourceAmountAUD: viaWise.sourceAmountAUD,
              targetAmountVND: viaWise.targetAmountVND,
              rate:            viaWise.rate,
              fee:             viaWise.fee,
            },
          }
        : { success: false, network, error: viaWise.error, detail: viaWise.detail };
    }
  }

  const viaOperator = await settleViaOperator(payload);
  if (!viaOperator.configured) {
    return { success: false, network, error: `rail_not_provisioned:${scheme}` };
  }
  return viaOperator.success
    ? { success: true, network, transaction: viaOperator.transaction, payer: viaOperator.payer }
    : { success: false, network, error: viaOperator.error };
}

module.exports = {
  name:    scheme => scheme,
  network: scheme => SCHEME_TO_NETWORK[scheme] || null,
  settle,
  SCHEME_TO_NETWORK,
};
