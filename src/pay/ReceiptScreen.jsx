import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Receipt / success view.
 *
 * The /confirm response tells us three outcomes:
 *   confirmed=true,  status='settled'  → full success, show proof
 *   confirmed=false, status='pending'  → card charged, settlement queued
 *   confirmed=false, status='failed'   → show failure
 *
 * "Show to vendor" mode turns the screen into a giant high-contrast card
 * with the reference + merchant name — held up at the counter so the
 * vendor sees the QR was actioned.
 */
export default function ReceiptScreen() {
  const loc = useLocation();
  const nav = useNavigate();
  const [vendorMode, setVendorMode] = useState(false);
  const [copied, setCopied]         = useState(false);

  const { created, conf } = loc.state || {};

  if (!created || !conf) {
    return (
      <div className="kp-fullscreen kp-center">
        <div className="kp-dim">No receipt context.</div>
        <button className="kp-btn kp-mt16" onClick={() => nav('/scan', { replace: true })}>Back to scan</button>
      </div>
    );
  }

  const status    = conf.status;        // settled | pending | failed
  const confirmed = !!conf.confirmed;
  const receipt   = conf.receipt || {};
  const proof     = receipt.proof;
  const merchant  = receipt.merchant || created.merchant?.name || 'Merchant';
  const ref       = receipt.reference || created.reference;

  async function copyProof() {
    if (!proof) return;
    try { await navigator.clipboard.writeText(proof); setCopied(true); }
    catch (_) { setCopied(true); }
    setTimeout(() => setCopied(false), 1600);
  }

  if (vendorMode) {
    return (
      <div className="kp-vendor" onClick={() => setVendorMode(false)}>
        <div className="kp-vendor-tick">✓</div>
        <div className="kp-vendor-merchant">{merchant}</div>
        <div className="kp-vendor-amount">AUD {(created.amountAud || receipt.amountAud || 0).toFixed(2)}</div>
        {ref && <div className="kp-vendor-ref">Ref: {ref}</div>}
        <div className="kp-vendor-hint">Tap anywhere to exit</div>
      </div>
    );
  }

  return (
    <div className="kp-fullscreen kp-receipt-root">
      <div className="kp-receipt-hero">
        {confirmed ? (
          <>
            <div className="kp-tick">✓</div>
            <div className="kp-title">Payment settled</div>
          </>
        ) : status === 'failed' ? (
          <>
            <div className="kp-cross">✕</div>
            <div className="kp-title">Payment failed</div>
          </>
        ) : (
          <>
            <div className="kp-hourglass">⌛</div>
            <div className="kp-title">Settling…</div>
          </>
        )}
      </div>

      <div className="kp-glass kp-receipt-card">
        <Row label="To"            value={merchant} />
        {receipt.bank       && <Row label="Bank"        value={receipt.bank} />}
        {(receipt.amountLocal != null) && (
          <Row label="Local amount" value={`${Number(receipt.amountLocal).toLocaleString()} ${receipt.currency || ''}`} />
        )}
        <Row label="Charged"       value={`AUD ${(created.amountAud || receipt.amountAud || 0).toFixed(2)}`} />
        {created.commission != null && <Row label="Fee" value={`AUD ${created.commission.toFixed(2)}`} />}
        {ref && <Row label="Reference" value={ref} />}
        {receipt.settledAt && (
          <Row label="Settled at" value={new Date(receipt.settledAt * 1000).toLocaleString()} />
        )}
      </div>

      {confirmed && proof && (
        <div className="kp-glass kp-proof" onClick={copyProof}>
          <div className="kp-dim kp-xs">x402 proof {copied && <span className="kp-accent">— copied</span>}</div>
          <div className="kp-proof-value">{proof}</div>
        </div>
      )}

      {!confirmed && status === 'pending' && (
        <div className="kp-notice">
          {conf.message || 'Card charged — settlement is queued. You’ll get a push when it lands.'}
        </div>
      )}

      {status === 'failed' && (
        <div className="kp-err">{conf.message || 'Payment did not complete.'}</div>
      )}

      <div className="kp-receipt-actions">
        {confirmed && (
          <button className="kp-btn kp-btn-ghost" onClick={() => setVendorMode(true)}>
            Show to vendor
          </button>
        )}
        <button className="kp-btn kp-btn-primary" onClick={() => nav('/scan', { replace: true })}>
          Done
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="kp-row">
      <div className="kp-dim kp-xs">{label}</div>
      <div className="kp-row-value">{value}</div>
    </div>
  );
}
