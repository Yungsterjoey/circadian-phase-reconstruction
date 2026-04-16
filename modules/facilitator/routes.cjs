'use strict';

// KURO x402 Facilitator — Express routes
// POST /api/facilitator/verify   — admin
// POST /api/facilitator/settle   — admin, requires Idempotency-Key
// GET  /api/facilitator/health   — public (status only)

const express = require('express');
const crypto  = require('crypto');

const verifier = require('./verifier.cjs');
const settler  = require('./settler.cjs');
const ledger   = require('./ledger.cjs');
const replay   = require('./replay.cjs');

function signReceipt(body) {
  const key = process.env.KURO_FACILITATOR_SECRET || '';
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
}

const FIAT_META = {
  // SEA
  'fiat-napas247':     { country: 'VN', currency: 'VND', rail: 'NAPAS 247'      },
  'fiat-promptpay':    { country: 'TH', currency: 'THB', rail: 'PromptPay'      },
  'fiat-instapay':     { country: 'PH', currency: 'PHP', rail: 'InstaPay'       },
  'fiat-duitnow':      { country: 'MY', currency: 'MYR', rail: 'DuitNow'        },
  'fiat-bifast':       { country: 'ID', currency: 'IDR', rail: 'BI-FAST'        },
  // AU
  'fiat-payid':        { country: 'AU', currency: 'AUD', rail: 'PayID / Osko'   },
  // UK
  'fiat-fps':          { country: 'GB', currency: 'GBP', rail: 'Faster Payments'},
  // EU
  'fiat-sepa-instant': { country: 'EU', currency: 'EUR', rail: 'SEPA Instant'   },
  // IN
  'fiat-upi':          { country: 'IN', currency: 'INR', rail: 'UPI'            },
  // BR
  'fiat-pix':          { country: 'BR', currency: 'BRL', rail: 'PIX'            },
};

function envKey(prefix, scheme) {
  return `${prefix}_${scheme.toUpperCase().replace(/-/g, '_')}`;
}

function railCapabilities() {
  const rails = {};

  rails['exact-evm-base'] = {
    status:  (process.env.KURO_FACILITATOR_BASE_PRIVKEY_HEX && process.env.KURO_FACILITATOR_BASE_RPC) ? 'ready' : 'stub',
    network: 'base-mainnet',
    asset:   'USDC',
  };

  rails['exact-svm-solana'] = {
    status:  (process.env.KURO_SOLANA_WALLET_PRIVKEY_HEX && process.env.KURO_FACILITATOR_SOLANA_RPC) ? 'ready' : 'stub',
    network: 'solana-mainnet',
    asset:   'USDC',
  };

  for (const [scheme, meta] of Object.entries(FIAT_META)) {
    const hasUrl  = !!process.env[envKey('KURO_FACILITATOR_RAIL_URL',  scheme)];
    const hasCred = !!process.env[envKey('KURO_FACILITATOR_RAIL_CRED', scheme)];
    rails[scheme] = {
      status:   (hasUrl && hasCred) ? 'ready' : 'stub',
      country:  meta.country,
      currency: meta.currency,
      rail:     meta.rail,
    };
  }
  return rails;
}

function mountRoutes(app, requireAuth, requireAdmin) {
  const gate = [requireAuth, requireAdmin].filter(Boolean);

  // ── POST /api/facilitator/verify ──────────────────────────────
  app.post('/api/facilitator/verify', ...gate, express.json({ limit: '32kb' }), (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body || {};
    if (!paymentPayload) {
      return res.status(400).json({ isValid: false, invalidReason: 'missing_paymentPayload' });
    }
    const result = verifier.verify(paymentPayload, paymentRequirements);
    ledger.recordVerify({
      scheme:    paymentPayload.scheme,
      payer:     result.payer,
      status:    result.isValid ? 'ok' : 'rejected',
      reason:    result.invalidReason,
      payload:   paymentPayload,
      requestTs: paymentPayload.ts,
    });
    return res.json(result);
  });

  // ── POST /api/facilitator/settle ──────────────────────────────
  app.post('/api/facilitator/settle', ...gate, express.json({ limit: '32kb' }), async (req, res) => {
    const idempotencyKey = req.get('Idempotency-Key') || req.get('idempotency-key');
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'missing_idempotency_key' });
    }
    const prior = ledger.findByIdempotencyKey(idempotencyKey);
    if (prior) {
      return res.json({
        success:     prior.status === 'ok',
        transaction: prior.tx_ref,
        network:     prior.network,
        payer:       prior.payer,
        replayed:    true,
      });
    }

    const { paymentPayload, paymentRequirements } = req.body || {};
    if (!paymentPayload) {
      return res.status(400).json({ success: false, error: 'missing_paymentPayload' });
    }

    // Re-verify before settling. verify() will claim the nonce; if this
    // settle is a retry of a still-valid payload we treat a nonce_replay
    // as acceptable iff the idempotency key is new (caller coordination
    // problem). We fail closed here — caller must regenerate nonce.
    const vr = verifier.verify(paymentPayload, paymentRequirements);
    if (!vr.isValid) {
      ledger.recordSettle({
        scheme:         paymentPayload.scheme,
        idempotencyKey,
        payer:          vr.payer,
        status:         'rejected',
        reason:         vr.invalidReason,
        payload:        paymentPayload,
        requestTs:      paymentPayload.ts,
      });
      return res.status(400).json({ success: false, error: vr.invalidReason, payer: vr.payer });
    }

    let result;
    try {
      result = await settler.settle(paymentPayload);
    } catch (e) {
      result = { success: false, error: e.message };
    }

    try {
      ledger.recordSettle({
        scheme:         paymentPayload.scheme,
        idempotencyKey,
        payer:          result.payer || vr.payer,
        network:        result.network,
        amount:         paymentPayload.amount,
        currency:       paymentPayload.currency,
        txRef:          result.transaction,
        status:         result.success ? 'ok' : 'error',
        reason:         result.error,
        payload:        paymentPayload,
        requestTs:      paymentPayload.ts,
      });
    } catch (e) {
      // If the unique-idempotency constraint fires, surface the prior row.
      const prior2 = ledger.findByIdempotencyKey(idempotencyKey);
      if (prior2) {
        return res.json({
          success:     prior2.status === 'ok',
          transaction: prior2.tx_ref,
          network:     prior2.network,
          payer:       prior2.payer,
          replayed:    true,
        });
      }
      return res.status(500).json({ success: false, error: `ledger_write_failed: ${e.message}` });
    }

    const body = {
      success:     !!result.success,
      transaction: result.transaction || null,
      network:     result.network     || null,
      payer:       result.payer       || vr.payer,
      error:       result.error       || undefined,
    };
    const sig = signReceipt(body);
    if (sig) res.set('X-KURO-Receipt-Sig', sig);
    return res.status(result.success ? 200 : 502).json(body);
  });

  // ── GET /api/facilitator/health ───────────────────────────────
  app.get('/api/facilitator/health', (req, res) => {
    replay.sweep();
    res.json({
      ok:    true,
      rails: railCapabilities(),
      ts:    Math.floor(Date.now() / 1000),
    });
  });

  console.log('[FACILITATOR] routes mounted at /api/facilitator/*');
}

module.exports = { mountRoutes };
