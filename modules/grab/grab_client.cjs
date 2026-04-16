'use strict';

const axios = require('axios');
const { loadConfig, getHeaders, refreshToken } = require('./grab_auth.cjs');

// ── NeuroKURO phase store (optional dependency) ───────────────────────────────

let _neuroStore = null;
try {
  _neuroStore = require('../../neuro/neuro_store.js');
} catch { /* neuro_store unavailable — phase overlay will use null */ }

// ── Phase overlay (Stage 5) ───────────────────────────────────────────────────

function overlayPhase(data) {
  let kuro = { phase: null };

  if (_neuroStore) {
    try {
      const state = typeof _neuroStore.getCurrentState === 'function'
        ? _neuroStore.getCurrentState()
        : _neuroStore;
      kuro = {
        phase:       state.phase       ?? null,
        phase_label: state.phase_label ?? null,
        msf_score:   state.msf_score   ?? null,
        timestamp:   Date.now(),
      };
    } catch { /* silently fall back to null phase */ }
  }

  if (Array.isArray(data)) {
    return Object.assign([], data, { _kuro: kuro });
  }
  return Object.assign({}, data, { _kuro: kuro });
}

// ── Structured error factory ──────────────────────────────────────────────────

function grabError(code, message, raw) {
  const err = new Error(message);
  err.code = code;
  err.raw  = raw !== undefined ? raw : null;
  return err;
}

// ── Core HTTP helper — GET with 401 auto-retry ────────────────────────────────

async function grabGet(url, params) {
  let headers = await getHeaders();

  let resp;
  try {
    resp = await axios.get(url, { params, headers, timeout: 15000 });
  } catch (firstErr) {
    if (firstErr.response && firstErr.response.status === 401) {
      // Force token refresh and retry exactly once
      try {
        await refreshToken();
        headers = await getHeaders();
        resp = await axios.get(url, { params, headers, timeout: 15000 });
      } catch (retryErr) {
        const code = retryErr.response ? retryErr.response.status : 'NETWORK_ERROR';
        throw grabError(code, `[GRAB] Request failed after token refresh (${url}): ${retryErr.message}`, retryErr.response ? retryErr.response.data : null);
      }
    } else {
      const code = firstErr.response ? firstErr.response.status : 'NETWORK_ERROR';
      throw grabError(code, `[GRAB] Request failed (${url}): ${firstErr.message}`, firstErr.response ? firstErr.response.data : null);
    }
  }

  return resp.data;
}

// ── Public API methods ────────────────────────────────────────────────────────

async function getRides(params) {
  const cfg = loadConfig();
  if (!cfg.endpoints.rides) {
    throw grabError('UNCONFIGURED', '[GRAB] rides endpoint not configured — populate grab_config.json via har_import.cjs', null);
  }
  const data = await grabGet(cfg.endpoints.rides, params);
  return overlayPhase(data);
}

async function getFoodOrders(params) {
  const cfg = loadConfig();
  if (!cfg.endpoints.food_orders) {
    throw grabError('UNCONFIGURED', '[GRAB] food_orders endpoint not configured — populate grab_config.json via har_import.cjs', null);
  }
  const data = await grabGet(cfg.endpoints.food_orders, params);
  return overlayPhase(data);
}

async function getWallet() {
  const cfg = loadConfig();
  if (!cfg.endpoints.wallet) {
    throw grabError('UNCONFIGURED', '[GRAB] wallet endpoint not configured — populate grab_config.json via har_import.cjs', null);
  }
  const data = await grabGet(cfg.endpoints.wallet, null);
  return overlayPhase(data);
}

async function getRawEndpoint(endpointPath, params) {
  const cfg = loadConfig();
  const url = cfg.base_url.replace(/\/$/, '') + '/' + endpointPath.replace(/^\//, '');
  const data = await grabGet(url, params);
  return overlayPhase(data);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { getRides, getFoodOrders, getWallet, getRawEndpoint, overlayPhase };
