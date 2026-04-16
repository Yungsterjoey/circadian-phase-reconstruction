'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, 'grab_config.json');

// ── Config I/O ────────────────────────────────────────────────────────────────

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

// ── Token state ───────────────────────────────────────────────────────────────

function isExpired() {
  const cfg = loadConfig();
  const expiry = cfg.auth.token_expiry;
  if (!expiry || expiry === 0) return true;
  // 60-second buffer before true expiry
  return (Date.now() / 1000) > (expiry - 60);
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function refreshToken() {
  const cfg = loadConfig();

  if (!cfg.endpoints.token_refresh) {
    throw new Error('[GRAB_AUTH] token_refresh endpoint not configured — run har_import.cjs first');
  }
  if (!cfg.auth.refresh_token) {
    throw new Error('[GRAB_AUTH] refresh_token is empty — run har_import.cjs first');
  }

  let resp;
  try {
    resp = await axios.post(
      cfg.endpoints.token_refresh,
      { refresh_token: cfg.auth.refresh_token },
      {
        headers: Object.assign({}, cfg.headers, { 'Content-Type': 'application/json' }),
        timeout: 10000,
      }
    );
  } catch (err) {
    const status = err.response ? err.response.status : 'NETWORK_ERROR';
    const body   = err.response ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`[GRAB_AUTH] Token refresh failed (${status}): ${body}`);
  }

  const data = resp.data;

  const newAccess  = data.access_token  || data.accessToken  || data.token;
  const newRefresh = data.refresh_token || data.refreshToken;
  const expiresIn  = data.expires_in    || data.expiresIn;
  const expiresAt  = data.token_expiry  || data.expiresAt;

  if (!newAccess) {
    throw new Error('[GRAB_AUTH] Token refresh response missing access_token field: ' + JSON.stringify(data));
  }

  cfg.auth.access_token = newAccess;
  if (newRefresh) cfg.auth.refresh_token = newRefresh;
  cfg.auth.token_expiry = expiresIn
    ? Math.floor(Date.now() / 1000) + expiresIn
    : expiresAt || 0;

  saveConfig(cfg);
  return cfg;
}

// ── Header builder ────────────────────────────────────────────────────────────

async function getHeaders() {
  if (isExpired()) {
    await refreshToken();
  }

  const cfg = loadConfig();

  if (!cfg.auth.access_token) {
    throw new Error('[GRAB_AUTH] access_token is empty — run har_import.cjs to populate credentials');
  }

  const headers = Object.assign({}, cfg.headers, {
    Authorization: `Bearer ${cfg.auth.access_token}`,
  });

  if (cfg.auth.user_agent) headers['User-Agent'] = cfg.auth.user_agent;
  if (cfg.auth.device_id)  headers['x-device-id'] = cfg.auth.device_id;

  // Sanity check — should never fail if logic above is correct
  if (!headers.Authorization) {
    throw new Error('[GRAB_AUTH] Authorization header missing after assembly — check config');
  }

  return headers;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { loadConfig, saveConfig, isExpired, refreshToken, getHeaders };
