/**
 * KURO::WAGER — Layer 2: QUANTUM FILTER
 * Signal extraction: devig, line movement, composite scoring, filtering.
 * Pure deterministic math — no ML, no external calls.
 */
'use strict';

const db = require('./db.cjs');

// ── Implied probability inversion (devigging) ──────────────────────────────

/**
 * Remove bookmaker margin using proportional method.
 * @param {Array} outcomes - [{ name, price }]
 * @returns {Array} - [{ name, price, implied, trueProb, margin }]
 */
function devigOutcomes(outcomes) {
  const implied = outcomes.map(o => ({ ...o, implied: 1 / o.price }));
  const total = implied.reduce((s, o) => s + o.implied, 0);
  const margin = total - 1; // overround

  return implied.map(o => ({
    ...o,
    trueProb: round4(o.implied / total),
    margin: round4(margin),
  }));
}

/**
 * For an event, get the market consensus (average devigged probability across all bookmakers).
 */
function marketConsensus(eventId) {
  const odds = db.getLatestOdds(eventId);
  if (!odds.length) return null;

  // Group by bookmaker, then devig each bookmaker's h2h market
  const byBookmaker = {};
  for (const row of odds) {
    if (row.market_key !== 'h2h') continue;
    if (!byBookmaker[row.bookmaker_key]) byBookmaker[row.bookmaker_key] = [];
    byBookmaker[row.bookmaker_key].push({ name: row.outcome_name, price: row.outcome_price });
  }

  // Devig each bookmaker and average
  const probSums = {};
  const probCounts = {};
  const bestOdds = {}; // track best available price per outcome

  for (const [bkKey, outcomes] of Object.entries(byBookmaker)) {
    const devigged = devigOutcomes(outcomes);
    for (const o of devigged) {
      probSums[o.name] = (probSums[o.name] || 0) + o.trueProb;
      probCounts[o.name] = (probCounts[o.name] || 0) + 1;

      if (!bestOdds[o.name] || o.price > bestOdds[o.name].price) {
        bestOdds[o.name] = { price: o.price, bookmaker: bkKey };
      }
    }
  }

  const consensus = {};
  for (const name of Object.keys(probSums)) {
    consensus[name] = {
      trueProb: round4(probSums[name] / probCounts[name]),
      bookmakerCount: probCounts[name],
      bestOdds: bestOdds[name].price,
      bestBookmaker: bestOdds[name].bookmaker,
    };
  }

  return consensus;
}

// ── Line movement detection ─────────────────────────────────────────────────

/**
 * Compare opening vs current odds for an event.
 * Returns movement per outcome across bookmakers.
 */
function detectLineMovement(eventId) {
  const opening = db.getOpeningOdds(eventId);
  const current = db.getLatestOdds(eventId);

  if (!opening.length || !current.length) return null;

  // Build lookup: bookmaker+outcome → opening price
  const openMap = {};
  for (const r of opening) {
    if (r.market_key !== 'h2h') continue;
    openMap[`${r.bookmaker_key}:${r.outcome_name}`] = r.outcome_price;
  }

  // Compare each current price to its opening
  const movements = {};
  for (const r of current) {
    if (r.market_key !== 'h2h') continue;
    const openPrice = openMap[`${r.bookmaker_key}:${r.outcome_name}`];
    if (!openPrice) continue;

    const openImpl = 1 / openPrice;
    const currImpl = 1 / r.outcome_price;
    const shift = currImpl - openImpl; // positive = shorter odds = more money on this outcome

    if (!movements[r.outcome_name]) {
      movements[r.outcome_name] = { shifts: [], avgShift: 0, direction: 'stable', bookmakersMoved: 0 };
    }
    movements[r.outcome_name].shifts.push({
      bookmaker: r.bookmaker_key,
      openPrice, currentPrice: r.outcome_price,
      impliedShift: round4(shift),
    });
  }

  // Aggregate
  for (const [name, m] of Object.entries(movements)) {
    const significantShifts = m.shifts.filter(s => Math.abs(s.impliedShift) > 0.02);
    m.bookmakersMoved = significantShifts.length;
    m.avgShift = round4(m.shifts.reduce((s, x) => s + x.impliedShift, 0) / m.shifts.length);
    m.direction = m.avgShift > 0.02 ? 'steam' : m.avgShift < -0.02 ? 'drift' : 'stable';
  }

  return movements;
}

// ── Squiggle signal (AFL only) ──────────────────────────────────────────────

function getSquiggleSignal(homeTeam, awayTeam) {
  const pred = db.getPrediction(homeTeam, awayTeam);
  if (!pred || pred.home_prob == null) return null;

  return {
    homeProb: pred.home_prob,
    awayProb: round4(1 - pred.home_prob),
    margin: pred.margin,
    source: pred.source,
  };
}

// ── Composite signal builder ────────────────────────────────────────────────

function buildCompositeSignal(eventId, sportKey) {
  const consensus = marketConsensus(eventId);
  if (!consensus) return null;

  const movement = detectLineMovement(eventId);
  const event = db.getLatestOdds(eventId)[0];
  if (!event) return null;

  const isAFL = sportKey === 'aussierules_afl';
  const squiggle = isAFL ? getSquiggleSignal(event.home_team, event.away_team) : null;

  const signals = [];

  for (const [name, con] of Object.entries(consensus)) {
    let modelProb = con.trueProb;

    // Merge Squiggle signal if AFL
    if (squiggle) {
      const sqProb = name === event.home_team ? squiggle.homeProb : squiggle.awayProb;
      // AFL: 60% market consensus + 30% Squiggle + 10% movement adjustment
      modelProb = con.trueProb * 0.6 + sqProb * 0.3 + con.trueProb * 0.1;
    } else {
      // NRL/A-League: 85% market consensus + 15% movement adjustment
      modelProb = con.trueProb * 0.85 + con.trueProb * 0.15;
    }

    // Apply line movement bonus/penalty
    if (movement?.[name]) {
      const mv = movement[name];
      if (mv.direction === 'steam' && mv.bookmakersMoved >= 2) {
        modelProb += 0.02; // steam = market confidence increasing
      } else if (mv.direction === 'drift' && mv.bookmakersMoved >= 2) {
        modelProb -= 0.01; // drift = market losing confidence
      }
    }

    modelProb = Math.min(0.95, Math.max(0.05, round4(modelProb)));
    const impliedProb = 1 / con.bestOdds;
    const edge = round4(modelProb - impliedProb);

    signals.push({
      eventId,
      sportKey,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      selectionName: name,
      marketKey: 'h2h',
      bestOdds: con.bestOdds,
      bestBookmaker: con.bestBookmaker,
      impliedProb: round4(impliedProb),
      modelProb,
      edge,
      confidence: edge > 0.08 ? 'HIGH' : edge > 0.05 ? 'PROBABLE' : edge > 0.03 ? 'SPECULATIVE' : null,
      lineMovement: movement?.[name]?.direction || 'stable',
      squiggleProb: squiggle ? (name === event.home_team ? squiggle.homeProb : squiggle.awayProb) : null,
      bookmakerConsensus: con.trueProb,
    });
  }

  return signals;
}

// ── Filter opportunities ────────────────────────────────────────────────────

function filterOpportunities() {
  const config = db.getAllConfig();
  const floor = parseFloat(config.confidence_floor || '0.03');
  const events = db.getAllEvents();
  const all = [];

  for (const ev of events) {
    const signals = buildCompositeSignal(ev.event_id, ev.sport_key);
    if (!signals) continue;
    for (const s of signals) {
      if (s.edge >= floor && s.confidence) {
        all.push(s);
      }
    }
  }

  // Sort by edge descending
  all.sort((a, b) => b.edge - a.edge);
  return all;
}

function round4(n) { return Math.round(n * 10000) / 10000; }

module.exports = { devigOutcomes, marketConsensus, detectLineMovement, getSquiggleSignal, buildCompositeSignal, filterOpportunities };
