// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Trajectory Logger (Training Data Source)
// ═══════════════════════════════════════════════════════════════════════════
//
// Appends one JSON line per step to $KURO_DATA/trajectories/YYYY-MM-DD.jsonl.
// These files feed training/sanitize.py directly.
//
// Each line is self-describing and includes everything the sanitizer needs:
//   - controller raw output (for token-level weighting in training)
//   - parsed blocks (state, reasoning, plan, delta_pred, next_state, confidence)
//   - tool results
//   - V_t, V_{t+1}, per-metric raw values (so the sanitizer can recompute
//     normalisation against its own rolling stats)
//   - delta_actual, calibration_error
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const TRAJ_DIR = path.join(DATA_DIR, 'trajectories');

function ensureDir() {
  if (!fs.existsSync(TRAJ_DIR)) fs.mkdirSync(TRAJ_DIR, { recursive: true });
}

function todayPath() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return path.join(TRAJ_DIR, `${ymd}.jsonl`);
}

class TrajectoryLogger {
  constructor({ sessionId, userId = null, goal = '' } = {}) {
    ensureDir();
    this.sessionId = sessionId || crypto.randomBytes(8).toString('hex');
    this.userId = userId;
    this.goal = goal;
    this.startedAt = Date.now();
    this.stepIdx = 0;
    this._open();
  }

  _open() {
    this.fp = todayPath();
    // Append-only — one file per UTC day shared across sessions
  }

  logStep(step) {
    const record = {
      type: 'step',
      session: this.sessionId,
      user: this.userId,
      goal: this.goal,
      t: this.stepIdx,
      at: new Date().toISOString(),
      ...step
    };
    try {
      fs.appendFileSync(this.fp, JSON.stringify(record) + '\n');
    } catch (e) {
      // Fail quiet — never break inference for a logger issue
      if (process.env.KURO_ENGINE_DEBUG) {
        console.warn('[trajectory_log] append failed:', e.message);
      }
    }
    this.stepIdx += 1;
  }

  logFinal({ terminal_reason, bestV, bestX, totalSteps }) {
    const record = {
      type: 'final',
      session: this.sessionId,
      user: this.userId,
      goal: this.goal,
      at: new Date().toISOString(),
      terminal_reason,
      bestV,
      bestX,
      totalSteps,
      wallMs: Date.now() - this.startedAt
    };
    try { fs.appendFileSync(this.fp, JSON.stringify(record) + '\n'); }
    catch { /* swallow */ }
  }

  snapshot() {
    return {
      sessionId: this.sessionId, goal: this.goal, stepIdx: this.stepIdx,
      path: this.fp, startedAt: this.startedAt
    };
  }
}

module.exports = { TrajectoryLogger, TRAJ_DIR };
