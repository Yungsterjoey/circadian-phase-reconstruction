/**
 * KURO OS — Public Homepage ("/")
 * Conceptual glass + editorial. No pricing, no demo, no interactive elements beyond "Sign in."
 * 2 sections + footer. Architectural glass planes, museum-placard metadata.
 */
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import DesktopBackground from '../components/DesktopBackground';
import CookieBanner from '../components/CookieBanner';

/* ─── Scroll-triggered fade-in ─────────────────────────────────────────── */
function useScrollReveal(ref) {
  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll('.hp-reveal');
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('hp-visible'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function HomePage() {
  const s2Ref = useRef(null);
  useScrollReveal(s2Ref);

  const scrollToAbout = (e) => {
    e.preventDefault();
    document.getElementById('hp-about')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="hp-root">
      <DesktopBackground />
      <CookieBanner />

      {/* ═══ SECTION 1: HERO ═══ */}
      <section className="hp-hero">
        <div className="hp-hero-glass">
          <h1 className="hp-title">KURO OS</h1>
          <p className="hp-build">Build 0.9.x</p>
          <p className="hp-lead">
            Sovereign intelligence infrastructure.<br />
            Your hardware. Your data. Your audit trail.
          </p>
          <div className="hp-ctas">
            <Link to="/login" className="hp-btn-primary">Sign in</Link>
            <button className="hp-btn-secondary" onClick={scrollToAbout}>Learn more ↓</button>
          </div>
        </div>
        <div className="hp-placard">
          <span>kuroglass.net</span>
        </div>
        <div className="hp-auth-line">AUTHORIZED ACCESS ONLY</div>
      </section>

      {/* ═══ SECTION 2: WHAT IS KURO ═══ */}
      <section id="hp-about" className="hp-about" ref={s2Ref}>
        <div className="hp-about-inner">
          <span className="hp-section-label hp-reveal">WHAT IS KURO</span>

          <div className="hp-card hp-reveal" style={{ animationDelay: '60ms' }}>
            <p>
              A desktop operating system for AI inference. 12-layer cognitive pipeline.
              Dedicated GPU hardware. Cryptographic audit trail on every interaction.
            </p>
          </div>

          <div className="hp-compare hp-reveal" style={{ animationDelay: '120ms' }}>
            <div className="hp-compare-col">
              <span className="hp-compare-label hp-compare-them-label">CLOUD LLMS</span>
              <ul>
                <li>Your data trains their models</li>
                <li>Rate limits imposed</li>
                <li>No audit trail</li>
                <li>Conversations on shared servers</li>
              </ul>
            </div>
            <div className="hp-compare-divider" />
            <div className="hp-compare-col">
              <span className="hp-compare-label hp-compare-us-label">KURO OS</span>
              <ul>
                <li>Dedicated GPU inference</li>
                <li>No rate limits on your hardware</li>
                <li>Ed25519 signed audit chain</li>
                <li>Data never used for training</li>
              </ul>
            </div>
          </div>

          <div className="hp-card hp-reveal" style={{ animationDelay: '180ms' }}>
            <span className="hp-card-label">SECURITY</span>
            <p>
              Ed25519 signatures. TLS 1.3. Isolated GPU infrastructure.
              90-day retention. Australian Privacy Act compliant.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="hp-footer hp-reveal">
        <div className="hp-footer-inner">
          <div className="hp-footer-brand">
            <span className="hp-footer-name">KURO OS</span>
            <span className="hp-footer-entity">
              Henry George Lowe trading as KURO Technologies<br />
              ABN 45 340 322 909 · Melbourne, Victoria
            </span>
          </div>
          <div className="hp-footer-links">
            <Link to="/login?doc=terms">Terms</Link>
            <span>·</span>
            <Link to="/login?doc=privacy">Privacy</Link>
            <span>·</span>
            <Link to="/login?doc=terms">Acceptable Use</Link>
          </div>
          <p className="hp-footer-infra">
            Built in Melbourne. Running on dedicated GPU hardware in the United States.
          </p>
          <p className="hp-footer-contact">hi@kuroglass.net</p>
        </div>
      </footer>

      <HomeStyles />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES — Conceptual glass, editorial, macOS-restraint motion
   ═══════════════════════════════════════════════════════════════════════════ */
function HomeStyles() {
  return (
    <style>{`
/* ─── Root ─────────────────────────────────────────────────────────────── */
.hp-root {
  width: 100%; min-height: 100vh; min-height: 100dvh;
  overflow-y: auto; overflow-x: hidden;
  color: rgba(255,255,255,0.92);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  position: relative;
}

/* ─── Scroll reveal ───────────────────────────────────────────────────── */
.hp-reveal {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 500ms cubic-bezier(0.22, 0.68, 0, 1), transform 500ms cubic-bezier(0.22, 0.68, 0, 1);
}
.hp-visible {
  opacity: 1;
  transform: translateY(0);
}

/* ═══ HERO ═══════════════════════════════════════════════════════════════ */
.hp-hero {
  min-height: 100vh; min-height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 48px 24px;
  position: relative;
}

.hp-hero-glass {
  max-width: 580px; width: 100%;
  padding: 56px 48px;
  background: var(--kuro-hero-bg);
  border: 1px solid var(--kuro-hero-border);
  border-radius: 20px;
  backdrop-filter: blur(var(--kuro-hero-blur)) saturate(1.4) brightness(1.02);
  -webkit-backdrop-filter: blur(var(--kuro-hero-blur)) saturate(1.4) brightness(1.02);
  box-shadow:
    0 1px 3px 0 rgba(0,0,0,0.3),
    0 8px 24px -4px rgba(0,0,0,0.2),
    inset 0 0.5px 0 0 var(--kuro-hero-highlight);
  text-align: center;
  animation: hp-materialize 600ms cubic-bezier(0.22, 0.68, 0, 1) both;
}
@keyframes hp-materialize {
  from { opacity: 0; transform: scale(0.97) translateY(6px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.hp-title {
  font-size: clamp(42px, 6vw, 64px);
  font-weight: 300;
  letter-spacing: 6px;
  color: rgba(255,255,255,0.95);
  margin: 0 0 12px;
  line-height: 1;
}

.hp-build {
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.25);
  letter-spacing: 0.5px;
  margin: 0 0 24px;
}

.hp-lead {
  font-size: clamp(15px, 2vw, 18px);
  font-weight: 300;
  color: rgba(255,255,255,0.58);
  line-height: 1.6;
  margin: 0 0 32px;
}

.hp-ctas {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}

.hp-btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 36px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 9999px;
  color: rgba(255,255,255,0.88);
  font-size: 14px; font-weight: 500;
  text-decoration: none;
  transition: background 200ms, border-color 200ms, color 200ms, transform 150ms;
  cursor: pointer;
  min-width: 160px;
}
.hp-btn-primary:hover {
  background: rgba(255,255,255,0.14);
  border-color: rgba(255,255,255,0.18);
  color: #fff;
  transform: translateY(-1px);
}
.hp-btn-primary:active { transform: scale(0.985); }

.hp-btn-secondary {
  background: none; border: none;
  color: rgba(255,255,255,0.32);
  font-size: 13px; font-family: inherit;
  cursor: pointer;
  transition: color 200ms;
}
.hp-btn-secondary:hover { color: rgba(255,255,255,0.55); }

.hp-placard {
  position: absolute; bottom: 32px; left: 32px;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px;
  color: var(--kuro-placard-color);
  letter-spacing: 0.5px;
}
.hp-auth-line {
  position: absolute; bottom: 32px; right: 32px;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 2px;
  color: var(--kuro-auth-line-color);
  text-transform: uppercase;
}

/* ═══ ABOUT SECTION ═════════════════════════════════════════════════════ */
.hp-about {
  min-height: 80vh;
  display: flex; align-items: center; justify-content: center;
  padding: 96px 24px;
}

.hp-about-inner {
  max-width: 620px; width: 100%;
  display: flex; flex-direction: column; gap: 24px;
}

.hp-section-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 2.5px;
  color: rgba(255,255,255,0.28);
  text-transform: uppercase;
}

.hp-card {
  padding: 24px;
  background: var(--kuro-slab-bg);
  border: 1px solid var(--kuro-slab-border);
  border-radius: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.hp-card p {
  font-size: 15px; font-weight: 300;
  color: rgba(255,255,255,0.62);
  line-height: 1.7;
  margin: 0;
}
.hp-card-label {
  display: block;
  font-size: 10px; font-weight: 600;
  letter-spacing: 2px;
  color: rgba(255,255,255,0.25);
  margin-bottom: 10px;
}

/* Compare — split column + hairline */
.hp-compare {
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 0;
  backdrop-filter: none; -webkit-backdrop-filter: none;
}
.hp-compare-col {
  padding: 20px 24px;
}
.hp-compare-divider {
  width: 1px;
  background: rgba(255,255,255,0.06);
  align-self: stretch;
}
.hp-compare-label {
  display: block;
  font-size: 10px; font-weight: 700;
  letter-spacing: 2px;
  margin-bottom: 12px;
  text-transform: uppercase;
}
.hp-compare-them-label { color: rgba(255,100,100,0.45); }
.hp-compare-us-label { color: rgba(120,144,156,0.7); }
.hp-compare-col ul {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.hp-compare-col ul li {
  font-size: 13px; font-weight: 300;
  color: rgba(255,255,255,0.38);
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.hp-compare-col ul li:last-child { border-bottom: none; padding-bottom: 0; }
.hp-compare-col:last-child ul li { color: rgba(255,255,255,0.62); }

/* ═══ FOOTER ════════════════════════════════════════════════════════════ */
.hp-footer {
  padding: 64px 24px 48px;
  border-top: 1px solid rgba(255,255,255,0.04);
}
.hp-footer-inner {
  max-width: 620px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 16px;
}
.hp-footer-brand {
  display: flex; flex-direction: column; gap: 6px;
}
.hp-footer-name {
  font-size: 13px; font-weight: 600;
  letter-spacing: 2px; color: rgba(255,255,255,0.4);
}
.hp-footer-entity {
  font-size: 12px; color: rgba(255,255,255,0.2);
  line-height: 1.6;
}
.hp-footer-links {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px;
}
.hp-footer-links a {
  color: rgba(255,255,255,0.3);
  text-decoration: none;
  transition: color 150ms;
}
.hp-footer-links a:hover { color: rgba(255,255,255,0.55); }
.hp-footer-links span { color: rgba(255,255,255,0.12); }
.hp-footer-infra {
  font-size: 12px; color: rgba(255,255,255,0.16);
  margin: 0; line-height: 1.5;
}
.hp-footer-contact {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 11px; color: rgba(255,255,255,0.2);
  margin: 0;
}

/* ─── MOBILE ────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .hp-hero-glass { padding: 40px 24px; border-radius: 16px; }
  .hp-hero { padding: 32px 16px; }
  .hp-about { padding: 64px 16px; }
  .hp-compare { grid-template-columns: 1fr; }
  .hp-compare-divider { width: auto; height: 1px; align-self: auto; }
  .hp-placard { bottom: 20px; left: 20px; }
  .hp-auth-line { bottom: 20px; right: 20px; }
  .hp-footer { padding: 48px 16px 32px; }
}

/* ─── REDUCED MOTION ────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .hp-hero-glass { animation: none !important; }
  .hp-reveal { transition: none !important; opacity: 1 !important; transform: none !important; }
}
    `}</style>
  );
}
