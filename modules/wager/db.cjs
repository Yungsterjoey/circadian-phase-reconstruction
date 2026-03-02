/**
 * KURO::WAGER — Database Layer
 * SQLite schema + prepared statements for the betting intelligence engine.
 * Uses better-sqlite3 (already in project deps).
 */
'use strict';

const path = require('path');
const DATA_DIR = process.env.KURO_DATA_DIR || '/opt/kuro/data';
const DB_PATH = path.join(DATA_DIR, 'wager.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  const Database = require('better-sqlite3');
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    -- Key/value config
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Seed defaults (no-op if already exist)
    INSERT OR IGNORE INTO config VALUES ('budget_fortnightly', '30');
    INSERT OR IGNORE INTO config VALUES ('max_selections', '3');
    INSERT OR IGNORE INTO config VALUES ('kelly_fraction', '0.25');
    INSERT OR IGNORE INTO config VALUES ('confidence_floor', '0.03');
    INSERT OR IGNORE INTO config VALUES ('sports', 'aussierules_afl,rugbyleague_nrl,soccer_australia_aleague');
    INSERT OR IGNORE INTO config VALUES ('bankroll', '0');

    -- Raw odds snapshots from TheOddsAPI
    CREATE TABLE IF NOT EXISTS odds_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sport_key     TEXT NOT NULL,
      event_id      TEXT NOT NULL,
      commence_time TEXT NOT NULL,
      home_team     TEXT NOT NULL,
      away_team     TEXT NOT NULL,
      bookmaker_key TEXT NOT NULL,
      bookmaker     TEXT NOT NULL,
      market_key    TEXT NOT NULL,
      outcome_name  TEXT NOT NULL,
      outcome_price REAL NOT NULL,
      outcome_point REAL,
      captured_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_odds_event ON odds_snapshots(event_id);
    CREATE INDEX IF NOT EXISTS idx_odds_sport ON odds_snapshots(sport_key);
    CREATE INDEX IF NOT EXISTS idx_odds_time  ON odds_snapshots(captured_at DESC);

    -- Squiggle predictions (AFL)
    CREATE TABLE IF NOT EXISTS squiggle_predictions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id     INTEGER NOT NULL,
      round       INTEGER,
      year        INTEGER,
      home_team   TEXT NOT NULL,
      away_team   TEXT NOT NULL,
      home_score  REAL,
      away_score  REAL,
      home_prob   REAL,
      margin      REAL,
      source      TEXT DEFAULT 'squiggle',
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Squiggle power rankings
    CREATE TABLE IF NOT EXISTS squiggle_rankings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      team        TEXT NOT NULL,
      rank        INTEGER,
      rating      REAL,
      year        INTEGER,
      round       INTEGER,
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Generated slates
    CREATE TABLE IF NOT EXISTS slates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      status      TEXT NOT NULL DEFAULT 'active',
      budget_used REAL DEFAULT 0,
      budget_max  REAL NOT NULL,
      report_md   TEXT,
      settled_at  TEXT,
      total_pnl   REAL DEFAULT 0
    );

    -- Wager selections within a slate
    CREATE TABLE IF NOT EXISTS selections (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      slate_id       INTEGER NOT NULL REFERENCES slates(id),
      event_id       TEXT NOT NULL,
      sport_key      TEXT NOT NULL,
      home_team      TEXT NOT NULL,
      away_team      TEXT NOT NULL,
      commence_time  TEXT NOT NULL,
      selection_name TEXT NOT NULL,
      market_key     TEXT NOT NULL,
      best_odds      REAL NOT NULL,
      best_bookmaker TEXT NOT NULL,
      implied_prob   REAL NOT NULL,
      model_prob     REAL,
      edge           REAL NOT NULL,
      confidence     TEXT NOT NULL,
      kelly_stake    REAL NOT NULL,
      actual_stake   REAL NOT NULL,
      result         TEXT DEFAULT 'pending',
      settled_odds   REAL,
      pnl            REAL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sel_slate ON selections(slate_id);

    -- Bankroll ledger
    CREATE TABLE IF NOT EXISTS ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      amount       REAL NOT NULL,
      balance      REAL NOT NULL,
      slate_id     INTEGER,
      selection_id INTEGER,
      note         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Pipeline run log
    CREATE TABLE IF NOT EXISTS runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT,
      status          TEXT NOT NULL DEFAULT 'running',
      events_found    INTEGER DEFAULT 0,
      signals_found   INTEGER DEFAULT 0,
      selections_made INTEGER DEFAULT 0,
      slate_id        INTEGER,
      error           TEXT,
      log_md          TEXT
    );
  `);
}

// ── Prepared statements ─────────────────────────────────────────────────────

// Config
const getConfig = (key) => getDb().prepare('SELECT value FROM config WHERE key = ?').get(key)?.value;
const setConfig = (key, value) => getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
const getAllConfig = () => {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
};

// Odds
const insertOddsSnapshot = (s) => getDb().prepare(`
  INSERT INTO odds_snapshots (sport_key, event_id, commence_time, home_team, away_team, bookmaker_key, bookmaker, market_key, outcome_name, outcome_price, outcome_point)
  VALUES (@sport_key, @event_id, @commence_time, @home_team, @away_team, @bookmaker_key, @bookmaker, @market_key, @outcome_name, @outcome_price, @outcome_point)
`).run(s);

const getLatestOdds = (eventId) => getDb().prepare(`
  SELECT * FROM odds_snapshots
  WHERE event_id = ? AND captured_at = (SELECT MAX(captured_at) FROM odds_snapshots WHERE event_id = ?)
  ORDER BY bookmaker_key
`).all(eventId, eventId);

const getOpeningOdds = (eventId) => getDb().prepare(`
  SELECT * FROM odds_snapshots
  WHERE event_id = ? AND captured_at = (SELECT MIN(captured_at) FROM odds_snapshots WHERE event_id = ?)
  ORDER BY bookmaker_key
`).all(eventId, eventId);

const getUpcomingEvents = (sportKey) => {
  if (sportKey) {
    return getDb().prepare(`
      SELECT DISTINCT event_id, sport_key, home_team, away_team, commence_time
      FROM odds_snapshots WHERE sport_key = ? AND commence_time > datetime('now')
      ORDER BY commence_time
    `).all(sportKey);
  }
  return getDb().prepare(`
    SELECT DISTINCT event_id, sport_key, home_team, away_team, commence_time
    FROM odds_snapshots WHERE commence_time > datetime('now')
    ORDER BY commence_time
  `).all();
};

const getAllEvents = () => getDb().prepare(`
  SELECT DISTINCT event_id, sport_key, home_team, away_team, commence_time
  FROM odds_snapshots ORDER BY commence_time
`).all();

// Squiggle
const insertPrediction = (p) => getDb().prepare(`
  INSERT INTO squiggle_predictions (game_id, round, year, home_team, away_team, home_score, away_score, home_prob, margin, source)
  VALUES (@game_id, @round, @year, @home_team, @away_team, @home_score, @away_score, @home_prob, @margin, @source)
`).run(p);

const getPrediction = (homeTeam, awayTeam) => getDb().prepare(`
  SELECT * FROM squiggle_predictions
  WHERE home_team = ? AND away_team = ?
  ORDER BY captured_at DESC LIMIT 1
`).get(homeTeam, awayTeam);

const insertRanking = (r) => getDb().prepare(`
  INSERT INTO squiggle_rankings (team, rank, rating, year, round)
  VALUES (@team, @rank, @rating, @year, @round)
`).run(r);

const getLatestRankings = () => getDb().prepare(`
  SELECT * FROM squiggle_rankings
  WHERE captured_at = (SELECT MAX(captured_at) FROM squiggle_rankings)
  ORDER BY rank
`).all();

// Slates
const insertSlate = (budgetMax) => {
  const r = getDb().prepare('INSERT INTO slates (budget_max) VALUES (?)').run(budgetMax);
  return r.lastInsertRowid;
};

const updateSlate = (id, fields) => {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE slates SET ${sets} WHERE id = @id`).run({ ...fields, id });
};

const getSlate = (id) => {
  const slate = getDb().prepare('SELECT * FROM slates WHERE id = ?').get(id);
  if (!slate) return null;
  slate.selections = getDb().prepare('SELECT * FROM selections WHERE slate_id = ? ORDER BY confidence DESC, edge DESC').all(id);
  return slate;
};

const getActiveSlate = () => {
  const slate = getDb().prepare("SELECT * FROM slates WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
  if (!slate) return null;
  slate.selections = getDb().prepare('SELECT * FROM selections WHERE slate_id = ? ORDER BY confidence DESC, edge DESC').all(slate.id);
  return slate;
};

const listSlates = (limit = 20, offset = 0) =>
  getDb().prepare('SELECT * FROM slates ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);

// Selections
const insertSelection = (s) => {
  const r = getDb().prepare(`
    INSERT INTO selections (slate_id, event_id, sport_key, home_team, away_team, commence_time, selection_name, market_key, best_odds, best_bookmaker, implied_prob, model_prob, edge, confidence, kelly_stake, actual_stake)
    VALUES (@slate_id, @event_id, @sport_key, @home_team, @away_team, @commence_time, @selection_name, @market_key, @best_odds, @best_bookmaker, @implied_prob, @model_prob, @edge, @confidence, @kelly_stake, @actual_stake)
  `).run(s);
  return r.lastInsertRowid;
};

const updateSelectionResult = (id, result, settledOdds, pnl) =>
  getDb().prepare('UPDATE selections SET result = ?, settled_odds = ?, pnl = ? WHERE id = ?').run(result, settledOdds, pnl, id);

// Ledger
const insertLedger = (type, amount, note, slateId, selectionId) => {
  const bal = getBalance();
  const newBal = bal + amount;
  getDb().prepare(`
    INSERT INTO ledger (type, amount, balance, slate_id, selection_id, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, amount, newBal, slateId || null, selectionId || null, note || null);
  setConfig('bankroll', String(newBal));
  return newBal;
};

const getBalance = () => {
  const row = getDb().prepare('SELECT balance FROM ledger ORDER BY id DESC LIMIT 1').get();
  return row ? row.balance : 0;
};

const getLedgerHistory = (limit = 50) =>
  getDb().prepare('SELECT * FROM ledger ORDER BY id DESC LIMIT ?').all(limit);

// Runs
const insertRun = () => {
  const r = getDb().prepare("INSERT INTO runs (status) VALUES ('running')").run();
  return r.lastInsertRowid;
};

const updateRun = (id, fields) => {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  getDb().prepare(`UPDATE runs SET ${sets} WHERE id = @id`).run({ ...fields, id });
};

const getLatestRun = () =>
  getDb().prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();

const listRuns = (limit = 20) =>
  getDb().prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit);

module.exports = {
  getDb,
  getConfig, setConfig, getAllConfig,
  insertOddsSnapshot, getLatestOdds, getOpeningOdds, getUpcomingEvents, getAllEvents,
  insertPrediction, getPrediction, insertRanking, getLatestRankings,
  insertSlate, updateSlate, getSlate, getActiveSlate, listSlates,
  insertSelection, updateSelectionResult,
  insertLedger, getBalance, getLedgerHistory,
  insertRun, updateRun, getLatestRun, listRuns,
};
