/**
 * kuroglass.net: Front Page (spec §3)
 * Three product tiles: KURO OS → /app · NeuroKURO → /neuro · KUROPay → /pay
 * Sovereignty positioning, ABN + x402 Foundation footer.
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import CookieBanner from '../components/CookieBanner';
import DesktopBackground from '../components/DesktopBackground';
import GlassCube from '../components/ui/GlassCube';
import KuroToolbar from '../components/KuroToolbar';
import LegalModal from '../components/legal/LegalModal';
import { openLegalModal } from '../components/legal/legalBus';
import { LEGAL_ORDER, LEGAL_LABELS } from '../components/legal/legalContent.jsx';
import '../styles/kuroglass-tokens.css';

export default function HomePage() {
  useEffect(() => {
    document.documentElement.classList.add('kg-scroll-page');
    return () => document.documentElement.classList.remove('kg-scroll-page');
  }, []);

  return (
    <div className="kg-root">
      <DesktopBackground />
      <CookieBanner />
      <LegalModal />

      {/* ═══ TOP NAV ═══ */}
      <KuroToolbar right={
        <>
          <a href="/docs" className="kg-nav-link">Docs</a>
          <span className="kg-nav-dot">·</span>
          <Link to="/login" className="kg-nav-link">Sign in</Link>
        </>
      } />

      {/* ═══ HERO ═══ */}
      <section className="kg-hero">
        <div className="kg-hero-cube">
          <GlassCube size="hero" />
        </div>
        <h1 className="kg-hero-title">
          <span className="kg-hero-line">Sovereign infrastructure</span>
          <span className="kg-hero-line">for the agentic era.</span>
        </h1>
        <p className="kg-hero-sub">
          Local AI. Circadian science. Card-native payments.
          Built in Melbourne and Da Nang.
        </p>
      </section>

      {/* ═══ THREE TILES ═══ */}
      <section className="kg-tiles">
        <Tile
          title="KURO OS"
          gradient="var(--kg-gradient-os)"
          tagline="Local AI with agency."
          body="Runs on your own hardware. Gemma 4 multimodal, 128K context, circadian-aware. No frontier-API dependency."
          buttonLabel="Launch →"
          to="/app"
        />
        <Tile
          title="NeuroKURO"
          gradient="var(--kg-gradient-neuro)"
          tagline="Phase reconstruction from sleep timing."
          body="Validated on SANDD (N=368 sessions, MAE 0.31h) and MMASH (N=20, MAE 0.29h). Paper under review at Journal of Sleep Research."
          buttonLabel="Read →"
          to="/neuro"
        />
        <Tile
          title="KUROPay"
          gradient="var(--kg-gradient-pay)"
          tagline="Card → local QR, anywhere in SEA."
          body="Scan VietQR, PromptPay, QRIS, QR Ph, DuitNow with your home card. No wallet. No top-up. First app on the Linux Foundation's x402 protocol."
          buttonLabel="Visit →"
          href="/pay"
        />
      </section>

      {/* ═══ FOOTER ═══ */}
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
              <a href="https://doi.org/10.5281/zenodo.18869320">Zenodo preprint</a>
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
          <div className="kg-footer-socials">
            <a href="https://x.com/kuroglass">x.com/kuroglass</a>
            <span>·</span>
            <a href="https://kuroglass.net">kuroglass.net</a>
          </div>
          <p className="kg-footer-copy">
            © 2026 KURO Technologies · ABN 45 340 322 909
          </p>
        </div>
      </footer>

      <HomeStyles />
    </div>
  );
}

/* ─── Tile component ─────────────────────────────────────────────── */
function Tile({ title, gradient, tagline, body, buttonLabel, to, href, external }) {
  const ButtonEl = external
    ? <a className="kg-tile-btn" href={href}>{buttonLabel}</a>
    : to ? <Link className="kg-tile-btn" to={to}>{buttonLabel}</Link>
         : <a className="kg-tile-btn" href={href}>{buttonLabel}</a>;
  return (
    <div className="kg-tile">
      <div className="kg-tile-accent" style={{ background: gradient }} />
      <h3 className="kg-tile-title">{title}</h3>
      <p className="kg-tile-tagline">{tagline}</p>
      <p className="kg-tile-body">{body}</p>
      <div className="kg-tile-button-row">{ButtonEl}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES per §3.2/§3.4
   ═══════════════════════════════════════════════════════════════════════════ */
function HomeStyles() {
  return (
    <style>{`
.kg-root {
  position: relative;
  z-index: 1;
  min-height: 100vh; min-height: 100dvh;
  color: var(--kg-text);
  font-family: var(--kg-font);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
/* DesktopBackground sits at z:0 fixed; content stacks above. */
.kg-root > :not(.desktop-bg) { position: relative; z-index: 1; }

/* ── Top nav ── */
.kg-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 32px;
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  background: rgba(0,0,0,0.4);
  border-bottom: 1px solid var(--kg-card-border);
}
.kg-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 600;
  letter-spacing: 3px; color: var(--kg-text);
}
.kg-brand-word { line-height: 1; }
.kg-nav-right { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.kg-nav-link {
  color: var(--kg-text-muted); text-decoration: none;
  transition: color 150ms;
}
.kg-nav-link:hover { color: var(--kg-text); }
.kg-nav-dot { color: var(--kg-text-dim); }

/* ── Hero ── */
.kg-hero {
  max-width: 960px; margin: 0 auto;
  padding: 96px 32px 48px;
  text-align: left;
}
.kg-hero-cube {
  margin: 0 0 36px;
  filter: drop-shadow(0 12px 40px rgba(168, 121, 255, 0.35));
}
.kg-hero-title {
  font-size: clamp(40px, 6.5vw, 64px);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.05;
  margin: 0 0 24px;
  color: var(--kg-text);
}
.kg-hero-line { display: block; }
.kg-hero-sub {
  font-size: clamp(17px, 1.8vw, 22px);
  font-weight: 300;
  color: var(--kg-text-muted);
  line-height: 1.5;
  max-width: 640px;
  margin: 0;
}

/* ── Tiles row ── */
.kg-tiles {
  max-width: 1200px; margin: 0 auto;
  padding: 48px 32px 96px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.kg-tile {
  background: var(--kg-card-surface);
  border: 1px solid var(--kg-card-border);
  border-radius: 16px;
  padding: 28px;
  display: flex; flex-direction: column; gap: 14px;
  transition: background 200ms, transform 200ms, border-color 200ms;
  min-height: 320px;
  position: relative;
  overflow: hidden;
}
.kg-tile:hover {
  background: var(--kg-card-hover);
  border-color: rgba(255,255,255,0.14);
  transform: translateY(-2px);
}
.kg-tile-accent {
  height: 4px; border-radius: 2px;
  margin: -8px -8px 0;
}
.kg-tile-title {
  font-size: 22px; font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kg-text);
  margin: 6px 0 0;
}
.kg-tile-tagline {
  font-size: 16px; font-weight: 500;
  color: var(--kg-text);
  margin: 0;
}
.kg-tile-body {
  font-size: 14px; font-weight: 300;
  color: var(--kg-text-muted);
  line-height: 1.55;
  margin: 0; flex: 1;
}
.kg-tile-button-row { margin-top: auto; }
.kg-tile-btn {
  display: inline-flex; align-items: center;
  padding: 10px 20px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  color: var(--kg-text);
  font-size: 14px; font-weight: 500;
  text-decoration: none;
  transition: background 150ms, border-color 150ms, transform 100ms;
  cursor: pointer;
}
.kg-tile-btn:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.2);
}
.kg-tile-btn:active { transform: scale(0.98); }

/* ── Footer ── */
.kg-footer {
  border-top: 1px solid var(--kg-card-border);
  padding: 64px 32px 48px;
}
.kg-footer-inner {
  max-width: 1200px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 24px;
}
.kg-footer-top { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.kg-footer-brand { display: flex; flex-direction: column; gap: 6px; }
.kg-footer-name { font-size: 15px; font-weight: 600; letter-spacing: 3px; color: var(--kg-text); }
.kg-footer-tag { font-size: 13px; color: var(--kg-text-muted); }
.kg-footer-rule { border: none; border-top: 1px solid var(--kg-card-border); margin: 8px 0; }
.kg-footer-cols {
  display: grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  gap: 24px;
}
.kg-footer-col { display: flex; flex-direction: column; gap: 10px; font-size: 13px; align-items: flex-start; }
.kg-footer-col a, .kg-footer-col span {
  color: var(--kg-text-muted);
  text-decoration: none;
  transition: color 150ms;
}
.kg-footer-col a:hover { color: var(--kg-text); }
.kg-footer-linkbtn {
  appearance: none; border: 0; padding: 0; margin: 0;
  background: transparent;
  color: var(--kg-text-muted);
  font: inherit; font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: color 150ms;
}
.kg-footer-linkbtn:hover { color: var(--kg-text); }
.kg-footer-col-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--kg-text-dim) !important;
  margin-bottom: 4px;
}
.kg-footer-muted { color: var(--kg-text-dim); font-style: italic; }
.kg-footer-meta {
  display: flex; gap: 20px; flex-wrap: wrap;
  font-size: 12px; color: var(--kg-text-muted);
}
.kg-footer-membership { color: var(--kg-teal); }
.kg-footer-docs { color: var(--kg-text-muted); text-decoration: none; }
.kg-footer-docs:hover { color: var(--kg-text); }
.kg-footer-socials {
  display: flex; gap: 10px;
  font-size: 12px; color: var(--kg-text-dim);
}
.kg-footer-socials a { color: var(--kg-text-muted); text-decoration: none; }
.kg-footer-socials a:hover { color: var(--kg-text); }
.kg-footer-copy {
  font-size: 12px; color: var(--kg-text-dim);
  margin: 0;
}

/* ─── Mobile ─── */
@media (max-width: 900px) {
  .kg-tiles { grid-template-columns: 1fr; }
  .kg-footer-cols { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 560px) {
  .kg-nav { padding: 16px 20px; }
  .kg-hero { padding: 56px 20px 32px; }
  .kg-tiles { padding: 32px 20px 64px; }
  .kg-footer { padding: 48px 20px 32px; }
  .kg-footer-cols { grid-template-columns: 1fr 1fr; gap: 20px; }
}
    `}</style>
  );
}
