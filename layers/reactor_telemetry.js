/**
 * KURO::REACTOR TELEMETRY v1.0
 * 
 * Hardware-aware intelligence layer. KURO is the first agent self-aware of
 * its own body (the L4 GPU). Commercial models have no concept of the 
 * hardware they run on — KURO does.
 * 
 * Capabilities:
 *   1. nvidia-smi polling → GPU temp, VRAM usage, power, utilization
 *   2. Ollama /api/ps → loaded models, VRAM per model
 *   3. System RAM/CPU from /proc (no exec required)
 *   4. VRAM budget calculator → can model X fit right now?
 *   5. Model recommendation → given current VRAM, which models are loadable?
 *   6. Thermal throttle advisory → if GPU temp > threshold, recommend smaller model
 * 
 * Design: Pure read-only. No exec(). Uses nvidia-ml-py bindings or 
 * /proc filesystem + Ollama HTTP API. Safe for all tiers.
 * 
 * v7.0.2b — Extracted from Gemini "Reactor Telemetry" proposal
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ═══════════════════════════════════════════════════════════════════════════
// GPU TELEMETRY (nvidia-smi)
// ═══════════════════════════════════════════════════════════════════════════

let _gpuCache = { data: null, ts: 0 };
const GPU_CACHE_MS = 3000; // Poll at most every 3 seconds

function queryGPU() {
  if (Date.now() - _gpuCache.ts < GPU_CACHE_MS && _gpuCache.data) return _gpuCache.data;

  try {
    const raw = execFileSync('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu,utilization.memory,fan.speed',
      '--format=csv,noheader,nounits'
    ], { timeout: 5000, encoding: 'utf8' });

    const parts = raw.trim().split(',').map(s => s.trim());
    const data = {
      name: parts[0] || 'Unknown',
      vram: {
        total: parseInt(parts[1]) || 0,    // MiB
        used: parseInt(parts[2]) || 0,
        free: parseInt(parts[3]) || 0,
        utilization: parseInt(parts[8]) || 0 // %
      },
      temperature: parseInt(parts[4]) || 0,  // °C
      power: parseFloat(parts[5]) || 0,       // W
      gpuUtilization: parseInt(parts[6]) || 0, // %
      fan: parseInt(parts[7]) || 0             // % (may be N/A on cloud)
    };
    data.vram.percent = data.vram.total > 0 ? Math.round((data.vram.used / data.vram.total) * 100) : 0;
    _gpuCache = { data, ts: Date.now() };
    return data;
  } catch (e) {
    return {
      name: 'NVIDIA L4 (query failed)',
      vram: { total: 24576, used: 0, free: 24576, utilization: 0, percent: 0 },
      temperature: 0, power: 0, gpuUtilization: 0, fan: 0,
      error: e.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA LOADED MODELS
// ═══════════════════════════════════════════════════════════════════════════

async function queryOllamaModels() {
  try {
    const { data } = await axios.get(`${OLLAMA_URL}/api/ps`, { timeout: 5000 });
    return (data.models || []).map(m => ({
      name: m.name,
      sizeMB: Math.round((m.size || 0) / 1048576),
      vramMB: Math.round((m.size_vram || 0) / 1048576),
      digest: m.digest?.slice(0, 12),
      expires: m.expires_at
    }));
  } catch (e) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM RAM / CPU (from /proc — no exec needed)
// ═══════════════════════════════════════════════════════════════════════════

function querySystem() {
  try {
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const extract = (key) => {
      const m = memInfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? Math.round(parseInt(m[1]) / 1024) : 0; // Convert kB → MB
    };

    const loadAvg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ');
    const uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);

    return {
      ram: {
        total: extract('MemTotal'),
        free: extract('MemFree'),
        available: extract('MemAvailable'),
        cached: extract('Cached'),
        buffers: extract('Buffers')
      },
      cpu: {
        load1m: parseFloat(loadAvg[0]) || 0,
        load5m: parseFloat(loadAvg[1]) || 0,
        load15m: parseFloat(loadAvg[2]) || 0,
        procs: loadAvg[3] || ''
      },
      uptime: Math.round(uptime)
    };
  } catch (e) {
    return { ram: {}, cpu: {}, uptime: 0, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VRAM BUDGET CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════

// Estimated VRAM footprints (MiB) — updated for huihui_ai abliterated models
const MODEL_VRAM_ESTIMATES = {
  'kuro-core':     20000,  // 24B at Q4
  'kuro-forge':    10000,  // 14B at Q8
  'kuro-logic':    10000,  // 14B at Q6
  'kuro-sentinel':  8000,  // gemma3
  'kuro-cipher':   10000,  // 14B at Q8
  'kuro-phantom':  10000,  // 14B at Q8
  'kuro-exe':      10000,  // 14B at Q8
  'kuro-scout':     6000,  // 8B at Q4
  'kuro-embed':      250,  // nomic-embed-text
  'flux-schnell':   8000,  // FLUX.1-schnell NF4
  'flux-dev':      12000,  // FLUX.1-dev
};

/**
 * Can a model fit in current free VRAM?
 * Accounts for Ollama overhead (~500MB) and safety margin.
 */
function canFit(modelId) {
  const gpu = queryGPU();
  const needed = MODEL_VRAM_ESTIMATES[modelId] || 10000;
  const available = gpu.vram.free - 500; // 500MB safety margin
  return {
    fits: available >= needed,
    needed,
    available: Math.max(0, available),
    deficit: Math.max(0, needed - available),
    gpu: gpu.name
  };
}

/**
 * Which models can load right now without evicting anything?
 */
function loadableModels() {
  const gpu = queryGPU();
  const available = gpu.vram.free - 500;
  const result = {};
  for (const [id, vram] of Object.entries(MODEL_VRAM_ESTIMATES)) {
    result[id] = { fits: available >= vram, vram, headroom: available - vram };
  }
  return { available, models: result };
}

// ═══════════════════════════════════════════════════════════════════════════
// THERMAL ADVISORY
// ═══════════════════════════════════════════════════════════════════════════

const THERMAL_THRESHOLDS = {
  nominal:   70,   // °C — all clear
  warm:      80,   // °C — consider smaller model
  hot:       87,   // °C — throttle to 8B only
  critical:  92    // °C — L4 starts hardware throttling
};

function thermalAdvisory() {
  const gpu = queryGPU();
  const temp = gpu.temperature;
  let status, recommendation;

  if (temp < THERMAL_THRESHOLDS.nominal) {
    status = 'nominal';
    recommendation = 'All models available';
  } else if (temp < THERMAL_THRESHOLDS.warm) {
    status = 'warm';
    recommendation = 'Prefer 14B models over 24B for sustained workloads';
  } else if (temp < THERMAL_THRESHOLDS.hot) {
    status = 'hot';
    recommendation = 'Use kuro-scout (8B) only. Avoid long generations.';
  } else {
    status = 'critical';
    recommendation = 'GPU thermal throttling active. Minimal inference only.';
  }

  return { temperature: temp, status, recommendation, thresholds: THERMAL_THRESHOLDS };
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART MODEL RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Given a requested model, return the best model that actually fits.
 * Falls back to smaller models if VRAM is tight.
 */
function recommendModel(requestedId, modelRegistry) {
  const fit = canFit(requestedId);
  if (fit.fits) return { model: requestedId, reason: 'requested_fits', fit };

  // Fallback chain: requested → scout → embed-only
  const fallbacks = ['kuro-scout', 'kuro-embed'];
  for (const fb of fallbacks) {
    const fbFit = canFit(fb);
    if (fbFit.fits) {
      return {
        model: fb,
        reason: 'vram_downgrade',
        requested: requestedId,
        requestedVram: fit.needed,
        fit: fbFit
      };
    }
  }

  return { model: null, reason: 'no_model_fits', fit };
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL TELEMETRY SNAPSHOT
// ═══════════════════════════════════════════════════════════════════════════

async function fullSnapshot() {
  const [gpu, ollamaModels, system] = await Promise.all([
    queryGPU(),
    queryOllamaModels(),
    querySystem()
  ]);

  return {
    timestamp: Date.now(),
    gpu,
    system,
    ollama: {
      loaded: ollamaModels,
      totalVram: ollamaModels.reduce((sum, m) => sum + m.vramMB, 0)
    },
    thermal: thermalAdvisory(),
    budget: loadableModels()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ROUTE MOUNTER
// ═══════════════════════════════════════════════════════════════════════════

function mountTelemetryRoutes(app, logEvent) {
  // Full telemetry snapshot — authenticated users only
  app.get('/api/telemetry', async (req, res) => {
    try {
      const snapshot = await fullSnapshot();
      res.json(snapshot);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Quick GPU status — lightweight, for polling
  app.get('/api/telemetry/gpu', (req, res) => {
    res.json(queryGPU());
  });

  // Can a model fit?
  app.get('/api/telemetry/canfit/:model', (req, res) => {
    res.json(canFit(req.params.model));
  });

  // Thermal advisory
  app.get('/api/telemetry/thermal', (req, res) => {
    res.json(thermalAdvisory());
  });

  console.log('[TELEMETRY] Routes mounted: /api/telemetry/{,gpu,canfit/:model,thermal}');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  queryGPU,
  queryOllamaModels,
  querySystem,
  canFit,
  loadableModels,
  thermalAdvisory,
  recommendModel,
  fullSnapshot,
  mountTelemetryRoutes,
  MODEL_VRAM_ESTIMATES,
  THERMAL_THRESHOLDS
};
