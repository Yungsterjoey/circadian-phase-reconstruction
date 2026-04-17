/**
 * NeuroKURO: Public landing + inline phase tool (spec §4)
 * POST /api/neuro/phase/simulate → { ct, phaseLabel, phaseDescription, localTime,
 *   confidence, transitions[], curve[], compounds[], advisory }
 */
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CookieBanner from '../components/CookieBanner';
import DesktopBackground from '../components/DesktopBackground';
import KuroToolbar from '../components/KuroToolbar';
import LegalModal from '../components/legal/LegalModal';
import { openLegalModal } from '../components/legal/legalBus';
import { LEGAL_ORDER, LEGAL_LABELS } from '../components/legal/legalContent.jsx';
import '../styles/kuroglass-tokens.css';

const ADVISORY_SHORT = 'Advisory only. Not medical advice.';
const ADVISORY_FULL  = 'Decision support only. Not medical advice. Not a diagnostic device.';

export default function NeuroPage() {
  useEffect(() => {
    document.documentElement.classList.add('kg-scroll-page');
    return () => document.documentElement.classList.remove('kg-scroll-page');
  }, []);

  return (
    <div className="kg-root kg-neuro">
      <DesktopBackground />
      <CookieBanner />
      <LegalModal />

      <KuroToolbar showBack right={
        <>
          <a href="/docs" className="kg-nav-link">Docs</a>
          <span className="kg-nav-dot">·</span>
          <Link to="/login" className="kg-nav-link">Sign in</Link>
        </>
      } />

      <div className="kg-advisory kg-advisory-top">
        <span className="kg-advisory-glyph" aria-hidden>◐</span>
        {ADVISORY_SHORT}
      </div>

      <section className="kg-hero kg-hero-neuro">
        <h1 className="kg-hero-title">NeuroKURO</h1>
        <p className="kg-hero-sub">
          Phase reconstruction from sleep timing. Validated against
          actigraphy-derived phase proxies on two independent cohorts.
        </p>
      </section>

      <section className="kg-validation">
        <ValidationRow label="MMASH dataset"   body="N=20 adults · MAE 0.29h" />
        <ValidationRow label="SANDD dataset"   body="N=368 sessions · MAE 0.31h" />
        <ValidationRow label="Blume 2024 ablation" body="Confirms sleep-onset correction is load-bearing" />
      </section>

      <PhaseTool />

      <section className="kg-resources">
        <h2 className="kg-section-title">Resources</h2>
        <ul className="kg-resource-list">
          <li><span className="kg-muted">Paper</span> · Journal of Sleep Research (in review)</li>
          <li>
            <span className="kg-muted">Zenodo preprint</span> ·
            {' '}<a href="https://doi.org/10.5281/zenodo.18869320" target="_blank" rel="noreferrer">DOI: 10.5281/zenodo.18869320</a>
          </li>
          <li><span className="kg-muted">IP</span> · Provisional patent filed (IP Australia)</li>
          <li><a href="/docs/neuro">Public API documentation</a></li>
        </ul>
      </section>

      <div className="kg-advisory kg-advisory-bottom">
        <span className="kg-advisory-glyph" aria-hidden>◐</span>
        {ADVISORY_FULL}
      </div>

      <footer className="kg-footer">
        <div className="kg-footer-inner">
          <div className="kg-footer-top">
            <div className="kg-footer-brand">
              <span className="kg-footer-name">KURO</span>
              <span className="kg-footer-tag">Sovereign infrastructure for the agentic era.</span>
            </div>
          </div>
          <hr className="kg-footer-rule" />
          <div className="kg-footer-cols">
            <div className="kg-footer-col">
              <span className="kg-footer-col-label">Products</span>
              <Link to="/app">KURO OS</Link>
              <Link to="/neuro">NeuroKURO</Link>
              <a href="/pay">KUROPay</a>
              <a href="/docs">Docs</a>
            </div>
            <div className="kg-footer-col">
              <span className="kg-footer-col-label">Research</span>
              <Link to="/neuro">NeuroKURO</Link>
              <span className="kg-footer-muted">Paper (soon)</span>
              <a href="https://www.x402.org">x402 docs</a>
              <a href="https://doi.org/10.5281/zenodo.18869320">Zenodo DOI</a>
            </div>
            <div className="kg-footer-col">
              <span className="kg-footer-col-label">Company</span>
              <a href="/about">About</a>
              <a href="mailto:hi@kuroglass.net">Contact</a>
              <a href="/press">Press</a>
              <a href="/careers">Careers</a>
            </div>
            <div className="kg-footer-col">
              <span className="kg-footer-col-label">Legal</span>
              {LEGAL_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="kg-footer-linkbtn"
                  onClick={() => openLegalModal(id)}
                >
                  {LEGAL_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
          <hr className="kg-footer-rule" />
          <div className="kg-footer-meta">
            <span className="kg-footer-membership">x402 Foundation member</span>
            <span className="kg-footer-locations">Built in Da Nang and Melbourne</span>
            <a href="/docs" className="kg-footer-docs">kuroglass.net/docs</a>
          </div>
          <p className="kg-footer-copy">© 2026 KURO Technologies · ABN 45 340 322 909</p>
        </div>
      </footer>

      <NeuroStyles />
    </div>
  );
}

/* ─── 24-point alertness curve sparkline (from /phase/simulate response) ── */
function AlertnessCurve({ curve, currentCt }) {
  const W = 720, H = 120, PAD_X = 8, PAD_Y = 14;
  const xs = curve.map((_, i) => PAD_X + (i / (curve.length - 1)) * (W - PAD_X * 2));
  const ys = curve.map(p => {
    const norm = (p.alertness + 1) / 2;          // −1..1 → 0..1
    return H - PAD_Y - norm * (H - PAD_Y * 2);
  });
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${path} L${xs[xs.length - 1].toFixed(1)} ${H - PAD_Y} L${xs[0].toFixed(1)} ${H - PAD_Y} Z`;

  // Find nearest curve point for current CT marker
  let nearestIdx = 0;
  let bestDelta = Infinity;
  curve.forEach((p, i) => {
    const d = Math.abs(p.ct - currentCt);
    if (d < bestDelta) { bestDelta = d; nearestIdx = i; }
  });

  return (
    <div className="kg-curve">
      <div className="kg-curve-header">
        <span className="kg-curve-title">24-hour alertness curve</span>
        <span className="kg-curve-legend">
          <span className="kg-curve-dot" /> you · now
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="kg-curve-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="kg-curve-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="#00D9C5" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00D9C5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Midline */}
        <line x1={PAD_X} x2={W - PAD_X} y1={H / 2} y2={H / 2}
              stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
        <path d={areaPath} fill="url(#kg-curve-fill)" />
        <path d={path} fill="none" stroke="#00D9C5" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Current marker */}
        <circle cx={xs[nearestIdx]} cy={ys[nearestIdx]} r="4.5" fill="#00D9C5"
                stroke="#000" strokeWidth="2" />
      </svg>
      <div className="kg-curve-axis">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

function ValidationRow({ label, body }) {
  return (
    <div className="kg-val-row">
      <span className="kg-val-label">{label}</span>
      <span className="kg-val-body">{body}</span>
    </div>
  );
}

/* ─── Inline phase tool (§4.3) ─────────────────────────────────────── */
function PhaseTool() {
  const [sleepOnset, setSleepOnset] = useState('22:45');
  const [wakeTime,   setWakeTime]   = useState('06:30');
  const [timezone,   setTimezone]   = useState('Asia/Ho_Chi_Minh');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [result,     setResult]     = useState(null);

  async function compute() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await fetch('/api/neuro/phase/simulate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sleepOnset, wakeTime, timezone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const nextTransition = result?.transitions?.[0];

  return (
    <section className="kg-phase-tool" data-testid="phase-tool">
      <h2 className="kg-section-title">Try it on your sleep</h2>
      <p className="kg-phase-hint">
        Your last sleep determines your current phase. Enter it to see where
        you are on the 24-hour cycle.
      </p>
      <div className="kg-phase-inputs">
        <label className="kg-phase-field">
          <span>Sleep onset</span>
          <input type="time" value={sleepOnset} onChange={e => setSleepOnset(e.target.value)} data-testid="input-sleep-onset" />
        </label>
        <label className="kg-phase-field">
          <span>Wake time</span>
          <input type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)} data-testid="input-wake-time" />
        </label>
        <label className="kg-phase-field">
          <span>Timezone</span>
          <select value={timezone} onChange={e => setTimezone(e.target.value)} data-testid="input-timezone">
            <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (ICT +07:00)</option>
            <option value="Australia/Melbourne">Australia/Melbourne</option>
            <option value="Asia/Singapore">Asia/Singapore</option>
            <option value="Asia/Bangkok">Asia/Bangkok</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <button className="kg-phase-btn" onClick={compute} disabled={loading} data-testid="btn-compute-phase">
          {loading ? 'Computing…' : 'Compute phase'}
        </button>
      </div>

      {error && <div className="kg-phase-error">Error: {error}</div>}

      {result && (
        <div className="kg-phase-result" data-testid="phase-result">
          <div className="kg-phase-ct">
            CT {Number(result.ct).toFixed(1)}
          </div>
          <div className="kg-phase-label">
            {result.phaseLabel}
            {result.phaseDescription && (
              <> · <span className="kg-muted">{result.phaseDescription.replace(/^CT\d+–\d+\s+[—:]\s+/, '')}</span></>
            )}
          </div>
          <div className="kg-phase-meta">
            {typeof result.variance === 'number' && (
              <span>±{result.variance.toFixed(2)}h uncertainty</span>
            )}
            {nextTransition && (
              <>
                <span>·</span>
                <span>Next: <b>{nextTransition.phaseLabel}</b> at {nextTransition.clockTime}</span>
              </>
            )}
            {typeof result.hoursAwake === 'number' && (
              <>
                <span>·</span>
                <span>{result.hoursAwake.toFixed(1)}h awake</span>
              </>
            )}
          </div>
          {Array.isArray(result.curve) && result.curve.length > 0 && (
            <AlertnessCurve curve={result.curve} currentCt={Number(result.ct)} />
          )}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */
function NeuroStyles() {
  return (
    <style>{`
.kg-root.kg-neuro {
  position: relative;
  z-index: 1;
  min-height: 100vh; min-height: 100dvh;
  color: var(--kg-text);
  font-family: var(--kg-font);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
.kg-root.kg-neuro > :not(.desktop-bg):not(.kg-nav) { position: relative; z-index: 1; }

/* Top-nav styling lives in KuroToolbar.jsx (self-contained <style>).
   We just reserve space below the fixed toolbar. */
.kg-root.kg-neuro { padding-top: 56px; }

.kg-advisory {
  max-width: 960px; margin: 0 auto;
  font-size: 12px; color: rgba(255,255,255,0.55);
  text-align: center; padding: 12px 32px;
  border-bottom: 1px solid rgba(168,121,255,0.18);
  background: rgba(168,121,255,0.05);
  letter-spacing: 0.3px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.kg-advisory-glyph {
  display: inline-block;
  color: var(--kg-purple);
  font-size: 13px;
  opacity: 0.85;
}
.kg-advisory-top { margin-top: 0; }
.kg-advisory-bottom { border-top: 1px solid rgba(168,121,255,0.18); border-bottom: none; margin-top: 48px; }

.kg-hero.kg-hero-neuro {
  max-width: 960px; margin: 0 auto;
  padding: 80px 32px 32px;
  text-align: left;
}
.kg-hero-title {
  font-size: clamp(40px, 5.5vw, 56px);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.05;
  margin: 0 0 20px;
  background: var(--kg-gradient-neuro);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.kg-hero-sub {
  font-size: clamp(16px, 1.6vw, 20px);
  font-weight: 300;
  color: var(--kg-text-muted);
  line-height: 1.5;
  max-width: 600px;
  margin: 0;
}

.kg-validation {
  max-width: 960px; margin: 0 auto;
  padding: 32px 32px;
  display: flex; flex-direction: column; gap: 12px;
}
.kg-val-row {
  display: flex; gap: 16px; align-items: baseline;
  padding: 14px 18px;
  background: var(--kg-card-surface);
  border: 1px solid var(--kg-card-border);
  border-radius: 12px;
  font-size: 14px;
}
.kg-val-label {
  font-weight: 600; color: var(--kg-purple);
  min-width: 200px;
}
.kg-val-body { color: var(--kg-text-muted); }

.kg-phase-tool {
  max-width: 960px; margin: 0 auto;
  padding: 48px 32px 32px;
}
.kg-section-title {
  font-size: 24px; font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 8px;
}
.kg-phase-hint {
  font-size: 14px; color: var(--kg-text-muted);
  margin: 0 0 24px;
  font-weight: 300;
}
.kg-phase-inputs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: end;
}
.kg-phase-field {
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12px; color: var(--kg-text-muted);
}
.kg-phase-field input, .kg-phase-field select {
  padding: 10px 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--kg-card-border);
  border-radius: 10px;
  color: var(--kg-text);
  font-size: 14px;
  font-family: inherit;
}
.kg-phase-field input:focus, .kg-phase-field select:focus {
  outline: none; border-color: var(--kg-purple);
}
.kg-phase-btn {
  padding: 10px 20px;
  background: var(--kg-gradient-neuro);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 14px; font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: transform 100ms, filter 150ms;
  white-space: nowrap;
}
.kg-phase-btn:hover:not(:disabled) { filter: brightness(1.1); }
.kg-phase-btn:active { transform: scale(0.98); }
.kg-phase-btn:disabled { opacity: 0.6; cursor: wait; }

.kg-phase-error {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(255,80,80,0.08);
  border: 1px solid rgba(255,80,80,0.25);
  border-radius: 10px;
  color: #ff8b8b;
  font-size: 13px;
}
.kg-phase-result {
  margin-top: 28px;
  padding: 28px;
  background: var(--kg-card-surface);
  border: 1px solid var(--kg-card-border);
  border-radius: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.kg-phase-ct {
  font-size: 48px; font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--kg-teal);
  line-height: 1;
}
.kg-phase-label { font-size: 16px; color: var(--kg-text); }
.kg-phase-meta {
  display: flex; gap: 10px; flex-wrap: wrap;
  font-size: 13px; color: var(--kg-text-muted);
}
.kg-curve {
  margin-top: 20px;
  padding: 14px 16px 10px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--kg-card-border);
  border-radius: 12px;
}
.kg-curve-header {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 6px;
  font-size: 12px; color: var(--kg-text-muted);
  letter-spacing: 0.3px;
}
.kg-curve-title { text-transform: uppercase; font-size: 11px; font-weight: 600; color: var(--kg-text-dim); letter-spacing: 1.2px; }
.kg-curve-legend { font-size: 11px; color: var(--kg-text-muted); display: inline-flex; align-items: center; gap: 6px; }
.kg-curve-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--kg-teal); box-shadow: 0 0 6px rgba(0,217,197,0.7); }
.kg-curve-svg { width: 100%; height: 120px; display: block; }
.kg-curve-axis {
  display: flex; justify-content: space-between;
  font-size: 10px; color: var(--kg-text-dim);
  font-variant-numeric: tabular-nums;
  margin-top: 2px; padding: 0 2px;
}

.kg-resources {
  max-width: 960px; margin: 0 auto;
  padding: 32px 32px;
}
.kg-resource-list {
  list-style: none; padding: 0; margin: 16px 0 0;
  display: flex; flex-direction: column; gap: 10px;
  font-size: 14px;
}
.kg-resource-list li {
  padding: 10px 14px;
  background: var(--kg-card-surface);
  border: 1px solid var(--kg-card-border);
  border-radius: 10px;
  color: var(--kg-text);
}
.kg-resource-list a { color: var(--kg-teal); text-decoration: none; }
.kg-resource-list a:hover { text-decoration: underline; }
.kg-muted { color: var(--kg-text-dim); margin-right: 8px; }

.kg-footer {
  border-top: 1px solid var(--kg-card-border);
  padding: 64px 32px 48px;
}
.kg-footer-inner { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
.kg-footer-top { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.kg-footer-brand { display: flex; flex-direction: column; gap: 6px; }
.kg-footer-name { font-size: 15px; font-weight: 600; letter-spacing: 3px; color: var(--kg-text); }
.kg-footer-tag { font-size: 13px; color: var(--kg-text-muted); }
.kg-footer-rule { border: none; border-top: 1px solid var(--kg-card-border); margin: 8px 0; }
.kg-footer-cols { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 24px; }
.kg-footer-col { display: flex; flex-direction: column; gap: 10px; font-size: 13px; align-items: flex-start; }
.kg-footer-col a, .kg-footer-col span { color: var(--kg-text-muted); text-decoration: none; transition: color 150ms; }
.kg-footer-col a:hover { color: var(--kg-text); }
.kg-footer-linkbtn { appearance: none; border: 0; padding: 0; margin: 0; background: transparent; color: var(--kg-text-muted); font: inherit; font-size: 13px; cursor: pointer; text-align: left; transition: color 150ms; }
.kg-footer-linkbtn:hover { color: var(--kg-text); }
.kg-footer-col-label { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--kg-text-dim) !important; margin-bottom: 4px; }
.kg-footer-muted { color: var(--kg-text-dim); font-style: italic; }
.kg-footer-meta { display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px; color: var(--kg-text-muted); }
.kg-footer-membership { color: var(--kg-teal); }
.kg-footer-docs { color: var(--kg-text-muted); text-decoration: none; }
.kg-footer-docs:hover { color: var(--kg-text); }
.kg-footer-copy { font-size: 12px; color: var(--kg-text-dim); margin: 0; }

@media (max-width: 900px) {
  .kg-phase-inputs { grid-template-columns: 1fr 1fr; }
  .kg-phase-btn { grid-column: 1 / -1; }
  .kg-footer-cols { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 560px) {
  .kg-hero.kg-hero-neuro { padding: 48px 20px 24px; }
  .kg-validation, .kg-phase-tool, .kg-resources { padding: 24px 20px; }
  .kg-phase-inputs { grid-template-columns: 1fr; }
  .kg-val-label { min-width: unset; }
  .kg-footer-cols { grid-template-columns: 1fr 1fr; gap: 20px; }
  .kg-footer { padding: 48px 20px 32px; }
}
    `}</style>
  );
}
