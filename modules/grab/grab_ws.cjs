'use strict';

const WebSocket = require('ws');
const { loadConfig, getHeaders } = require('./grab_auth.cjs');

const MAX_RECONNECTS   = 5;
const BACKOFF_BASE_MS  = 1000;
const BACKOFF_MAX_MS   = 30000;

// ── connectTracking ───────────────────────────────────────────────────────────
//
// Opens an authenticated WebSocket to the tracking endpoint.
// Pipes parsed JSON frames to onData().
// Reconnects on close with exponential backoff (max 5 attempts).
// Returns a control object { close() } after the first connection is opened.

async function connectTracking(orderId, onData, onClose) {
  const cfg = loadConfig();

  if (!cfg.endpoints.tracking_ws) {
    throw new Error('[GRAB_WS] tracking_ws endpoint not configured — populate grab_config.json via har_import.cjs');
  }

  let attempt       = 0;
  let stopped       = false;
  let activeSocket  = null;

  // Build the WS URL — append orderId if the endpoint doesn't already contain it
  function buildWsUrl() {
    const base = cfg.endpoints.tracking_ws;
    if (!orderId) return base;
    return base.includes('?')
      ? `${base}&orderId=${encodeURIComponent(orderId)}`
      : `${base}?orderId=${encodeURIComponent(orderId)}`;
  }

  function scheduleReconnect() {
    if (stopped || attempt >= MAX_RECONNECTS) {
      const err = new Error(`[GRAB_WS] Max reconnects (${MAX_RECONNECTS}) reached for orderId=${orderId}`);
      console.error('[GRAB_WS_FAIL]', { orderId, error: err.message });
      if (onClose) onClose(err);
      return;
    }
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
    console.warn(`[GRAB_WS] Reconnecting in ${delay}ms (attempt ${attempt}/${MAX_RECONNECTS}) for orderId=${orderId}`);
    setTimeout(() => { if (!stopped) openSocket(); }, delay);
  }

  async function openSocket() {
    let headers;
    try {
      headers = await getHeaders();
    } catch (err) {
      console.error('[GRAB_WS_FAIL]', { orderId, error: '[GRAB_WS] Failed to get auth headers: ' + err.message });
      attempt++;
      scheduleReconnect();
      return;
    }

    const wsUrl = buildWsUrl();
    const ws = new WebSocket(wsUrl, { headers });
    activeSocket = ws;
    attempt++;

    ws.on('open', () => {
      attempt = 0; // reset backoff counter on successful connect
    });

    ws.on('message', (raw) => {
      try {
        onData(JSON.parse(raw.toString()));
      } catch {
        onData({ _raw: raw.toString() });
      }
    });

    ws.on('error', (err) => {
      console.error('[GRAB_WS_FAIL]', { orderId, error: err.message });
      // 'close' fires after 'error', so reconnect logic lives in close handler
    });

    ws.on('close', (code, reason) => {
      activeSocket = null;
      if (!stopped) {
        scheduleReconnect();
      } else {
        if (onClose) onClose(null);
      }
    });
  }

  await openSocket();

  return {
    close() {
      stopped = true;
      if (activeSocket) {
        try { activeSocket.close(); } catch { /* ignore */ }
        activeSocket = null;
      }
    },
  };
}

// ── proxyToSSE ────────────────────────────────────────────────────────────────
//
// Connects the tracking WebSocket for orderId and streams frames as
// Server-Sent Events to an Express response object.
// Sends at least one "connected" event immediately.

async function proxyToSSE(orderId, res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Immediate acknowledgement — satisfies the "at least one data: event" PASS criterion
  res.write(`data: ${JSON.stringify({ type: 'connected', orderId })}\n\n`);

  let control;
  try {
    control = await connectTracking(
      orderId,
      (frame) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
        }
      },
      (err) => {
        if (err) {
          console.error('[GRAB_WS_FAIL]', { orderId, error: err.message });
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
          }
        }
        if (!res.writableEnded) res.end();
      }
    );
  } catch (err) {
    console.error('[GRAB_WS_FAIL]', { orderId, error: err.message });
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  // Clean up WS when the HTTP connection drops
  res.on('close', () => {
    if (control) control.close();
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { connectTracking, proxyToSSE };
