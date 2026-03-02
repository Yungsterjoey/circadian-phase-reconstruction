'use strict';

const express = require('express');
const router = express.Router();

const wise = require('../connectors/wise.cjs');
const ir = require('../connectors/independent_reserve.cjs');
const xmr = require('../connectors/xmr.cjs');
const coingecko = require('../connectors/coingecko.cjs');
const frankfurter = require('../connectors/frankfurter.cjs');
const payBrain = require('../intelligence/pay_brain.cjs');
const addictionMirror = require('../intelligence/addiction_mirror.cjs');
const ledger = require('../core/ledger.cjs');
const audit = require('../core/audit.cjs');
const events = require('../core/events.cjs');

/* ------------------------------------------------------------------ */
/*  SSE Helpers                                                        */
/* ------------------------------------------------------------------ */

function initSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendStage(res, stage, detail) {
  res.write(`data: ${JSON.stringify({ type: 'stage', stage, detail, timestamp: new Date().toISOString() })}\n\n`);
}

function sendComplete(res, data) {
  res.write(`data: ${JSON.stringify({ type: 'complete', ...data, timestamp: new Date().toISOString() })}\n\n`);
  res.end();
}

function sendError(res, msg) {
  res.write(`data: ${JSON.stringify({ type: 'error', message: msg, timestamp: new Date().toISOString() })}\n\n`);
  res.end();
}

/* ------------------------------------------------------------------ */
/*  Resolve helpers                                                    */
/* ------------------------------------------------------------------ */

function getSessionId(req) {
  return (req.user && req.user.userId) || req.ip || '__anonymous__';
}

function getActor(req) {
  return (req.user && (req.user.name || req.user.userId)) || 'anonymous';
}

async function getWiseProfileId() {
  const profiles = await wise.getProfiles();
  const personal = profiles.find((p) => p.type === 'personal');
  return personal ? personal.id : (profiles[0] && profiles[0].id) || null;
}

/* ------------------------------------------------------------------ */
/*  POST /ops/nlp — Parse NLP instruction (preview only)               */
/* ------------------------------------------------------------------ */

router.post('/nlp', async (req, res) => {
  try {
    const { instruction } = req.body || {};
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ error: 'missing_instruction', detail: 'instruction string required' });
    }

    const parsed = await payBrain.parseNLP(instruction);

    return res.json({
      ok: true,
      parsed,
      preview: true,
      execute: false,
    });
  } catch (err) {
    console.error('[PAY::Ops] nlp error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/quote — Get rate quote                                   */
/* ------------------------------------------------------------------ */

router.post('/quote', async (req, res) => {
  try {
    const { source, target, amount_cents } = req.body || {};
    if (!source || !target) {
      return res.status(400).json({ error: 'missing_params', detail: 'source, target required' });
    }

    const quotes = {};

    // Wise forex quote
    if (/^[A-Z]{3}$/.test(source) && /^[A-Z]{3}$/.test(target)) {
      try {
        const profileId = await getWiseProfileId();
        if (profileId && amount_cents) {
          quotes.wise = await wise.createQuote(profileId, source, target, amount_cents);
        }
        quotes.wise_rate = await wise.getExchangeRate(source, target);
      } catch (e) {
        quotes.wise_error = e.message;
      }
    }

    // CoinGecko crypto price
    try {
      quotes.crypto_prices = await coingecko.getPrices();
    } catch (e) {
      quotes.crypto_error = e.message;
    }

    // IR order book
    try {
      quotes.ir_orderbook = await ir.getOrderBook();
    } catch (e) {
      quotes.ir_error = e.message;
    }

    // Frankfurter forex
    try {
      quotes.forex_rates = await frankfurter.getRates();
    } catch (e) {
      quotes.forex_error = e.message;
    }

    return res.json({ ok: true, quotes });
  } catch (err) {
    console.error('[PAY::Ops] quote error:', err.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/execute — Generic execute with SSE                       */
/* ------------------------------------------------------------------ */

router.post('/execute', async (req, res) => {
  initSSE(res);

  try {
    const { instruction } = req.body || {};
    if (!instruction) {
      return sendError(res, 'missing_instruction');
    }

    const actor = getActor(req);
    const sessionId = getSessionId(req);

    sendStage(res, 'parsing', 'Analyzing instruction with AI...');
    const parsed = await payBrain.parseNLP(instruction);

    if (parsed.operation === 'unknown' || parsed.confidence < 0.5) {
      return sendError(res, `Could not parse instruction. Operation: ${parsed.operation}, confidence: ${parsed.confidence}`);
    }

    sendStage(res, 'validated', `Parsed operation: ${parsed.operation}, confidence: ${parsed.confidence}`);

    /* ---- Route to appropriate operation ---- */
    switch (parsed.operation) {
      case 'withdraw_aud': {
        sendStage(res, 'initiating', 'Preparing AUD withdrawal via Wise...');
        const profileId = await getWiseProfileId();
        if (!profileId) return sendError(res, 'Wise profile not found');

        const amountCents = Math.round((parsed.amount || 0) * 100);
        if (amountCents <= 0) return sendError(res, 'Invalid amount');

        sendStage(res, 'quote', 'Creating Wise quote...');
        const quote = await wise.createQuote(profileId, 'AUD', 'AUD', amountCents);

        sendStage(res, 'recipient', 'Creating recipient...');
        const recipient = await wise.createRecipient(
          profileId, 'AUD',
          parsed.destination || '062-000',
          parsed.destination || '12345678',
          actor
        );

        sendStage(res, 'transfer', 'Creating transfer...');
        const transfer = await wise.createTransfer(recipient.id, quote.id, 'KURO-PAY');

        sendStage(res, 'funding', 'Funding transfer from balance...');
        await wise.fundTransfer(profileId, transfer.id);

        const ledgerId = ledger.insertLedger({
          type: 'withdrawal',
          amount_minor: amountCents,
          currency: 'AUD',
          to_ref: parsed.destination || 'bsb_account',
          status: 'completed',
          ai_action: parsed.operation,
          ai_confidence: parsed.confidence,
          external_id: transfer.id ? String(transfer.id) : null,
        });

        const auditRecord = audit.inscribe('ops.execute.withdraw_aud', ledgerId, actor);
        addictionMirror.recordActivity(sessionId, amountCents);
        events.emit('transaction', { type: 'withdrawal', ledger_id: ledgerId });

        return sendComplete(res, { ledger_id: ledgerId, audit_hash: auditRecord.hash, operation: parsed.operation });
      }

      case 'convert_to_btc': {
        sendStage(res, 'initiating', 'Preparing BTC market buy via Independent Reserve...');
        const amountAud = parsed.amount || 0;
        if (amountAud <= 0) return sendError(res, 'Invalid amount');

        sendStage(res, 'orderbook', 'Fetching BTC/AUD order book...');
        const book = await ir.getOrderBook('Xbt', 'Aud');
        const bestAsk = book.SellOrders && book.SellOrders[0] ? book.SellOrders[0].Price : 100000;
        const btcVolume = amountAud / bestAsk;

        sendStage(res, 'order', `Placing market buy for ${btcVolume.toFixed(8)} BTC...`);
        const order = await ir.placeMarketBuyOrder(btcVolume, 'Xbt', 'Aud');

        const amountCents = Math.round(amountAud * 100);
        const ledgerId = ledger.insertLedger({
          type: 'convert',
          amount_minor: amountCents,
          currency: 'AUD',
          amount_minor_to: Math.round(btcVolume * 1e8), // satoshi
          currency_to: 'BTC',
          to_ref: 'independent_reserve',
          status: 'completed',
          ai_action: parsed.operation,
          ai_confidence: parsed.confidence,
          external_id: order.OrderGuid || null,
        });

        const auditRecord = audit.inscribe('ops.execute.convert_to_btc', ledgerId, actor);
        addictionMirror.recordActivity(sessionId, amountCents);
        events.emit('transaction', { type: 'convert', ledger_id: ledgerId });

        return sendComplete(res, { ledger_id: ledgerId, audit_hash: auditRecord.hash, operation: parsed.operation, order });
      }

      case 'send_xmr': {
        sendStage(res, 'initiating', 'Preparing XMR transfer...');
        const amountXmr = parsed.amount || 0;
        const dest = parsed.destination;
        if (!dest) return sendError(res, 'Missing destination address');
        if (amountXmr <= 0) return sendError(res, 'Invalid amount');

        sendStage(res, 'validating', 'Validating Monero address...');
        const validation = await xmr.validateAddress(dest);
        if (validation.error) return sendError(res, `XMR node error: ${validation.error}`);
        if (!validation.valid) return sendError(res, 'Invalid Monero address');

        const piconero = Math.round(amountXmr * xmr.PICONERO);
        sendStage(res, 'transfer', `Sending ${amountXmr} XMR (${piconero} piconero)...`);
        const txResult = await xmr.transfer(dest, piconero);
        if (txResult.error) return sendError(res, `XMR transfer failed: ${txResult.error}`);

        const ledgerId = ledger.insertLedger({
          type: 'send',
          amount_minor: piconero,
          currency: 'XMR',
          to_ref: dest,
          status: 'completed',
          ai_action: parsed.operation,
          ai_confidence: parsed.confidence,
          external_id: txResult.tx_hash || null,
          metadata: { fee: txResult.fee, tx_key: txResult.tx_key },
        });

        const auditRecord = audit.inscribe('ops.execute.send_xmr', ledgerId, actor);
        addictionMirror.recordActivity(sessionId, Math.round(amountXmr * 100)); // rough AUD estimate
        events.emit('transaction', { type: 'send', ledger_id: ledgerId });

        return sendComplete(res, { ledger_id: ledgerId, audit_hash: auditRecord.hash, operation: parsed.operation, tx_hash: txResult.tx_hash });
      }

      case 'convert_forex': {
        sendStage(res, 'initiating', 'Preparing forex conversion via Wise...');
        const profileId = await getWiseProfileId();
        if (!profileId) return sendError(res, 'Wise profile not found');

        const source = parsed.currency_from || 'AUD';
        const target = parsed.currency_to || 'USD';
        const amountCents = Math.round((parsed.amount || 0) * 100);
        if (amountCents <= 0) return sendError(res, 'Invalid amount');

        sendStage(res, 'quote', `Creating quote ${source} -> ${target}...`);
        const quote = await wise.createQuote(profileId, source, target, amountCents);

        sendStage(res, 'recipient', 'Creating conversion recipient...');
        const recipient = await wise.createRecipient(profileId, target, '000-000', '00000000', 'KURO-PAY Self');

        sendStage(res, 'transfer', 'Executing conversion transfer...');
        const transfer = await wise.createTransfer(recipient.id, quote.id, 'KURO-PAY-FX');

        sendStage(res, 'funding', 'Funding from balance...');
        await wise.fundTransfer(profileId, transfer.id);

        const ledgerId = ledger.insertLedger({
          type: 'convert_forex',
          amount_minor: amountCents,
          currency: source,
          amount_minor_to: Math.round((quote.targetAmount || 0) * 100),
          currency_to: target,
          to_ref: 'wise_multi_currency',
          status: 'completed',
          ai_action: parsed.operation,
          ai_confidence: parsed.confidence,
          external_id: transfer.id ? String(transfer.id) : null,
          metadata: { rate: quote.rate, fee: quote.fee },
        });

        const auditRecord = audit.inscribe('ops.execute.convert_forex', ledgerId, actor);
        addictionMirror.recordActivity(sessionId, amountCents);
        events.emit('transaction', { type: 'convert_forex', ledger_id: ledgerId });

        return sendComplete(res, { ledger_id: ledgerId, audit_hash: auditRecord.hash, operation: parsed.operation, quote });
      }

      default:
        return sendError(res, `Unsupported operation: ${parsed.operation}`);
    }
  } catch (err) {
    console.error('[PAY::Ops] execute error:', err.message || err);
    sendError(res, err.message || 'Internal error during execution');
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/withdraw-aud — Wise withdrawal to BSB/account, SSE       */
/* ------------------------------------------------------------------ */

router.post('/withdraw-aud', async (req, res) => {
  initSSE(res);

  try {
    const { amount_cents, bsb, account_number, recipient_name, reference } = req.body || {};
    if (!amount_cents || amount_cents <= 0) return sendError(res, 'Invalid amount_cents');
    if (!bsb || !account_number) return sendError(res, 'bsb and account_number required');

    const actor = getActor(req);
    const sessionId = getSessionId(req);

    sendStage(res, 'profile', 'Resolving Wise profile...');
    const profileId = await getWiseProfileId();
    if (!profileId) return sendError(res, 'Wise profile not found');

    sendStage(res, 'quote', `Creating quote for ${amount_cents} cents AUD...`);
    const quote = await wise.createQuote(profileId, 'AUD', 'AUD', amount_cents);

    sendStage(res, 'recipient', `Creating recipient ${bsb}/${account_number}...`);
    const recipient = await wise.createRecipient(
      profileId, 'AUD', bsb, account_number, recipient_name || actor
    );

    sendStage(res, 'transfer', 'Creating transfer...');
    const transfer = await wise.createTransfer(recipient.id, quote.id, reference || 'KURO-PAY');

    sendStage(res, 'funding', 'Funding transfer from Wise balance...');
    const fund = await wise.fundTransfer(profileId, transfer.id);

    sendStage(res, 'recording', 'Recording in ledger...');
    const ledgerId = ledger.insertLedger({
      type: 'withdrawal',
      amount_minor: amount_cents,
      currency: 'AUD',
      to_ref: `${bsb}/${account_number}`,
      status: fund.status === 'COMPLETED' ? 'completed' : 'pending',
      external_id: transfer.id ? String(transfer.id) : null,
      metadata: { bsb, account_number, recipient_name, fund_status: fund.status },
    });

    const auditRecord = audit.inscribe('ops.withdraw_aud', ledgerId, actor);
    addictionMirror.recordActivity(sessionId, amount_cents);
    events.emit('transaction', { type: 'withdrawal', ledger_id: ledgerId, amount_minor: amount_cents });

    sendComplete(res, {
      ledger_id: ledgerId,
      audit_hash: auditRecord.hash,
      transfer_id: transfer.id,
      fund_status: fund.status,
    });
  } catch (err) {
    console.error('[PAY::Ops] withdraw-aud error:', err.message || err);
    sendError(res, err.message || 'Withdrawal failed');
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/convert-to-btc — IR market buy, SSE                     */
/* ------------------------------------------------------------------ */

router.post('/convert-to-btc', async (req, res) => {
  initSSE(res);

  try {
    const { amount_aud } = req.body || {};
    if (!amount_aud || amount_aud <= 0) return sendError(res, 'Invalid amount_aud');

    const actor = getActor(req);
    const sessionId = getSessionId(req);

    sendStage(res, 'orderbook', 'Fetching BTC/AUD order book...');
    const book = await ir.getOrderBook('Xbt', 'Aud');
    const bestAsk = book.SellOrders && book.SellOrders[0] ? book.SellOrders[0].Price : 0;
    if (bestAsk <= 0) return sendError(res, 'Could not determine BTC price from order book');

    const btcVolume = amount_aud / bestAsk;

    sendStage(res, 'order', `Placing market buy for ${btcVolume.toFixed(8)} BTC at ~$${bestAsk.toFixed(2)} AUD...`);
    const order = await ir.placeMarketBuyOrder(btcVolume, 'Xbt', 'Aud');

    sendStage(res, 'recording', 'Recording in ledger...');
    const amountCents = Math.round(amount_aud * 100);
    const ledgerId = ledger.insertLedger({
      type: 'convert',
      amount_minor: amountCents,
      currency: 'AUD',
      amount_minor_to: Math.round(btcVolume * 1e8),
      currency_to: 'BTC',
      to_ref: 'independent_reserve',
      status: order.Status === 'Filled' ? 'completed' : 'pending',
      external_id: order.OrderGuid || null,
      metadata: { best_ask: bestAsk, volume: btcVolume, order_status: order.Status },
    });

    const auditRecord = audit.inscribe('ops.convert_to_btc', ledgerId, actor);
    addictionMirror.recordActivity(sessionId, amountCents);
    events.emit('transaction', { type: 'convert', ledger_id: ledgerId, amount_minor: amountCents });

    sendComplete(res, {
      ledger_id: ledgerId,
      audit_hash: auditRecord.hash,
      order_guid: order.OrderGuid,
      btc_volume: btcVolume,
      price_aud: bestAsk,
    });
  } catch (err) {
    console.error('[PAY::Ops] convert-to-btc error:', err.message || err);
    sendError(res, err.message || 'BTC conversion failed');
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/send-xmr — Monero transfer, SSE                         */
/* ------------------------------------------------------------------ */

router.post('/send-xmr', async (req, res) => {
  initSSE(res);

  try {
    const { address, amount_xmr, priority } = req.body || {};
    if (!address) return sendError(res, 'Missing destination address');
    if (!amount_xmr || amount_xmr <= 0) return sendError(res, 'Invalid amount_xmr');

    const actor = getActor(req);
    const sessionId = getSessionId(req);

    sendStage(res, 'validating', 'Validating Monero address...');
    const validation = await xmr.validateAddress(address);
    if (validation.error) return sendError(res, `XMR node error: ${validation.error}`);
    if (!validation.valid) return sendError(res, 'Invalid Monero address');

    const piconero = Math.round(amount_xmr * xmr.PICONERO);

    sendStage(res, 'balance', 'Checking XMR balance...');
    const balance = await xmr.getBalance();
    if (balance.error) return sendError(res, `XMR balance error: ${balance.error}`);
    if (balance.unlocked_balance < piconero) {
      return sendError(res, `Insufficient XMR balance. Have: ${(balance.unlocked_balance / xmr.PICONERO).toFixed(12)}, need: ${amount_xmr}`);
    }

    sendStage(res, 'transfer', `Sending ${amount_xmr} XMR to ${address.slice(0, 8)}...${address.slice(-8)}...`);
    const txResult = await xmr.transfer(address, piconero, priority || 1);
    if (txResult.error) return sendError(res, `XMR transfer failed: ${txResult.error}`);

    sendStage(res, 'recording', 'Recording in ledger...');
    const ledgerId = ledger.insertLedger({
      type: 'send',
      amount_minor: piconero,
      currency: 'XMR',
      to_ref: address,
      status: 'completed',
      external_id: txResult.tx_hash || null,
      metadata: { fee: txResult.fee, tx_key: txResult.tx_key, priority: priority || 1 },
    });

    const auditRecord = audit.inscribe('ops.send_xmr', ledgerId, actor);
    addictionMirror.recordActivity(sessionId, Math.round(amount_xmr * 100));
    events.emit('transaction', { type: 'send_xmr', ledger_id: ledgerId });

    sendComplete(res, {
      ledger_id: ledgerId,
      audit_hash: auditRecord.hash,
      tx_hash: txResult.tx_hash,
      tx_key: txResult.tx_key,
      fee: txResult.fee,
    });
  } catch (err) {
    console.error('[PAY::Ops] send-xmr error:', err.message || err);
    sendError(res, err.message || 'XMR transfer failed');
  }
});

/* ------------------------------------------------------------------ */
/*  POST /ops/convert-forex — Wise currency conversion, SSE            */
/* ------------------------------------------------------------------ */

router.post('/convert-forex', async (req, res) => {
  initSSE(res);

  try {
    const { source_currency, target_currency, amount_cents, reference } = req.body || {};
    if (!source_currency || !target_currency) return sendError(res, 'source_currency and target_currency required');
    if (!amount_cents || amount_cents <= 0) return sendError(res, 'Invalid amount_cents');

    const actor = getActor(req);
    const sessionId = getSessionId(req);

    sendStage(res, 'profile', 'Resolving Wise profile...');
    const profileId = await getWiseProfileId();
    if (!profileId) return sendError(res, 'Wise profile not found');

    sendStage(res, 'quote', `Creating quote ${source_currency} -> ${target_currency}...`);
    const quote = await wise.createQuote(profileId, source_currency, target_currency, amount_cents);

    sendStage(res, 'recipient', `Setting up ${target_currency} recipient...`);
    const recipient = await wise.createRecipient(profileId, target_currency, '000-000', '00000000', 'KURO-PAY Self');

    sendStage(res, 'transfer', 'Executing conversion...');
    const transfer = await wise.createTransfer(recipient.id, quote.id, reference || 'KURO-PAY-FX');

    sendStage(res, 'funding', 'Funding from balance...');
    const fund = await wise.fundTransfer(profileId, transfer.id);

    sendStage(res, 'recording', 'Recording in ledger...');
    const ledgerId = ledger.insertLedger({
      type: 'convert_forex',
      amount_minor: amount_cents,
      currency: source_currency,
      amount_minor_to: Math.round((quote.targetAmount || 0) * 100),
      currency_to: target_currency,
      to_ref: 'wise_multi_currency',
      status: fund.status === 'COMPLETED' ? 'completed' : 'pending',
      external_id: transfer.id ? String(transfer.id) : null,
      metadata: { rate: quote.rate, fee: quote.fee, fund_status: fund.status },
    });

    const auditRecord = audit.inscribe('ops.convert_forex', ledgerId, actor);
    addictionMirror.recordActivity(sessionId, amount_cents);
    events.emit('transaction', { type: 'convert_forex', ledger_id: ledgerId, amount_minor: amount_cents });

    sendComplete(res, {
      ledger_id: ledgerId,
      audit_hash: auditRecord.hash,
      rate: quote.rate,
      fee: quote.fee,
      source: { amount: amount_cents, currency: source_currency },
      target: { amount: Math.round((quote.targetAmount || 0) * 100), currency: target_currency },
    });
  } catch (err) {
    console.error('[PAY::Ops] convert-forex error:', err.message || err);
    sendError(res, err.message || 'Forex conversion failed');
  }
});

module.exports = router;
