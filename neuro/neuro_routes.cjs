/**
 * neuro_routes.cjs — Express route layer for NEURO-KURO MSF API
 * KURO OS v9
 *
 * Mounts at /api/neuro (caller's responsibility).
 * All responses include a standard advisory disclaimer.
 * Entrainment inputs are persisted append-only to the state log.
 *
 * Routes:
 *   POST /api/neuro/state           — PRESENT mode (current MSF snapshot)
 *   POST /api/neuro/project         — PROJECT mode (forward trajectory)
 *   POST /api/neuro/simulate        — SIMULATE mode (counterfactual scenario)
 *   POST /api/neuro/update          — Feed new entrainment inputs to circadian model
 *   POST /api/neuro/phase/simulate  — Stateless phase computation from sleep timing
 *   GET  /api/neuro/compounds       — Compound timing windows (static reference data)
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

  // ── GET /api/neuro/compounds ──────────────────────────────────────────────
  // Returns static circadian-aligned compound timing reference data.
  // No auth required — public reference data.
  router.get('/compounds', (req, res) => {
    const compounds = [
      {
        id:          'melatonin',
        name:        'Melatonin',
        ctStart:     12,
        ctEnd:       14,
        ctWindow:    'CT12–CT14',
        mechanism:   'DLMO onset alignment — suppresses cortisol, initiates sleep cascade',
        evidence:    'literature',
        references:  ['Benloucif et al. 2005', 'Lewy et al. 2006'],
        notes:       'Take 0.5–1 mg exogenous melatonin 30–60 min before DLMO. DLMO ≈ CT14.',
      },
      {
        id:          'caffeine',
        name:        'Caffeine',
        ctStart:     6,
        ctEnd:       10,
        ctWindow:    'CT6–CT10',
        mechanism:   'Adenosine antagonism — most effective after cortisol peak begins to decline',
        evidence:    'literature',
        references:  ['Folkard & Monk 1985', 'Carrier & Monk 2000'],
        notes:       'Avoid before CT6 — cortisol interaction reduces effectiveness and disrupts natural cortisol rhythm.',
      },
      {
        id:          'magnesium',
        name:        'Magnesium',
        ctStart:     20,
        ctEnd:       22,
        ctWindow:    'CT20–CT22',
        mechanism:   'GABA-A agonism, NMDA antagonism — supports sleep onset and slow-wave depth',
        evidence:    'literature',
        references:  ['Hornyak et al. 1998', 'Nielsen et al. 2010'],
        notes:       'Magnesium glycinate or threonate; CT20–22 aligns with pre-sleep GABA window.',
      },
      {
        id:          'nmn',
        name:        'NMN',
        ctStart:     6,
        ctEnd:       8,
        ctWindow:    'CT6–CT8',
        mechanism:   'NAD+ precursor — NAMPT expression peaks in early subjective day; sirtuin activation',
        evidence:    'experimental',
        references:  ['Yoshino et al. 2021', 'Sato et al. 2017'],
        notes:       'Circadian NAMPT rhythm peaks CT6–CT8; morning dosing maximises NAD+ synthesis window.',
      },
    ];
    res.json({ compounds, count: compounds.length, advisory: ADVISORY });
  });

  // ── POST /api/neuro/phase/simulate ────────────────────────────────────────
  // Stateless circadian phase computation from sleep timing.
  // No auth required — demo mode, no state mutation.
  // Body: { sleepOnset: "HH:MM", wakeTime: "HH:MM", timezone: "Area/City" }
  //
  // Algorithm:
  //   1. Anchor CT21 (7π/4) to sleepOnset — matching SANDD/MMASH validation protocol.
  //   2. Propagate via free-running ω = 2π/τ, τ = 24.2 h.
  //   3. Apply gain-weighted sleep correction at wakeTime (K_sleep = 0.9).
  //   4. Propagate from wakeTime to now.
  //   5. Decay confidence exponentially (λ = 0.08 h⁻¹) from wake.
  router.post('/phase/simulate', (req, res) => {
    try {
      const { sleepOnset, wakeTime, timezone = 'UTC' } = req.body;

      if (!sleepOnset || !wakeTime) {
        return res.status(400).json({
          error:    'sleepOnset and wakeTime are required (HH:MM format)',
          advisory: ADVISORY,
        });
      }

      // ── Parameters ──
      const TAU    = 24.2;                       // intrinsic period (h)
      const OMEGA  = (2 * Math.PI) / TAU;        // angular velocity (rad/h)
      const LAMBDA = 0.08;                        // confidence decay rate (h⁻¹)
      const K_SLEEP = 0.9;                        // sleep correction gain
      const PHI_ANCHOR = (7 * Math.PI) / 4;      // CT21 anchor phase (rad)

      // ── Helpers ──
      const wrap = phi => ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const arc  = x   => { let r = x % (2 * Math.PI); if (r > Math.PI) r -= 2*Math.PI; if (r < -Math.PI) r += 2*Math.PI; return r; };
      const parseHHMM = str => { const [h, m] = str.split(':').map(Number); return h + m / 60; };
      const fmtHour   = h  => { let n = ((h % 24) + 24) % 24; let hrs = Math.floor(n); let mins = Math.round((n % 1) * 60); if (mins >= 60) { hrs = (hrs + 1) % 24; mins = 0; } return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}`; };

      // ── Parse inputs ──
      const sleepH = parseHHMM(sleepOnset);
      const wakeH  = parseHHMM(wakeTime);
      let sleepDur = wakeH - sleepH;
      if (sleepDur <= 0) sleepDur += 24;

      // ── Current clock hour in user timezone ──
      const nowDate = new Date();
      let nowHour;
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour12:   false,
          hour:     '2-digit',
          minute:   '2-digit',
        }).formatToParts(nowDate);
        const hPart = parts.find(p => p.type === 'hour');
        const mPart = parts.find(p => p.type === 'minute');
        nowHour = parseInt(hPart.value, 10) + parseInt(mPart.value, 10) / 60;
      } catch (_) {
        nowHour = nowDate.getUTCHours() + nowDate.getUTCMinutes() / 60;
      }

      // Hours awake (from wake time to now)
      let hoursAwake = nowHour - wakeH;
      if (hoursAwake < 0) hoursAwake += 24;
      // Cap at 20h — beyond that the input is likely from yesterday's sleep
      if (hoursAwake > 20) hoursAwake = hoursAwake - 24 < 0 ? 0 : hoursAwake - 24;

      // ── Phase computation ──
      // Step 1: at sleepOnset, phi = CT21
      const phi0   = PHI_ANCHOR;
      const conf0  = 0.85;

      // Step 2: propagate to wake
      const phi_wake_prior = wrap(phi0 + OMEGA * sleepDur);

      // Step 3: sleep correction (sleepPhaseObservation from circadian_model.js)
      const durationDeviation = (sleepDur - 7.0) / 7.0;
      const phi_obs           = wrap(PHI_ANCHOR + durationDeviation * (Math.PI / 8));
      const innovation        = arc(phi_obs - phi_wake_prior);
      const phi_wake          = wrap(phi_wake_prior + K_SLEEP * innovation);
      const conf_wake         = Math.min(1.0, conf0 + K_SLEEP * (1 - conf0));

      // Step 4: propagate to now
      const phi_now  = wrap(phi_wake + OMEGA * hoursAwake);
      const conf_now = conf_wake * Math.exp(-LAMBDA * hoursAwake);

      // ── Derived outputs ──
      const ctValue  = (phi_now / (2 * Math.PI)) * 24;                  // CT 0–24
      const ctRounded = Math.round(ctValue * 100) / 100;
      const ctAtWake  = (phi_wake / (2 * Math.PI)) * 24;

      // Phase label (equal quadrants matching circadian_model.js)
      const phaseLabel = ctValue < 6 ? 'ACTIVATION'
                       : ctValue < 12 ? 'BALANCE'
                       : ctValue < 18 ? 'BRAKE'
                       : 'RESET';

      // Fine-grained phase description
      const ctDesc = (() => {
        const ct = ctValue;
        if (ct < 2)  return 'CT0–2 — Sleep consolidation, growth hormone peak';
        if (ct < 4)  return 'CT2–4 — Core body temperature minimum';
        if (ct < 6)  return 'CT4–6 — Pre-wake cortisol surge begins';
        if (ct < 8)  return 'CT6–8 — Cortisol peak window';
        if (ct < 10) return 'CT8–10 — Testosterone peak, rising alertness';
        if (ct < 12) return 'CT10–12 — Peak cognitive performance';
        if (ct < 14) return 'CT12–14 — Sustained performance window';
        if (ct < 16) return 'CT14–16 — DLMO onset, alertness declining';
        if (ct < 18) return 'CT16–18 — Melatonin ramp-up';
        if (ct < 20) return 'CT18–20 — Sleep pressure building';
        if (ct < 22) return 'CT20–22 — Pre-sleep wind-down';
        return         'CT22–24 — Sleep onset window';
      })();

      // Predicted transitions
      const PHASE_STARTS = [0, 6, 12, 18, 24]; // CT boundaries
      const PHASE_NAMES  = ['ACTIVATION', 'BALANCE', 'BRAKE', 'RESET'];
      const transitions  = PHASE_STARTS
        .filter(boundary => boundary > ctValue)
        .slice(0, 3)
        .map(boundary => {
          const deltaCT    = boundary - ctValue;
          const deltaHours = deltaCT * (TAU / 24);
          const tMs        = nowDate.getTime() + deltaHours * 3600000;
          return {
            ctBoundary: boundary,
            phaseLabel: PHASE_NAMES[Math.floor(boundary / 6) % 4] || 'ACTIVATION',
            clockTime:  fmtHour(nowHour + deltaHours),
            timestamp:  tMs,
          };
        });

      // ── Alertness curve (25 points, 00:00–24:00) ──
      const curve = [];
      for (let h = 0; h <= 24; h++) {
        // Phase at clock hour h on today's axis
        let hoursFromSleep = h - sleepH;
        if (hoursFromSleep < 0) hoursFromSleep += 24;

        let phi_h, isSleeping;
        if (hoursFromSleep < sleepDur) {
          // Within sleep window — clamp near CT21 anchor (sleep = stable phase)
          phi_h     = wrap(PHI_ANCHOR + OMEGA * hoursFromSleep * 0.15);
          isSleeping = true;
        } else {
          // After wake — propagate from corrected wake phase
          const hoursFromWake = hoursFromSleep - sleepDur;
          phi_h     = wrap(phi_wake + OMEGA * hoursFromWake);
          isSleeping = false;
        }

        const ct_h = (phi_h / (2 * Math.PI)) * 24;
        // Two-oscillator alertness approximation (simplified Borbély–Achermann)
        // During sleep: clamped negative; after wake: sinusoidal ascending then declining
        let alertness;
        if (isSleeping) {
          // Gradual arousal build during late sleep
          const sleepFrac = hoursFromSleep / sleepDur;
          alertness = -0.8 + 0.4 * sleepFrac;           // −0.8 → −0.4
        } else {
          const primary   = 0.6  * Math.sin((ct_h - 3)  * Math.PI / 12);
          const secondary = 0.25 * Math.sin((ct_h - 1.5) * Math.PI / 6);
          alertness = primary + secondary;
        }
        alertness = Math.max(-1, Math.min(1, alertness));

        curve.push({
          hour:       h,
          clockLabel: `${String(h).padStart(2,'0')}:00`,
          ct:         Math.round(ct_h * 100) / 100,
          alertness:  Math.round(alertness * 1000) / 1000,
          phase:      ct_h < 6 ? 'ACTIVATION' : ct_h < 12 ? 'BALANCE' : ct_h < 18 ? 'BRAKE' : 'RESET',
        });
      }

      // ── Compound timing ──
      const COMPOUND_DEFS = [
        { id: 'melatonin', name: 'Melatonin', ctStart: 12, ctEnd: 14, evidence: 'literature'   },
        { id: 'caffeine',  name: 'Caffeine',  ctStart: 6,  ctEnd: 10, evidence: 'literature'   },
        { id: 'magnesium', name: 'Magnesium', ctStart: 20, ctEnd: 22, evidence: 'literature'   },
        { id: 'nmn',       name: 'NMN',       ctStart: 6,  ctEnd: 8,  evidence: 'experimental' },
      ];

      // Map CT to local clock hour anchored at sleepOnset = CT21.
      // CT20 → ~1h before sleep onset; CT6 → ~morning wake window.
      const ctToLocalH = ct => {
        const delta = ct - 21;   // offset from CT21 anchor
        const localH = sleepH + delta * (TAU / 24);
        return ((localH % 24) + 24) % 24;
      };

      const compounds = COMPOUND_DEFS.map(c => ({
        ...c,
        ctWindow:    `CT${c.ctStart}–CT${c.ctEnd}`,
        localWindow: `${fmtHour(ctToLocalH(c.ctStart))} – ${fmtHour(ctToLocalH(c.ctEnd))}`,
        active:      ctValue >= c.ctStart && ctValue <= c.ctEnd,
      }));

      // ── Response ──
      const result = {
        ct:               ctRounded,
        phaseLabel,
        phaseDescription: ctDesc,
        localTime:        fmtHour(nowHour),
        confidence:       Math.round(conf_now * 1000) / 1000,
        consistencyScore: Math.round(Math.min(1, conf_now * 1.15) * 100) / 100,
        dataDensity:      'manual',
        variance:         Math.round((0.31 * (1 - conf_now / conf_wake + 0.05)) * 100) / 100,
        sleepDuration:    Math.round(sleepDur * 10) / 10,
        hoursAwake:       Math.round(hoursAwake * 10) / 10,
        transitions,
        curve,
        compounds,
        advisory:         ADVISORY,
      };

      appendLog({ event: 'phase_simulate', sleepOnset, wakeTime, timezone, ct: ctRounded, confidence: result.confidence, requestedAt: Date.now() });

      res.json(result);
    } catch (err) {
      console.error('[NEURO /phase/simulate]', err.message, err.stack);
      res.status(500).json({ error: err.message, advisory: ADVISORY });
    }
  });

  app.use('/api/neuro', router);
  console.log('[NEURO] Routes mounted at /api/neuro/*');
}

module.exports = mountNeuroRoutes;
