/**
 * KURO::WAGER — Express Router
 * All endpoints mounted at /wager/* in server.cjs
 */
'use strict';

const express = require('express');
const router = express.Router();
router.use(express.json());

const engine = require('./engine.cjs');
const db = require('./db.cjs');
const quantum = require('./quantum.cjs');

// GET /wager/status
router.get('/status', (req, res) => {
  try {
    res.json(engine.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /wager/run — trigger full pipeline
router.post('/run', async (req, res) => {
  try {
    const result = await engine.runPipeline();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/slate — current active slate
router.get('/slate', (req, res) => {
  try {
    const slate = db.getActiveSlate();
    res.json({ slate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/markets — upcoming events with odds
router.get('/markets', (req, res) => {
  try {
    const sport = req.query.sport;
    const events = db.getUpcomingEvents(sport || null);
    const enriched = events.map(ev => {
      const latest = db.getLatestOdds(ev.event_id);
      const consensus = quantum.marketConsensus(ev.event_id);
      const movement = quantum.detectLineMovement(ev.event_id);
      return { ...ev, odds: latest, consensus, movement };
    });
    res.json({ markets: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/odds/:sport — raw odds
router.get('/odds/:sport', (req, res) => {
  try {
    const events = db.getUpcomingEvents(req.params.sport);
    const data = events.map(ev => ({
      ...ev,
      odds: db.getLatestOdds(ev.event_id),
    }));
    res.json({ events: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/history — past slates
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const slates = db.listSlates(limit);
    res.json({ slates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/history/:id — specific slate detail
router.get('/history/:id', (req, res) => {
  try {
    const slate = db.getSlate(parseInt(req.params.id, 10));
    if (!slate) return res.status(404).json({ error: 'Slate not found' });
    res.json({ slate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/config
router.get('/config', (req, res) => {
  try {
    res.json({ config: db.getAllConfig() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /wager/config — update config
router.post('/config', (req, res) => {
  try {
    const allowed = ['budget_fortnightly', 'max_selections', 'kelly_fraction', 'confidence_floor', 'sports'];
    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) db.setConfig(key, value);
    }
    res.json({ config: db.getAllConfig() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /wager/settle/:selectionId
router.post('/settle/:selectionId', (req, res) => {
  try {
    const { result, settledOdds } = req.body;
    if (!['win', 'loss', 'push', 'void'].includes(result)) {
      return res.status(400).json({ error: 'result must be win/loss/push/void' });
    }
    const r = engine.settleSelection(parseInt(req.params.selectionId, 10), result, settledOdds);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /wager/bankroll — deposit or withdraw
router.post('/bankroll', (req, res) => {
  try {
    const { type, amount, note } = req.body;
    if (!['deposit', 'withdrawal'].includes(type)) {
      return res.status(400).json({ error: 'type must be deposit/withdrawal' });
    }
    const amt = type === 'withdrawal' ? -Math.abs(amount) : Math.abs(amount);
    const newBal = db.insertLedger(type, amt, note || type);
    res.json({ balance: newBal });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /wager/ledger — transaction history
router.get('/ledger', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    res.json({ ledger: db.getLedgerHistory(limit), balance: db.getBalance() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /wager/runs — pipeline run history
router.get('/runs', (req, res) => {
  try {
    res.json({ runs: db.listRuns(20) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
