'use strict';

const express = require('express');
const router = express.Router();

const wise = require('../connectors/wise.cjs');
const payBrain = require('../intelligence/pay_brain.cjs');
const ledger = require('../core/ledger.cjs');
const audit = require('../core/audit.cjs');
const events = require('../core/events.cjs');

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const PAY_AUTO_LIMIT_AUD = Number(process.env.PAY_AUTO_LIMIT_AUD) || 50000; // cents (default $500)

/* ------------------------------------------------------------------ */
/*  POST /webhook/wise                                                 */
/*  Receives raw body — express.raw() is applied at mount level.       */
/* ------------------------------------------------------------------ */

router.post('/wise', async (req, res) => {
  try {
    const rawBody = req.body;
    const signature = req.headers['x-signature-sha256'] || req.headers['x-signature'] || '';

    /* ---- Signature validation ---- */
    if (!wise.MOCK) {
      const valid = wise.validateWebhook(rawBody, signature);
      if (!valid) {
        console.warn('[PAY::Webhook] Invalid Wise signature — rejected');
        return res.status(403).json({ error: 'invalid_signature' });
      }
    }

    /* ---- Parse payload ---- */
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (parseErr) {
      return res.status(400).json({ error: 'invalid_json', detail: parseErr.message });
    }

    const eventType = payload.event_type || payload.eventType || '';

    /* ---- Only handle balances#credit ---- */
    if (eventType !== 'balances#credit') {
      // Acknowledge but ignore non-credit events
      return res.status(200).json({ ok: true, handled: false, event_type: eventType });
    }

    const data = payload.data || {};
    const amountValue = data.amount || (data.transaction && data.transaction.amount) || 0;
    const currency = data.currency || (data.transaction && data.transaction.currency) || 'AUD';
    const senderName = data.senderName || (data.details && data.details.senderName) || 'Unknown';
    const description = data.description || (data.details && data.details.description) || '';
    const externalId = data.transactionId || data.referenceNumber || payload.subscription_id || null;

    // Convert to cents (minor units)
    const amountCents = Math.round(Math.abs(Number(amountValue)) * 100);

    /* ---- Insert pending ledger entry ---- */
    const ledgerId = ledger.insertLedger({
      type: 'deposit',
      amount_minor: amountCents,
      currency: currency.toUpperCase(),
      from_ref: senderName,
      to_ref: 'wise',
      status: 'pending',
      external_id: externalId,
      metadata: { webhook_event: eventType, raw_amount: amountValue },
    });

    /* ---- AI classification ---- */
    const classification = await payBrain.classifyTransaction({
      amount_aud: amountCents / 100,
      description,
      sender_name: senderName,
    });

    const autoComplete =
      classification.confidence >= 0.85 && amountCents <= PAY_AUTO_LIMIT_AUD;

    if (autoComplete) {
      ledger.updateLedgerStatus(ledgerId, 'completed');

      // Update ledger AI fields by re-inserting audit trail
      audit.inscribe('webhook.auto_complete', ledgerId, 'pay_brain');
    } else {
      ledger.updateLedgerStatus(ledgerId, 'manual_review');
      audit.inscribe('webhook.manual_review', ledgerId, 'pay_brain');
    }

    /* ---- Inscribe primary audit record ---- */
    const auditRecord = audit.inscribe('webhook.wise.credit', ledgerId, 'wise');

    /* ---- Emit SSE event ---- */
    events.emit('transaction', {
      type: 'deposit',
      ledger_id: ledgerId,
      amount_minor: amountCents,
      currency: currency.toUpperCase(),
      status: autoComplete ? 'completed' : 'manual_review',
      classification,
      audit_hash: auditRecord.hash,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      handled: true,
      ledger_id: ledgerId,
      status: autoComplete ? 'completed' : 'manual_review',
      classification: {
        action: classification.action,
        confidence: classification.confidence,
        memo: classification.memo,
      },
      audit_hash: auditRecord.hash,
    });
  } catch (err) {
    console.error('[PAY::Webhook] Error processing Wise webhook:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

module.exports = router;
