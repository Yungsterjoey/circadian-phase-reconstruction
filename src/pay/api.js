/**
 * KURO::PAY frontend API client.
 *
 * Legacy shim routes (still active for backward compat):
 *   POST /api/pay/x402/quote    — public, parses QR + previews AUD
 *   POST /api/pay/x402/create   — auth'd, loopbacks to v2 /initiate
 *   POST /api/pay/x402/confirm  — auth'd, ledger read
 *
 * New unified routes (Phase A):
 *   POST /api/pay/detect        — input → { rail, confidence, parsed, disambiguation? }
 *   POST /api/pay/initiate      — { rail, destination, amountLocal, userId } → { paymentId, status }
 *   GET  /api/pay/status/:id    — { status, settledAt, receipt }
 *
 * Card management:
 *   POST /api/pay/card/setup    — SetupIntent client_secret
 *   GET  /api/pay/card/list     — saved cards
 */

async function postJSON(path, body) {
  const res = await fetch(path, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${path} failed (${res.status})`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data;
}

async function getJSON(path) {
  const res = await fetch(path, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${path} failed (${res.status})`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data;
}

// ── Legacy shim (v1 contract) ──
export const quote          = (payload) => postJSON('/api/pay/x402/quote',   payload);
export const createPayment  = (payload) => postJSON('/api/pay/x402/create',  payload);
export const confirmPayment = (payload) => postJSON('/api/pay/x402/confirm', payload);

// ── New unified routes (Phase A) ──
export const detect         = (payload) => postJSON('/api/pay/detect',       payload);
export const initiatePayment = (payload) => postJSON('/api/pay/initiate',    payload);
export const getPaymentStatus = (id)    => getJSON (`/api/pay/status/${id}`);

// ── v2 native (card management) ──
export const fetchCards     = ()        => getJSON ('/api/pay/card/list');
export const getSetupIntent = ()        => postJSON('/api/pay/card/setup', {});
