'use strict';

const express = require('express');

const webhooksRouter = require('./routes/webhooks.cjs');
const accountsRouter = require('./routes/accounts.cjs');
const opsRouter = require('./routes/ops.cjs');
const insightsRouter = require('./routes/insights.cjs');
const auditRouter = require('./routes/audit_routes.cjs');
const vaultsRouter = require('./routes/vaults.cjs');

const ledger = require('./core/ledger.cjs');
const insightEngine = require('./intelligence/insight_engine.cjs');
const xmr = require('./connectors/xmr.cjs');

/* ------------------------------------------------------------------ */
/*  Router assembly                                                    */
/* ------------------------------------------------------------------ */

const router = express.Router();

/*
 * IMPORTANT: Webhook routes receive express.raw() bodies for signature
 * verification. Mount with raw body parser BEFORE any JSON parsing.
 */
router.use(
  '/webhook',
  express.raw({ type: 'application/json' }),
  webhooksRouter
);

/* Standard JSON-parsed sub-routers */
router.use('/accounts', express.json(), accountsRouter);
router.use('/ops', express.json(), opsRouter);
router.use('/insights', express.json(), insightsRouter);
router.use('/audit', express.json(), auditRouter);
router.use('/vaults', express.json(), vaultsRouter);

/* ------------------------------------------------------------------ */
/*  x402 Card Bridge routes                                            */
/* ------------------------------------------------------------------ */
(function mountX402Routes() {
  const crypto   = require('crypto');
  const bridge   = require('./x402_card_bridge.cjs');

  // Lazy-load DB so it's available after server starts
  function getDB() {
    try { return require('../../layers/auth/db.cjs').db; }
    catch(_) { return null; }
  }

  // ── POST /api/pay/x402/parse-qr ──────────────────────────────
  router.post('/x402/parse-qr', express.json(), (req, res) => {
    try {
      const { qr } = req.body;
      if (!qr) return res.status(400).json({ error: 'qr is required' });
      const parsed = bridge.parseQR(qr);
      // Estimate AUD amount if local amount present
      res.json({ parsed, estimatedAUD: parsed.amount || null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /api/pay/x402/initiate ───────────────────────────────
  router.post('/x402/initiate', express.json(), async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });

    const { qr, paymentMethodId } = req.body;
    if (!qr || !paymentMethodId) {
      return res.status(400).json({ error: 'qr and paymentMethodId are required' });
    }

    let parsed;
    try { parsed = bridge.parseQR(qr); }
    catch (err) { return res.status(400).json({ error: 'QR parse failed: ' + err.message }); }

    // Static QRs (e.g., street-vendor VietQR, static PromptPay) carry no amount.
    // Reject early — charging 0 AUD produces a Stripe error and a bad payment record.
    if (!parsed.amount || parsed.amount <= 0) {
      return res.status(400).json({
        error: 'QR code does not contain an amount. Dynamic/merchant QR required.',
        standard: parsed.standard,
      });
    }

    const paymentId = crypto.randomUUID();
    const db        = getDB();

    try {
      // FX: local currency → AUD
      const localCurrency = parsed.currency || 'USD';
      let   amountAUD     = parsed.amount;
      let   fxRate        = 1;
      if (parsed.amount && localCurrency !== 'AUD') {
        fxRate     = await bridge.getFXRate(localCurrency, 'AUD');
        amountAUD  = parsed.amount * fxRate;
      }
      const { grossAUD, commission, net } = bridge.calcCommission(amountAUD || 0);

      // Insert pending row
      if (db) {
        db.prepare(`INSERT INTO x402_payments
          (id, user_id, status, qr_standard, qr_parsed, amount_aud, amount_local,
           local_currency, fx_rate, commission_aud)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(paymentId, userId, 'pending',
          parsed.standard, JSON.stringify(parsed),
          grossAUD, parsed.amount, localCurrency, fxRate, commission);
      }

      // Stripe card charge
      const intent = await bridge.stripeCreateIntent({
        amountAUD:       grossAUD,
        userId,
        paymentMethodId,
        metadata:        { paymentId, qrStandard: parsed.standard },
      });
      if (db) db.prepare(`UPDATE x402_payments SET stripe_intent_id=?, status=? WHERE id=?`)
        .run(intent.id, 'stripe_charged', paymentId);

      // Coinbase Commerce USDC charge
      const audToUSD = await bridge.getFXRate('AUD', 'USD');
      const netUSD   = net * audToUSD;
      const charge   = await bridge.coinbaseCreateCharge({
        amountUSD:   netUSD,
        userId,
        description: `KURO::PAY ${parsed.standard?.toUpperCase()} ${localCurrency}`,
      });
      if (db) db.prepare(`UPDATE x402_payments SET coinbase_charge_id=?, status=? WHERE id=?`)
        .run(charge.data?.id || charge.id || '', 'usdc_pending', paymentId);

      res.json({
        paymentId,
        status:            'usdc_pending',
        amountAUD:         grossAUD,
        commission,
        coinbaseHostedUrl: charge.data?.hosted_url || charge.hosted_url || null,
      });

    } catch (err) {
      if (db) db.prepare(`UPDATE x402_payments SET status=?, error=? WHERE id=?`)
        .run('error', err.message, paymentId);
      res.status(500).json({ error: err.message, paymentId });
    }
  });

  // ── POST /api/pay/x402/verify ─────────────────────────────────
  router.post('/x402/verify', express.json(), async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });

    const { paymentId, solanaTx } = req.body;
    if (!paymentId || !solanaTx) {
      return res.status(400).json({ error: 'paymentId and solanaTx are required' });
    }

    const db = getDB();
    const row = db?.prepare(`SELECT * FROM x402_payments WHERE id=?`).get(paymentId);
    if (!row)             return res.status(404).json({ error: 'Payment not found' });
    if (row.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    try {
      const verification = await bridge.verifySolanaUSDCTx(solanaTx, null);
      const settledAt    = Math.floor(Date.now() / 1000);
      if (db) db.prepare(`UPDATE x402_payments SET solana_tx=?, status=?, settled_at=? WHERE id=?`)
        .run(solanaTx, 'confirmed', settledAt, paymentId);

      res.json({
        confirmed: true,
        receipt: { paymentId, solanaTx, settledAt },
      });
    } catch (err) {
      if (db) db.prepare(`UPDATE x402_payments SET status=?, error=? WHERE id=?`)
        .run('verify_failed', err.message, paymentId);
      res.status(400).json({ error: err.message });
    }
  });

  // ── GET /api/pay/x402/methods ─────────────────────────────────
  router.get('/x402/methods', (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const db      = getDB();
    const methods = db?.prepare(`SELECT * FROM pay_methods WHERE user_id=? ORDER BY is_default DESC, created_at DESC`).all(userId) || [];
    res.json({ methods });
  });

  // ── POST /api/pay/x402/methods ────────────────────────────────
  router.post('/x402/methods', express.json(), (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });

    const { stripePaymentMethodId, cardLast4, cardBrand, cardCountry, isDefault } = req.body;
    if (!stripePaymentMethodId) return res.status(400).json({ error: 'stripePaymentMethodId is required' });

    const db = getDB();
    const id = crypto.randomUUID();
    if (isDefault && db) {
      db.prepare(`UPDATE pay_methods SET is_default=0 WHERE user_id=?`).run(userId);
    }
    db?.prepare(`INSERT INTO pay_methods (id, user_id, stripe_pm_id, card_last4, card_brand, card_country, is_default)
      VALUES (?,?,?,?,?,?,?)`
    ).run(id, userId, stripePaymentMethodId, cardLast4 || null, cardBrand || null, cardCountry || null, isDefault ? 1 : 0);
    res.status(201).json({ id });
  });

  // ── DELETE /api/pay/x402/methods/:id ─────────────────────────
  router.delete('/x402/methods/:id', (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const db  = getDB();
    const row = db?.prepare(`SELECT user_id FROM pay_methods WHERE id=?`).get(req.params.id);
    if (!row)                  return res.status(404).json({ error: 'Not found' });
    if (row.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    db.prepare(`DELETE FROM pay_methods WHERE id=?`).run(req.params.id);
    res.json({ deleted: true });
  });

  console.log('[KURO::PAY] x402 Card Bridge routes mounted at /api/pay/x402/*');
})();

/* ------------------------------------------------------------------ */
/*  initPayModule                                                      */
/* ------------------------------------------------------------------ */

async function initPayModule() {
  /* 1. Ensure DB schema exists */
  ledger.initSchema();
  console.log('[KURO::PAY] Database schema initialized');

  /* 2. Start insight engine (15-min cycle) */
  insightEngine.start();
  console.log('[KURO::PAY] Insight engine started');

  /* 3. Test XMR connection */
  try {
    if (!xmr.MOCK) {
      const balance = await xmr.getBalance();
      if (balance.error) {
        console.warn('[KURO::PAY] XMR node offline:', balance.error);
      } else {
        console.log('[KURO::PAY] XMR node connected, balance:', (balance.balance / xmr.PICONERO).toFixed(6), 'XMR');
      }
    } else {
      console.log('[KURO::PAY] XMR running in mock mode');
    }
  } catch (err) {
    console.warn('[KURO::PAY] XMR connection test failed:', err.message || err);
  }

  /* Return shutdown function */
  return function shutdown() {
    insightEngine.stop();
    console.log('[KURO::PAY] Shutdown complete');
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = { router, initPayModule };
