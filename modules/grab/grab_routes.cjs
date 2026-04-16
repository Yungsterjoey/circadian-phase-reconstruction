'use strict';

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const { loadConfig, saveConfig } = require('./grab_auth.cjs');
const { getRides, getFoodOrders, getWallet, getRawEndpoint } = require('./grab_client.cjs');
const { proxyToSSE } = require('./grab_ws.cjs');

// ── Inline multipart .har parser (no multer dependency) ───────────────────────
// Handles multipart/form-data or bare application/json POST bodies.

function parseUploadBody(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';

    // If express.json() already consumed the body, use req.body directly
    if (ct.includes('application/json') && req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }

    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      // application/json — stream body not yet parsed
      if (ct.includes('application/json')) {
        try { return resolve(JSON.parse(raw.toString('utf8'))); }
        catch (e) { return reject(new Error('JSON parse error: ' + e.message)); }
      }

      // multipart/form-data — extract first part content
      const bMatch = ct.match(/boundary=([^\s;]+)/);
      if (!bMatch) {
        // Unknown content type — attempt JSON parse as fallback
        try { return resolve(JSON.parse(raw.toString('utf8'))); }
        catch { return reject(new Error('Unsupported Content-Type and body is not JSON: ' + ct)); }
      }

      const boundary = Buffer.from('--' + bMatch[1]);
      const body     = raw.toString('binary'); // binary so we don't corrupt multibyte
      const parts    = body.split('--' + bMatch[1]);

      for (const part of parts) {
        if (!part || part.startsWith('--') || part.trim() === '') continue;
        // Skip past the part headers (blank line = \r\n\r\n or \n\n)
        const sepIdx = part.indexOf('\r\n\r\n');
        const content = sepIdx !== -1
          ? part.slice(sepIdx + 4)
          : part.slice(part.indexOf('\n\n') + 2);
        // Strip trailing boundary marker
        const cleaned = content.replace(/\r\n$/, '').replace(/\r\n--$/, '');
        try {
          return resolve(JSON.parse(cleaned));
        } catch { /* try next part */ }
      }

      reject(new Error('No parseable JSON found in multipart body'));
    });
  });
}

// ── HAR import logic (shared with har_import.cjs) ────────────────────────────

function headerValue(headers, name) {
  const lc = name.toLowerCase();
  const h = (headers || []).find(h => h.name.toLowerCase() === lc);
  return h ? h.value : null;
}

function normalisePathPattern(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
      .replace(/\/\d{4,}/g, '/:id');
  } catch { return rawUrl; }
}

function inferEndpointKey(pattern) {
  const p = pattern.toLowerCase();
  if (p.includes('token') || p.includes('refresh') || p.includes('oauth')) return 'token_refresh';
  if (p.includes('tracking') || p.includes('realtime') || p.includes('live')) return 'tracking_ws';
  if (p.includes('wallet') || p.includes('balance') || p.includes('payment')) return 'wallet';
  if (p.includes('food') || p.includes('meal') || p.includes('restaurant') || p.includes('merchant')) return 'food_orders';
  if (p.includes('ride') || p.includes('booking') || p.includes('trip') || p.includes('driver')) return 'rides';
  return null;
}

function processHar(harObj) {
  const allEntries = (harObj.log || harObj).entries || [];
  const grabEntries = allEntries.filter(
    e => e.request && e.request.url && e.request.url.includes('api.grab.com')
  );

  const patternMap = {};
  for (const entry of grabEntries) {
    const pattern = normalisePathPattern(entry.request.url);
    if (!patternMap[pattern]) patternMap[pattern] = { url: entry.request.url, count: 0 };
    patternMap[pattern].count++;
  }

  let accessToken = '';
  for (const e of grabEntries) {
    const a = headerValue(e.request.headers, 'authorization');
    if (a) { accessToken = a.replace(/^Bearer\s+/i, '').trim(); break; }
  }

  const grabHeaders = {};
  for (const e of grabEntries) {
    for (const h of (e.request.headers || [])) {
      if (h.name.toLowerCase().startsWith('x-grab-')) grabHeaders[h.name] = h.value;
    }
  }

  let refreshToken = '';
  for (const e of grabEntries) {
    const url = e.request.url.toLowerCase();
    if (url.includes('token') || url.includes('refresh')) {
      try {
        const text = (e.response.content || {}).text;
        if (text) {
          const b = JSON.parse(text);
          refreshToken = b.refresh_token || b.refreshToken || '';
          if (refreshToken) break;
        }
      } catch { /* skip */ }
    }
  }

  const endpoints = {};
  for (const [pattern, info] of Object.entries(patternMap)) {
    const key = inferEndpointKey(pattern);
    if (key && !endpoints[key]) endpoints[key] = info.url;
  }

  // Persist to config
  const config = loadConfig();
  config.endpoints = Object.assign({ rides: '', food_orders: '', wallet: '', tracking_ws: '', token_refresh: '' }, config.endpoints, endpoints);
  if (accessToken)  config.auth.access_token  = accessToken;
  if (refreshToken) config.auth.refresh_token = refreshToken;
  config.headers = Object.assign({}, config.headers, grabHeaders);
  saveConfig(config);

  return {
    total_entries:   allEntries.length,
    grab_entries:    grabEntries.length,
    unique_patterns: Object.keys(patternMap).length,
    access_token_found:  !!accessToken,
    refresh_token_found: !!refreshToken,
    grab_headers_count:  Object.keys(grabHeaders).length,
    endpoints_populated: endpoints,
    patterns: Object.fromEntries(
      Object.entries(patternMap).map(([k, v]) => [k, { url: v.url, count: v.count, mapped_to: inferEndpointKey(k) }])
    ),
  };
}

// ── Auth guard helper ─────────────────────────────────────────────────────────

function resolveGuard(authMiddleware) {
  if (typeof authMiddleware === 'function') return authMiddleware;
  if (authMiddleware && typeof authMiddleware.user      === 'function') return authMiddleware.user;
  if (authMiddleware && typeof authMiddleware.analyst   === 'function') return authMiddleware.analyst;
  // Fallback: pass-through (dev/misconfigured environments)
  console.warn('[KURO::GRAB] authMiddleware not callable — routes unprotected');
  return (req, res, next) => next();
}

// ── Route mount ───────────────────────────────────────────────────────────────

function mountGrabRoutes(app, authMiddleware) {
  const guard = resolveGuard(authMiddleware);
  const router = express.Router();

  // ── GET /api/grab/status — always 200, no errors on unconfigured state ──────
  router.get('/status', guard, (req, res) => {
    try {
      const cfg = loadConfig();
      const endpointsLoaded = Object.values(cfg.endpoints).filter(v => v && v.length > 0).length;
      const configured = !!(cfg.auth.access_token && endpointsLoaded > 0);
      return res.json({
        configured,
        token_expiry:      cfg.auth.token_expiry,
        endpoints_loaded:  endpointsLoaded,
      });
    } catch {
      return res.json({ configured: false, token_expiry: 0, endpoints_loaded: 0 });
    }
  });

  // ── GET /api/grab/rides ───────────────────────────────────────────────────
  router.get('/rides', guard, async (req, res) => {
    const userId = req.user && req.user.userId;
    try {
      const data = await getRides(req.query);
      console.log(`[KURO::GRAB] /rides userId=${userId}`);
      return res.json(data);
    } catch (err) {
      console.error(`[KURO::GRAB] /rides error userId=${userId}`, err.message);
      return res.status(err.code === 'UNCONFIGURED' ? 503 : (typeof err.code === 'number' ? err.code : 502)).json({
        error: err.message, code: err.code, raw: err.raw,
      });
    }
  });

  // ── GET /api/grab/food/orders ─────────────────────────────────────────────
  router.get('/food/orders', guard, async (req, res) => {
    const userId = req.user && req.user.userId;
    try {
      const data = await getFoodOrders(req.query);
      console.log(`[KURO::GRAB] /food/orders userId=${userId}`);
      return res.json(data);
    } catch (err) {
      console.error(`[KURO::GRAB] /food/orders error userId=${userId}`, err.message);
      return res.status(err.code === 'UNCONFIGURED' ? 503 : (typeof err.code === 'number' ? err.code : 502)).json({
        error: err.message, code: err.code, raw: err.raw,
      });
    }
  });

  // ── GET /api/grab/wallet ───────────────────────────────────────────────────
  router.get('/wallet', guard, async (req, res) => {
    const userId = req.user && req.user.userId;
    try {
      const data = await getWallet();
      console.log(`[KURO::GRAB] /wallet userId=${userId}`);
      return res.json(data);
    } catch (err) {
      console.error(`[KURO::GRAB] /wallet error userId=${userId}`, err.message);
      return res.status(err.code === 'UNCONFIGURED' ? 503 : (typeof err.code === 'number' ? err.code : 502)).json({
        error: err.message, code: err.code, raw: err.raw,
      });
    }
  });

  // ── GET /api/grab/tracking/:orderId — SSE stream ───────────────────────────
  router.get('/tracking/:orderId', guard, async (req, res) => {
    const userId  = req.user && req.user.userId;
    const orderId = req.params.orderId;
    console.log(`[KURO::GRAB] /tracking/${orderId} userId=${userId}`);
    await proxyToSSE(orderId, res);
  });

  // ── POST /api/grab/import — multipart .har upload ─────────────────────────
  router.post('/import', guard, async (req, res) => {
    const userId = req.user && req.user.userId;
    console.log(`[KURO::GRAB] /import userId=${userId}`);
    let harObj;
    try {
      harObj = await parseUploadBody(req);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Could not parse upload: ' + parseErr.message });
    }
    try {
      const summary = processHar(harObj);
      return res.json({ ok: true, summary });
    } catch (err) {
      console.error('[KURO::GRAB] /import processing error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.use('/api/grab', router);
  console.log('[KURO::GRAB] Routes mounted at /api/grab/*');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { mountGrabRoutes };
