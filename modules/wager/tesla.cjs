/**
 * KURO::WAGER — Layer 3: TESLA DISCHARGE
 * Kelly Criterion stake sizing + slate allocation + report generation.
 */
'use strict';

const db = require('./db.cjs');

// ── Kelly Criterion ─────────────────────────────────────────────────────────

/**
 * Fractional Kelly stake calculation.
 * @param {number} modelProb - estimated true probability of winning
 * @param {number} decimalOdds - best available decimal odds
 * @param {number} bankroll - current bankroll in AUD
 * @param {number} fraction - Kelly fraction (0.25 = quarter Kelly)
 * @returns {{ rawKelly, fractionalKelly, stake }}
 */
function kellyStake(modelProb, decimalOdds, bankroll, fraction = 0.25) {
  const b = decimalOdds - 1; // net odds (profit per $1 wagered)
  const p = modelProb;
  const q = 1 - p;

  // Full Kelly: f* = (bp - q) / b
  const rawKelly = (b * p - q) / b;

  // Negative Kelly means no edge — don't bet
  if (rawKelly <= 0) return { rawKelly: 0, fractionalKelly: 0, stake: 0 };

  const fractionalKelly = rawKelly * fraction;
  const stake = Math.max(0, bankroll * fractionalKelly);

  return {
    rawKelly: round2(rawKelly),
    fractionalKelly: round2(fractionalKelly),
    stake: round2(stake),
  };
}

// ── Slate allocation ────────────────────────────────────────────────────────

/**
 * Build a bet slate from filtered opportunities.
 * @param {Array} opportunities - sorted by edge desc (from quantum.filterOpportunities)
 * @returns {{ slate, selections, totalStake }}
 */
function allocateSlate(opportunities) {
  const config = db.getAllConfig();
  const budget = parseFloat(config.budget_fortnightly || '30');
  const maxSelections = parseInt(config.max_selections || '3', 10);
  const kellyFraction = parseFloat(config.kelly_fraction || '0.25');
  const bankroll = Math.max(parseFloat(config.bankroll || '0'), budget);

  // Confidence-tier stake caps (% of budget)
  const tierCaps = { HIGH: 0.40, PROBABLE: 0.30, SPECULATIVE: 0.20 };

  // Deduplicate: one selection per event (take best edge per event)
  const seenEvents = new Set();
  const unique = [];
  for (const opp of opportunities) {
    if (seenEvents.has(opp.eventId)) continue;
    seenEvents.add(opp.eventId);
    unique.push(opp);
  }

  // Take top N
  const top = unique.slice(0, maxSelections);

  const selections = [];
  let totalStake = 0;

  for (const opp of top) {
    const kelly = kellyStake(opp.modelProb, opp.bestOdds, bankroll, kellyFraction);
    if (kelly.stake <= 0) continue;

    // Apply confidence-tier cap
    const tierCap = (tierCaps[opp.confidence] || 0.2) * budget;
    let stake = Math.min(kelly.stake, tierCap);

    // Ensure we don't exceed remaining budget
    if (totalStake + stake > budget) {
      stake = budget - totalStake;
    }

    // Round to nearest $1 (bookmaker-friendly)
    stake = Math.round(stake);
    if (stake < 1) continue;

    totalStake += stake;

    selections.push({
      ...opp,
      kellyRaw: kelly.rawKelly,
      kellyFractional: kelly.fractionalKelly,
      kelly_stake: kelly.stake,
      actual_stake: stake,
    });

    if (totalStake >= budget) break;
  }

  return { selections, totalStake, budget, remaining: budget - totalStake };
}

// ── Report generation ───────────────────────────────────────────────────────

function generateReport(slate, selections, runLog) {
  const now = new Date().toISOString().split('T')[0];
  const config = db.getAllConfig();

  let md = `# KURO::WAGER — Slate ${now}\n\n`;
  md += `**Budget:** $${config.budget_fortnightly} AUD | **Bankroll:** $${round2(parseFloat(config.bankroll || '0'))} | **Selections:** ${selections.length}/${config.max_selections}\n\n`;

  if (runLog) {
    md += `## Pipeline Summary\n`;
    md += `- Events scanned: ${runLog.events_found || 0}\n`;
    md += `- Signals found: ${runLog.signals_found || 0}\n`;
    md += `- Selections made: ${selections.length}\n\n`;
  }

  if (selections.length === 0) {
    md += `> No value detected this cycle. No discharge.\n`;
    return md;
  }

  md += `## Selections\n\n`;

  for (let i = 0; i < selections.length; i++) {
    const s = selections[i];
    const tier = s.confidence;
    const badge = tier === 'HIGH' ? '🟣' : tier === 'PROBABLE' ? '🔵' : '⚪';

    md += `### ${i + 1}. ${s.selectionName} ${badge} ${tier}\n`;
    md += `| | |\n|---|---|\n`;
    md += `| **Event** | ${s.homeTeam} vs ${s.awayTeam} |\n`;
    md += `| **Sport** | ${formatSport(s.sportKey)} |\n`;
    md += `| **Kick-off** | ${new Date(s.commenceTime).toLocaleString('en-AU')} |\n`;
    md += `| **Best Odds** | ${s.bestOdds} (${s.bestBookmaker}) |\n`;
    md += `| **Edge** | ${(s.edge * 100).toFixed(1)}% |\n`;
    md += `| **Model Prob** | ${(s.modelProb * 100).toFixed(1)}% |\n`;
    md += `| **Implied Prob** | ${(s.impliedProb * 100).toFixed(1)}% |\n`;
    md += `| **Kelly (raw/frac)** | ${(s.kellyRaw * 100).toFixed(1)}% / ${(s.kellyFractional * 100).toFixed(1)}% |\n`;
    md += `| **Stake** | **$${s.actual_stake}** |\n`;
    md += `| **Line Movement** | ${s.lineMovement} |\n\n`;
  }

  const totalStake = selections.reduce((s, x) => s + x.actual_stake, 0);
  md += `---\n\n**Total Stake:** $${totalStake} / $${config.budget_fortnightly}\n\n`;
  md += `*Generated by KURO::WAGER — stake small, observe signal, let the discharge do the work.*\n`;

  return md;
}

function formatSport(key) {
  const map = {
    'aussierules_afl': 'AFL',
    'rugbyleague_nrl': 'NRL',
    'soccer_australia_aleague': 'A-League',
  };
  return map[key] || key;
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { kellyStake, allocateSlate, generateReport };
