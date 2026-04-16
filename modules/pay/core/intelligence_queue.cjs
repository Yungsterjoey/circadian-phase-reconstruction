'use strict';
const { randomUUID } = require('crypto');
const ledger = require('./ledger.cjs');

const MAX_ATTEMPTS = 3;

function enqueue(taskType, payload) {
  const id = randomUUID();
  ledger._db().prepare(
    `INSERT INTO intelligence_queue (id, task_type, payload_json) VALUES (?, ?, ?)`
  ).run(id, taskType, JSON.stringify(payload));
  return id;
}

function claimNext() {
  const db = ledger._db();
  const row = db.prepare(
    `SELECT * FROM intelligence_queue WHERE status='pending' ORDER BY created_at LIMIT 1`
  ).get();
  if (!row) return null;
  db.prepare(
    `UPDATE intelligence_queue SET status='processing', attempts=attempts+1, started_at=datetime('now') WHERE id=?`
  ).run(row.id);
  return {
    ...row,
    status: 'processing',
    attempts: row.attempts + 1,
    payload: JSON.parse(row.payload_json),
  };
}

function complete(id) {
  ledger._db().prepare(
    `UPDATE intelligence_queue SET status='done', processed_at=datetime('now'), error=NULL WHERE id=?`
  ).run(id);
}

function fail(id, err) {
  const db = ledger._db();
  const row = db.prepare(`SELECT attempts FROM intelligence_queue WHERE id=?`).get(id);
  const finalStatus = row && row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  db.prepare(
    `UPDATE intelligence_queue SET status=?, processed_at=datetime('now'), error=? WHERE id=?`
  ).run(finalStatus, String(err).slice(0, 500), id);
}

function depth() {
  return ledger._db().prepare(
    `SELECT COUNT(*) AS c FROM intelligence_queue WHERE status IN ('pending','processing')`
  ).get().c;
}

module.exports = { enqueue, claimNext, complete, fail, depth, MAX_ATTEMPTS };
