/**
 * KURO::WAGER — Layer 1: FUSION CORE
 * Data ingestion from TheOddsAPI + Squiggle + mock data fallback.
 */
'use strict';

const axios = require('axios');
const db = require('./db.cjs');

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SQUIGGLE_BASE = 'https://api.squiggle.com.au';
const UA = 'KURO::WAGER/1.0 (kuroglass.net)';

// Rate limiter for Squiggle (1 req/min)
let _lastSquiggleReq = 0;
async function squiggleThrottle() {
  const now = Date.now();
  const wait = 60000 - (now - _lastSquiggleReq);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastSquiggleReq = Date.now();
}

// ── TheOddsAPI ingestion ────────────────────────────────────────────────────

async function fetchOddsAPI(sportKey) {
  if (!ODDS_API_KEY) return { events: 0, snapshots: 0, mock: true };

  const { data, headers } = await axios.get(`${ODDS_API_BASE}/sports/${sportKey}/odds`, {
    params: { apiKey: ODDS_API_KEY, regions: 'au', markets: 'h2h,spreads,totals', oddsFormat: 'decimal' },
    timeout: 15000,
    headers: { 'User-Agent': UA },
  });

  let snapCount = 0;
  for (const ev of data) {
    for (const bk of (ev.bookmakers || [])) {
      for (const mkt of (bk.markets || [])) {
        for (const out of (mkt.outcomes || [])) {
          db.insertOddsSnapshot({
            sport_key: sportKey,
            event_id: ev.id,
            commence_time: ev.commence_time,
            home_team: ev.home_team,
            away_team: ev.away_team,
            bookmaker_key: bk.key,
            bookmaker: bk.title,
            market_key: mkt.key,
            outcome_name: out.name,
            outcome_price: out.price,
            outcome_point: out.point || null,
          });
          snapCount++;
        }
      }
    }
  }

  return {
    events: data.length,
    snapshots: snapCount,
    remaining: parseInt(headers['x-requests-remaining'] || '0', 10),
    used: parseInt(headers['x-requests-used'] || '0', 10),
  };
}

// ── Squiggle ingestion (AFL only) ───────────────────────────────────────────

async function fetchSquiggleGames(year, round) {
  await squiggleThrottle();
  const params = { q: 'games' };
  if (year) params.year = year;
  if (round) params.round = round;

  const { data } = await axios.get(SQUIGGLE_BASE, {
    params, timeout: 10000,
    headers: { 'User-Agent': UA },
  });

  let count = 0;
  for (const g of (data.games || [])) {
    try {
      db.insertPrediction({
        game_id: g.id, round: g.round, year: g.year,
        home_team: g.hteam, away_team: g.ateam,
        home_score: g.hscore, away_score: g.ascore,
        home_prob: g.hconfidence, margin: g.hmargin,
        source: 'squiggle',
      });
      count++;
    } catch (e) { /* dupe — ignore */ }
  }
  return { games: count };
}

async function fetchSquiggleRankings() {
  await squiggleThrottle();
  const year = new Date().getFullYear();
  const { data } = await axios.get(SQUIGGLE_BASE, {
    params: { q: 'standings', year },
    timeout: 10000,
    headers: { 'User-Agent': UA },
  });

  let count = 0;
  for (const s of (data.standings || [])) {
    db.insertRanking({
      team: s.name, rank: s.rank, rating: s.percentage,
      year, round: s.round || null,
    });
    count++;
  }
  return { rankings: count };
}

// ── Mock data seeding ───────────────────────────────────────────────────────

function seedMockData() {
  const now = new Date();
  const sports = [
    {
      key: 'aussierules_afl', events: [
        { id: 'afl-r1-001', home: 'Melbourne Demons', away: 'Carlton Blues', time: daysFromNow(2) },
        { id: 'afl-r1-002', home: 'Collingwood Magpies', away: 'Geelong Cats', time: daysFromNow(3) },
        { id: 'afl-r1-003', home: 'Brisbane Lions', away: 'Sydney Swans', time: daysFromNow(3) },
        { id: 'afl-r1-004', home: 'Western Bulldogs', away: 'Richmond Tigers', time: daysFromNow(4) },
      ]
    },
    {
      key: 'rugbyleague_nrl', events: [
        { id: 'nrl-r1-001', home: 'Penrith Panthers', away: 'Melbourne Storm', time: daysFromNow(2) },
        { id: 'nrl-r1-002', home: 'Sydney Roosters', away: 'South Sydney Rabbitohs', time: daysFromNow(3) },
        { id: 'nrl-r1-003', home: 'Brisbane Broncos', away: 'Cronulla Sharks', time: daysFromNow(4) },
      ]
    },
    {
      key: 'soccer_australia_aleague', events: [
        { id: 'ale-r1-001', home: 'Melbourne Victory', away: 'Sydney FC', time: daysFromNow(1) },
        { id: 'ale-r1-002', home: 'Western Sydney', away: 'Melbourne City', time: daysFromNow(3) },
      ]
    }
  ];

  const bookmakers = [
    { key: 'sportsbet', name: 'Sportsbet' },
    { key: 'tab', name: 'TAB' },
    { key: 'ladbrokes_au', name: 'Ladbrokes' },
    { key: 'pointsbet_au', name: 'PointsBet' },
    { key: 'betfair_ex_au', name: 'Betfair Exchange' },
  ];

  // Check if we already have data
  const existing = db.getAllEvents();
  if (existing.length > 0) return { seeded: false, existing: existing.length };

  let snapCount = 0;
  for (const sport of sports) {
    for (const ev of sport.events) {
      // Generate realistic odds with bookmaker variation
      const trueHomeProb = 0.3 + Math.random() * 0.4; // 30-70%
      const trueAwayProb = 1 - trueHomeProb;

      for (const bk of bookmakers) {
        const margin = 1.03 + Math.random() * 0.04; // 3-7% overround
        const noise = () => (Math.random() - 0.5) * 0.06;

        const homeOdds = round2(margin / (trueHomeProb + noise()));
        const awayOdds = round2(margin / (trueAwayProb + noise()));

        // H2H market
        for (const [name, price] of [[ev.home, homeOdds], [ev.away, awayOdds]]) {
          db.insertOddsSnapshot({
            sport_key: sport.key, event_id: ev.id, commence_time: ev.time,
            home_team: ev.home, away_team: ev.away,
            bookmaker_key: bk.key, bookmaker: bk.name,
            market_key: 'h2h', outcome_name: name, outcome_price: price, outcome_point: null,
          });
          snapCount++;
        }
      }

      // Seed "opening" odds (slightly different, captured earlier)
      const openDb = db.getDb();
      openDb.prepare(`
        INSERT INTO odds_snapshots (sport_key, event_id, commence_time, home_team, away_team, bookmaker_key, bookmaker, market_key, outcome_name, outcome_price, outcome_point, captured_at)
        SELECT sport_key, event_id, commence_time, home_team, away_team, bookmaker_key, bookmaker, market_key, outcome_name,
          outcome_price * (0.95 + RANDOM() % 10 * 0.01), outcome_point,
          datetime('now', '-2 hours')
        FROM odds_snapshots WHERE event_id = ? AND captured_at = (SELECT MAX(captured_at) FROM odds_snapshots WHERE event_id = ?)
      `).run(ev.id, ev.id);
    }
  }

  // Seed AFL Squiggle predictions
  const aflEvents = sports[0].events;
  for (const ev of aflEvents) {
    const homeProb = 0.35 + Math.random() * 0.3;
    db.insertPrediction({
      game_id: Math.floor(Math.random() * 90000) + 10000,
      round: 1, year: now.getFullYear(),
      home_team: ev.home, away_team: ev.away,
      home_score: round2(70 + Math.random() * 40),
      away_score: round2(70 + Math.random() * 40),
      home_prob: round2(homeProb),
      margin: round2((homeProb - 0.5) * 60),
      source: 'squiggle_mock',
    });
  }

  // Seed rankings
  const teams = ['Melbourne Demons', 'Collingwood Magpies', 'Brisbane Lions', 'Carlton Blues',
    'Geelong Cats', 'Sydney Swans', 'Western Bulldogs', 'Richmond Tigers'];
  teams.forEach((team, i) => {
    db.insertRanking({ team, rank: i + 1, rating: round2(70 - i * 4 + Math.random() * 5), year: now.getFullYear(), round: 0 });
  });

  return { seeded: true, snapshots: snapCount, events: sports.reduce((a, s) => a + s.events.length, 0) };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

async function ingestAll() {
  const config = db.getAllConfig();
  const sports = (config.sports || '').split(',').filter(Boolean);
  const results = { sports: {}, squiggle: null, mock: false };

  if (!ODDS_API_KEY) {
    // Mock mode
    const mock = seedMockData();
    results.mock = true;
    results.mockResult = mock;
    return results;
  }

  // Live mode: fetch from TheOddsAPI
  for (const sport of sports) {
    try {
      results.sports[sport] = await fetchOddsAPI(sport);
    } catch (e) {
      results.sports[sport] = { error: e.message };
    }
  }

  // Fetch Squiggle for AFL
  if (sports.includes('aussierules_afl')) {
    try {
      const year = new Date().getFullYear();
      results.squiggle = await fetchSquiggleGames(year);
      results.squiggleRankings = await fetchSquiggleRankings();
    } catch (e) {
      results.squiggle = { error: e.message };
    }
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { fetchOddsAPI, fetchSquiggleGames, fetchSquiggleRankings, seedMockData, ingestAll };
