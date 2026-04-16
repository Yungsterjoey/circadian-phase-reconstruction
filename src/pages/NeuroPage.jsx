/**
 * NeuroKURO — Public landing + inline phase tool (spec §4)
 * POST /api/neuro/phase/simulate → { ct, phaseLabel, phaseDescription, localTime,
 *   confidence, transitions[], curve[], compounds[], advisory }
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import CookieBanner from '../components/CookieBanner';
import '../styles/kuroglass-tokens.css';

const ADVISORY = 'Advisory only — not medical advice.';

export default function NeuroPage() {
  return (
    <div className="kg-root kg-neuro">
      <CookieBanner />

      <nav className="kg-nav">
        <Link to="/" className="kg-brand kg-brand-back">← KURO</Link>
        <div className="kg-nav-right">
          <a href="/docs" className="kg-nav-link">Docs</a>
          <span className="kg-nav-dot">·</span>
          <Link to="/login" className="kg-nav-link">Sign in</Link>
        </div>
      </nav>

      <div className="kg-advisory kg-advisory-top">{ADVISORY}</div>

      <section className="kg-hero kg-hero-neuro">
        <h1 className="kg-hero-title">NeuroKURO</h1>
        <p className="kg-hero-sub">
          Circadian phase reconstruction, validated against actigraphy-derived
          circadian phase proxies.
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
          <li><span className="kg-muted">Paper</span> — Journal of Sleep Research (in review)</li>
          <li>
            <span className="kg-muted">Zenodo preprint</span> —
            {' '}<a href="https://doi.org/10.5281/zenodo.18869320" target="_blank" rel="noreferrer">DOI: 10.5281/zenodo.18869320</a>
          </li>
          <li><span className="kg-muted">IP</span> — Provisional patent filed (IP Australia)</li>
          <li><a href="/docs/neuro">Public API documentation</a></li>
        </ul>
      </section>

      <div className="kg-advisory kg-advisory-bottom">{ADVISORY}</div>

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
              <a href="https://kuropay.com">KUROPay</a>
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
      <h2 className="kg-section-title">Phase tool</h2>
      <p className="kg-phase-hint">
        Enter your typical sleep and wake times to reconstruct your current circadian phase.
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
          <div className="kg-phase-label">{result.phaseLabel} · <span className="kg-muted">{result.phaseDescription}</span></div>
          <div className="kg-phase-meta">
            <span>Confidence ±{((1 - (result.confidence ?? 0)) * 100).toFixed(0)}%</span>
            <span>·</span>
            <span>Phase type: Entrained</span>
            {nextTransition && (
              <>
                <span>·</span>
                <span>Next phase: <b>{nextTransition.phaseLabel}</b> at {nextTransition.clockTime}</span>
              </>
            )}
          </div>
          <button
            className="kg-phase-curve-btn"
            onClick={() => { console.log('[neuro] 24h phase curve', result.curve); }}
          >
            View 24h phase curve →
          </button>
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
  min-height: 100vh; min-height: 100dvh;
  background: var(--kg-bg);
  background-image:
    radial-gradient(ellipse 800px 500px at 30% 0%, rgba(168,121,255,0.22), transparent 60%),
    radial-gradient(ellipse 600px 700px at 80% 40%, rgba(108,69,224,0.15), transparent 70%);
  color: var(--kg-text);
  font-family: var(--kg-font);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.kg-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 32px;
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  background: rgba(0,0,0,0.4);
  border-bottom: 1px solid var(--kg-card-border);
}
.kg-brand { font-size: 15px; font-weight: 600; letter-spacing: 3px; color: var(--kg-text); text-decoration: none; }
.kg-brand-back:hover { color: var(--kg-purple); }
.kg-nav-right { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.kg-nav-link { color: var(--kg-text-muted); text-decoration: none; transition: color 150ms; }
.kg-nav-link:hover { color: var(--kg-text); }
.kg-nav-dot { color: var(--kg-text-dim); }

.kg-advisory {
  max-width: 960px; margin: 0 auto;
  font-size: 12px; color: rgba(255,255,255,0.55);
  text-align: center; padding: 12px 32px;
  border-bottom: 1px solid rgba(168,121,255,0.18);
  background: rgba(168,121,255,0.05);
  letter-spacing: 0.3px;
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
.kg-phase-curve-btn {
  align-self: flex-start;
  margin-top: 12px;
  padding: 8px 16px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--kg-card-border);
  border-radius: 10px;
  color: var(--kg-text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 150ms;
}
.kg-phase-curve-btn:hover { background: rgba(255,255,255,0.1); }

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
.kg-footer-cols { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 24px; }
.kg-footer-col { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.kg-footer-col a, .kg-footer-col span { color: var(--kg-text-muted); text-decoration: none; transition: color 150ms; }
.kg-footer-col a:hover { color: var(--kg-text); }
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
  .kg-nav { padding: 16px 20px; }
  .kg-hero.kg-hero-neuro { padding: 48px 20px 24px; }
  .kg-validation, .kg-phase-tool, .kg-resources { padding: 24px 20px; }
  .kg-phase-inputs { grid-template-columns: 1fr; }
  .kg-val-label { min-width: unset; }
  .kg-footer-cols { grid-template-columns: 1fr; }
  .kg-footer { padding: 48px 20px 32px; }
}
    `}</style>
  );
}
