/**
 * KURO::VISION — GPU Concurrency Controller
 * 
 * Architecture: Single RTX 5090 (32GB VRAM) on TensorDock
 * 
 * GPU BUDGET (32GB total):
 *   Active LLM:  ~28GB (kuro-core 24B or MOE 46B sparse)
 *   FLUX.1-dev:  ~12GB (must unload LLM first)
 *   kuro-embed:  ~0.3GB (always loadable, negligible)
 * 
 * Strategy: TIME-SHARING
 *   1. Vision request arrives → acquire lock
 *   2. Tell Ollama to unload large models (keep_alive: 0)
 *   3. FLUX sidecar generates image (has its own VRAM management)
 *   4. Release lock → LLM reloads on next chat request (~2s from RAM, ~8s from disk)
 * 
 * This means vision generation blocks chat for ~15-60 seconds.
 * 5090 is ~2x faster than L4 for FLUX inference.
 * 
 * v7.0.3: Updated for RTX 5090 32GB, 120s lock timeout (faster GPU).
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ─── State ───────────────────────────────────────────────────────────────
let _locked = false;
let _lockHolder = null;
let _lockTime = null;
const LOCK_TIMEOUT_MS = 120000; // 2 min max per vision job (5090 is faster than L4)

// ─── Ollama Model Management ─────────────────────────────────────────────

async function listLoadedModels() {
  try {
    const { data } = await axios.get(`${OLLAMA_URL}/api/ps`, { timeout: 5000 });
    return (data.models || []).map(m => ({ name: m.name, size: m.size, vram: m.size_vram }));
  } catch (e) {
    console.error('[GPU_CTRL] Failed to list models:', e.message);
    return [];
  }
}

/**
 * Evict large models to free VRAM for FLUX
 * Ollama keep_alive: "0" = unload immediately
 */
async function evictLargeModels() {
  const loaded = await listLoadedModels();
  for (const m of loaded) {
    if (m.name.includes('embed') || m.name.includes('eye')) continue;
    try {
      await axios.post(`${OLLAMA_URL}/api/generate`, {
        model: m.name, keep_alive: '0', prompt: ''
      }, { timeout: 15000 });
      console.log(`[GPU_CTRL] Evicted ${m.name} to free VRAM`);
    } catch (e) {
      console.warn(`[GPU_CTRL] Evict ${m.name} failed:`, e.message);
    }
  }
}

async function preloadModel(modelName) {
  try {
    await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: modelName, keep_alive: '5m', prompt: ''
    }, { timeout: 60000 });
    return true;
  } catch (e) {
    console.error(`[GPU_CTRL] Preload ${modelName} failed:`, e.message);
    return false;
  }
}

// ─── Acquire / Release ───────────────────────────────────────────────────

async function acquire(requestId, auditFn) {
  if (_locked) {
    if (_lockTime && (Date.now() - _lockTime > LOCK_TIMEOUT_MS)) {
      console.warn(`[GPU_CTRL] Stale lock from ${_lockHolder}, forcing release`);
      await release(_lockHolder, auditFn);
    } else {
      return {
        acquired: false,
        reason: `Vision GPU locked by request ${_lockHolder} (${Math.round((Date.now() - _lockTime) / 1000)}s ago)`,
        queuePosition: 0
      };
    }
  }

  _locked = true;
  _lockHolder = requestId;
  _lockTime = Date.now();

  // Single GPU strategy: evict large LLMs to make room for FLUX
  await evictLargeModels();

  if (auditFn) {
    auditFn({
      agent: 'vision', action: 'gpu_acquire',
      meta: { requestId, mode: 'single-gpu-timeshare', gpu: 0 }
    });
  }

  return { acquired: true, gpu: 0, mode: 'timeshare' };
}

async function release(requestId, auditFn) {
  if (!_locked || _lockHolder !== requestId) {
    return { released: false, reason: 'Not lock holder' };
  }

  if (auditFn) {
    auditFn({
      agent: 'vision', action: 'gpu_release',
      meta: { requestId, elapsed: Date.now() - _lockTime }
    });
  }

  _locked = false;
  _lockHolder = null;
  _lockTime = null;

  return { released: true };
}

function isLocked() {
  return { locked: _locked, holder: _lockHolder, elapsed: _lockTime ? Date.now() - _lockTime : 0 };
}

module.exports = { acquire, release, isLocked, preloadModel, listLoadedModels, evictLargeModels };
