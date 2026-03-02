/**
 * KURO::WAGER — Pipeline Orchestrator
 * Runs the full three-layer cycle: Fusion → Quantum → Tesla
 */
'use strict';

const db = require('./db.cjs');
const fusion = require('./fusion.cjs');
const quantum = require('./quantum.cjs');
const tesla = require('./tesla.cjs');

async function runPipeline() {
  const runId = db.insertRun();
  console.log(`[KURO::WAGER] Pipeline run #${runId} started`);

  try {
    // ── Layer 1: FUSION CORE — data ingestion ───────────────────────────
    const fusionResult = await fusion.ingestAll();
    const eventsFound = db.getAllEvents().length;
    console.log(`[KURO::WAGER] Fusion: ${eventsFound} events, mock=${fusionResult.mock}`);

    db.updateRun(runId, { events_found: eventsFound });

    // ── Layer 2: QUANTUM FILTER — signal extraction ─────────────────────
    const opportunities = quantum.filterOpportunities();
    console.log(`[KURO::WAGER] Quantum: ${opportunities.length} signals above threshold`);

    db.updateRun(runId, { signals_found: opportunities.length });

    // ── Layer 3: TESLA DISCHARGE — stake allocation ─────────────────────
    const { selections, totalStake, budget } = tesla.allocateSlate(opportunities);
    console.log(`[KURO::WAGER] Tesla: ${selections.length} selections, $${totalStake}/$${budget} allocated`);

    // Create slate record
    const slateId = db.insertSlate(budget);

    // Insert selections
    for (const s of selections) {
      db.insertSelection({
        slate_id: slateId,
        event_id: s.eventId,
        sport_key: s.sportKey,
        home_team: s.homeTeam,
        away_team: s.awayTeam,
        commence_time: s.commenceTime,
        selection_name: s.selectionName,
        market_key: s.marketKey,
        best_odds: s.bestOdds,
        best_bookmaker: s.bestBookmaker,
        implied_prob: s.impliedProb,
        model_prob: s.modelProb,
        edge: s.edge,
        confidence: s.confidence,
        kelly_stake: s.kelly_stake,
        actual_stake: s.actual_stake,
      });
    }

    // Update slate budget usage
    db.updateSlate(slateId, { budget_used: totalStake });

    // Record stakes in ledger
    for (const s of selections) {
      db.insertLedger('stake', -s.actual_stake, `${s.selectionName} @ ${s.bestOdds}`, slateId);
    }

    // Generate report
    const runLog = { events_found: eventsFound, signals_found: opportunities.length };
    const report = tesla.generateReport({ id: slateId }, selections, runLog);
    db.updateSlate(slateId, { report_md: report });

    // Complete run
    db.updateRun(runId, {
      completed_at: new Date().toISOString(),
      status: 'completed',
      selections_made: selections.length,
      slate_id: slateId,
      log_md: report,
    });

    console.log(`[KURO::WAGER] Pipeline run #${runId} completed — slate #${slateId}`);

    return {
      runId,
      slateId,
      events: eventsFound,
      signals: opportunities.length,
      selections: selections.length,
      totalStake,
      budget,
      mock: fusionResult.mock,
      slate: db.getSlate(slateId),
      report,
    };

  } catch (e) {
    db.updateRun(runId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      error: e.message,
    });
    console.error(`[KURO::WAGER] Pipeline run #${runId} failed:`, e.message);
    throw e;
  }
}

function settleSelection(selectionId, result, settledOdds) {
  const sel = db.getDb().prepare('SELECT * FROM selections WHERE id = ?').get(selectionId);
  if (!sel) throw new Error(`Selection ${selectionId} not found`);
  if (sel.result !== 'pending') throw new Error(`Selection already settled: ${sel.result}`);

  let pnl = 0;
  if (result === 'win') {
    pnl = sel.actual_stake * (settledOdds || sel.best_odds) - sel.actual_stake;
    db.insertLedger('return', sel.actual_stake + pnl, `WIN: ${sel.selection_name}`, sel.slate_id, selectionId);
  } else if (result === 'push') {
    pnl = 0;
    db.insertLedger('return', sel.actual_stake, `PUSH: ${sel.selection_name}`, sel.slate_id, selectionId);
  } else if (result === 'void') {
    pnl = 0;
    db.insertLedger('return', sel.actual_stake, `VOID: ${sel.selection_name}`, sel.slate_id, selectionId);
  }
  // loss: no return, pnl = -stake (already deducted via ledger at creation)
  if (result === 'loss') pnl = -sel.actual_stake;

  db.updateSelectionResult(selectionId, result, settledOdds || sel.best_odds, pnl);

  // Update slate P&L
  const sels = db.getDb().prepare('SELECT * FROM selections WHERE slate_id = ?').all(sel.slate_id);
  const allSettled = sels.every(s => s.result !== 'pending');
  const totalPnl = sels.reduce((s, x) => s + (x.pnl || 0), 0);

  const slateUpdate = { total_pnl: totalPnl };
  if (allSettled) {
    slateUpdate.status = 'settled';
    slateUpdate.settled_at = new Date().toISOString();
  }
  db.updateSlate(sel.slate_id, slateUpdate);

  return { selectionId, result, pnl, slateSettled: allSettled };
}

function getStatus() {
  const config = db.getAllConfig();
  const lastRun = db.getLatestRun();
  const activeSlate = db.getActiveSlate();
  const balance = db.getBalance();
  const allSlates = db.listSlates(100);
  const totalPnl = allSlates.reduce((s, x) => s + (x.total_pnl || 0), 0);
  const wins = db.getDb().prepare("SELECT COUNT(*) as c FROM selections WHERE result = 'win'").get().c;
  const losses = db.getDb().prepare("SELECT COUNT(*) as c FROM selections WHERE result = 'loss'").get().c;
  const pending = db.getDb().prepare("SELECT COUNT(*) as c FROM selections WHERE result = 'pending'").get().c;

  return {
    config,
    balance,
    lastRun,
    activeSlate,
    record: { wins, losses, pending, totalPnl: Math.round(totalPnl * 100) / 100 },
    slateCount: allSlates.length,
    mock: !process.env.ODDS_API_KEY,
  };
}

module.exports = { runPipeline, settleSelection, getStatus };
