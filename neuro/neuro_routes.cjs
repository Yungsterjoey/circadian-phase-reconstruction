/**
 * neuro_routes.cjs — Express route layer for NEURO-KURO MSF API
 * KURO OS v9
 *
 * Mounts at /api/neuro (caller's responsibility).
 * All responses include a standard advisory disclaimer.
 * Entrainment inputs are persisted append-only to the state log.
 *
 * Routes:
 *   POST /api/neuro/state    — PRESENT mode (current MSF snapshot)
 *   POST /api/neuro/project  — PROJECT mode (forward trajectory)
 *   POST /api/neuro/simulate — SIMULATE mode (counterfactual scenario)
 *   POST /api/neuro/update   — Feed new entrainment inputs to circadian model
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const { computeMSF, updateCircadian } = require('./msf.js');

// ─── Log file ────────────────────────────────────────────────────────────────

const LOG_DIR  = '/opt/kuro/data/neuro';
const LOG_FILE = path.join(LOG_DIR, 'state_log.jsonl');

/**
 * Append a JSON record to the state log (append-only, one object per line).
 * Creates the log directory if it does not exist.
 * @param {object} record
 */
function appendLog(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // Log failure is non-fatal — route still responds.
    console.error('[NEURO] Log write failed:', err.message);
  }
}

// ─── Advisory constant ───────────────────────────────────────────────────────

const ADVISORY = 'Decision support only. Not medical advice.';

// ─── Response helper ─────────────────────────────────────────────────────────

/**
 * Wrap a result into the standard NEURO API envelope.
 * @param {object} result      — MSF or update result payload
 * @param {number} confidence  — aggregate confidence [0,1]
 * @param {string} mode        — computation mode string
 * @returns {object}
 */
function envelope(result, confidence, mode) {
  return {
    result,
    confidence,
    mode,
    timestamp: Date.now(),
    advisory:  ADVISORY,
  };
}

// ─── Router factory ───────────────────────────────────────────────────────────

/**
 * Mount NEURO routes onto an Express app.
 * Call from server.cjs: mountNeuroRoutes(app)
 * @param {import('express').Application} app
 */
function mountNeuroRoutes(app) {
  const router = express.Router();

  // ── POST /api/neuro/state ─────────────────────────────────────────────────
  // Returns the current MSF snapshot (PRESENT mode).
  // Body: {} (no required fields; optional: { timestamp })
  router.post('/state', (req, res) => {
    try {
      const ts  = req.body.timestamp ? Number(req.body.timestamp) : Date.now();
      const msf = computeMSF(ts, 'PRESENT');

      appendLog({ event: 'state_query', timestamp: ts, requestedAt: Date.now() });

      res.json(envelope(msf, msf.aggregateConfidence, 'PRESENT'));
    } catch (err) {
      console.error('[NEURO /state]', err.message);
      res.status(500).json({ error: err.message, advisory: ADVISORY });
    }
  });

  // ── POST /api/neuro/project ───────────────────────────────────────────────
  // Returns a forward phase trajectory.
  // Body: { hoursAhead: number (default 24), timestamp?: number }
  router.post('/project', (req, res) => {
    try {
      const ts         = req.body.timestamp ? Number(req.body.timestamp) : Date.now();
      const hoursAhead = req.body.hoursAhead != null ? Number(req.body.hoursAhead) : 24;

      if (!Number.isFinite(hoursAhead) || hoursAhead < 0 || hoursAhead > 720) {
        return res.status(400).json({ error: 'hoursAhead must be 0–720', advisory: ADVISORY });
      }

      const msf = computeMSF(ts, 'PROJECT', { hoursAhead });

      appendLog({ event: 'project_query', timestamp: ts, hoursAhead, requestedAt: Date.now() });

      res.json(envelope(msf, msf.aggregateConfidence, 'PROJECT'));
    } catch (err) {
      console.error('[NEURO /project]', err.message);
      res.status(500).json({ error: err.message, advisory: ADVISORY });
    }
  });

  // ── POST /api/neuro/simulate ──────────────────────────────────────────────
  // Runs a counterfactual shift simulation.
  // Body: { params: { shiftHours, daysToAdapt }, timestamp?: number }
  router.post('/simulate', (req, res) => {
    try {
      const ts     = req.body.timestamp ? Number(req.body.timestamp) : Date.now();
      const params = req.body.params || {};

      if (params.shiftHours != null && !Number.isFinite(Number(params.shiftHours))) {
        return res.status(400).json({ error: 'params.shiftHours must be a number', advisory: ADVISORY });
      }

      const msf = computeMSF(ts, 'SIMULATE', { params });

      appendLog({ event: 'simulate_query', timestamp: ts, params, requestedAt: Date.now() });

      res.json(envelope(msf, msf.aggregateConfidence, 'SIMULATE'));
    } catch (err) {
      console.error('[NEURO /simulate]', err.message);
      res.status(500).json({ error: err.message, advisory: ADVISORY });
    }
  });

  // ── POST /api/neuro/update ────────────────────────────────────────────────
  // Feed new entrainment inputs; updates circadian model state.
  // Body: {
  //   sleepOnset?:        number  — ms since epoch
  //   sleepOffset?:       number  — ms since epoch
  //   lightLux?:          number  — lux
  //   caffeineTimestamp?: number  — ms since epoch
  //   timestamp?:         number  — override for 'now'
  // }
  router.post('/update', (req, res) => {
    try {
      const {
        sleepOnset,
        sleepOffset,
        lightLux,
        caffeineTimestamp,
        timestamp,
      } = req.body;

      const inputs = {
        ...(sleepOnset        != null && { sleepOnset:        Number(sleepOnset)        }),
        ...(sleepOffset       != null && { sleepOffset:       Number(sleepOffset)       }),
        ...(lightLux          != null && { lightLux:          Number(lightLux)          }),
        ...(caffeineTimestamp != null && { caffeineTimestamp: Number(caffeineTimestamp) }),
        ...(timestamp         != null && { timestamp:         Number(timestamp)         }),
      };

      if (Object.keys(inputs).filter(k => k !== 'timestamp').length === 0) {
        return res.status(400).json({
          error:    'At least one entrainment input is required (sleepOnset/sleepOffset, lightLux, caffeineTimestamp)',
          advisory: ADVISORY,
        });
      }

      const updateResult = updateCircadian(inputs);

      appendLog({
        event:      'entrainment_update',
        inputs,
        result:     updateResult,
        recordedAt: Date.now(),
      });

      res.json(envelope(updateResult, updateResult.confidence, 'UPDATE'));
    } catch (err) {
      console.error('[NEURO /update]', err.message);
      res.status(500).json({ error: err.message, advisory: ADVISORY });
    }
  });

  app.use('/api/neuro', router);
  console.log('[NEURO] Routes mounted at /api/neuro/*');
}

module.exports = mountNeuroRoutes;
