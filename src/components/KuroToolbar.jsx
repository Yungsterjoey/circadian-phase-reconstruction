/**
 * KuroToolbar — the single stationary nav used across every live KURO
 * surface: Home (/), Chat/OS (/app), Neuro (/neuro), Pay (/pay).
 *
 * Self-contained: the component injects its own <style> block so the look
 * is identical whether it mounts in the main SPA bundle, the /pay bundle,
 * or any future surface. It deliberately avoids the kuroglass-tokens.css
 * vars because those aren't loaded outside HomePage/NeuroPage.
 *
 * Surface detection uses window.location.pathname (not useLocation), so
 * it resolves correctly inside the /pay BrowserRouter basename context
 * where useLocation returns basename-stripped paths.
 *
 * Cross-bundle navigation: /app and /pay live in different bundles, so
 * every surface pill uses <a href> — full page navigation is the only
 * correct option when jumping between bundles.
 *
 * Props:
 *   showBack  — renders "← KURO" as an anchor to "/" instead of a plain span
 *   right     — ReactNode rendered left of the switcher (e.g. Docs · Sign in)
 */
import React, { useEffect, useRef, useState } from 'react';
import GlassCube from './ui/GlassCube';

const SURFACES = [
  {
    id: 'os',
    label: 'OS',
    href: '/app',
    tint: 'os',
    match: (p) => p === '/app' || p.startsWith('/app/'),
  },
  {
    id: 'neuro',
    label: 'Neuro',
    href: '/neuro',
    tint: 'neuro',
    match: (p) => p === '/neuro' || p.startsWith('/neuro/'),
  },
  {
    id: 'pay',
    label: 'Pay',
    href: '/pay',
    tint: 'pay',
    match: (p) => p === '/pay' || p.startsWith('/pay/'),
  },
];

function resolvePath() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

function currentSurfaceLabel(pathname) {
  const hit = SURFACES.find((s) => s.match(pathname));
  return hit ? hit.label : 'Surfaces';
}

function SurfaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [pathname, setPathname] = useState(resolvePath);
  const rootRef = useRef(null);

  useEffect(() => {
    const onPop = () => setPathname(resolvePath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = currentSurfaceLabel(pathname);

  return (
    <div className="kg-switcher" ref={rootRef}>
      <button
        type="button"
        className={`kg-switcher-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="kg-switcher-dot" aria-hidden />
        <span className="kg-switcher-label">{label}</span>
        <span className={`kg-switcher-chev${open ? ' is-open' : ''}`} aria-hidden>⌄</span>
      </button>

      <div className={`kg-switcher-panel${open ? ' is-open' : ''}`} role="menu">
        {SURFACES.map((s) => {
          const active = s.match(pathname);
          return (
            <a
              key={s.id}
              href={s.href}
              role="menuitem"
              className={`kg-switcher-pill kg-tint-${s.tint}${active ? ' is-active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="kg-switcher-pill-swatch" aria-hidden />
              <span className="kg-switcher-pill-label">{s.label}</span>
              {active && <span className="kg-switcher-pill-check" aria-hidden>●</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function KuroToolbar({ showBack = false, right = null }) {
  const brand = showBack ? (
    <a href="/" className="kg-brand kg-brand-back">
      <GlassCube size="nav" />
      <span className="kg-brand-word">← KURO</span>
    </a>
  ) : (
    <a href="/" className="kg-brand">
      <GlassCube size="nav" />
      <span className="kg-brand-word">KURO</span>
    </a>
  );

  return (
    <>
      <nav className="kg-nav">
        {brand}
        <div className="kg-nav-right">
          {right}
          <SurfaceSwitcher />
        </div>
      </nav>
      <KuroToolbarStyles />
    </>
  );
}

/* ─── Self-contained styles. Appended once per mount; duplicate <style>
   tags resolve to identical rules, so React's reconciler-driven remounts
   are harmless. ──────────────────────────────────────────────────────── */
function KuroToolbarStyles() {
  return (
    <style>{`
/* ── Stationary toolbar shell ─────────────────────────────────────── */
.kg-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9990;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px;
  min-height: 56px;
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
  background: linear-gradient(to bottom, rgba(0,0,0,0.65), rgba(0,0,0,0.38));
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  color: #fff;
  transition: background 240ms ease, border-color 240ms ease;
}
.kg-nav .kg-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 600;
  letter-spacing: 3px; color: #fff;
  text-decoration: none;
}
.kg-nav .kg-brand-word { line-height: 1; }
.kg-nav .kg-brand-back:hover { color: #A879FF; }
.kg-nav .kg-nav-right {
  display: flex; align-items: center; gap: 10px; font-size: 13px;
}
.kg-nav .kg-nav-link {
  color: rgba(255,255,255,0.6); text-decoration: none;
  transition: color 150ms;
}
.kg-nav .kg-nav-link:hover { color: #fff; }
.kg-nav .kg-nav-dot { color: rgba(255,255,255,0.3); }

/* ── Surfaces pill (trigger) ──────────────────────────────────────── */
.kg-switcher { position: relative; display: inline-flex; }

.kg-switcher-trigger {
  appearance: none; border: 0; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px 7px 12px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.14);
  color: #fff;
  font: inherit; font-size: 12.5px; font-weight: 500;
  letter-spacing: 0.3px;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.18) inset,
    0 -1px 0 rgba(0,0,0,0.35) inset,
    0 4px 14px rgba(0,0,0,0.28);
  transition:
    background 180ms ease, border-color 180ms ease,
    transform 180ms cubic-bezier(.2,.8,.2,1),
    box-shadow 180ms ease;
}
.kg-switcher-trigger:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05));
  border-color: rgba(255,255,255,0.22);
  transform: translateY(-1px);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.22) inset,
    0 -1px 0 rgba(0,0,0,0.4) inset,
    0 8px 20px rgba(0,0,0,0.35);
}
.kg-switcher-trigger:active {
  transform: translateY(1px);
  box-shadow:
    0 1px 2px rgba(0,0,0,0.5) inset,
    0 -1px 0 rgba(255,255,255,0.08) inset,
    0 2px 6px rgba(0,0,0,0.25);
}
.kg-switcher-trigger.is-open {
  background: linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06));
  border-color: rgba(168,121,255,0.40);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.22) inset,
    0 -1px 0 rgba(0,0,0,0.4) inset,
    0 0 0 3px rgba(168,121,255,0.14),
    0 8px 22px rgba(0,0,0,0.38);
}
.kg-switcher-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #00D9C5;
  box-shadow: 0 0 8px rgba(0,217,197,0.65);
  animation: kgSwitcherDotPulse 2.4s ease-in-out infinite;
}
.kg-switcher-label { line-height: 1; }
.kg-switcher-chev {
  display: inline-block;
  font-size: 11px; line-height: 1;
  color: rgba(255,255,255,0.6);
  transform: translateY(-1px) rotate(0deg);
  transition: transform 220ms cubic-bezier(.2,.8,.2,1), color 180ms ease;
}
.kg-switcher-chev.is-open {
  transform: translateY(-1px) rotate(180deg);
  color: #fff;
}

/* ── Dropdown panel ──────────────────────────────────────────────── */
.kg-switcher-panel {
  position: absolute;
  top: calc(100% + 10px); right: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px;
  min-width: 168px;
  border-radius: 14px;
  background: rgba(14,14,20,0.74);
  border: 1px solid rgba(255,255,255,0.10);
  backdrop-filter: blur(28px) saturate(1.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.08) inset,
    0 12px 32px rgba(0,0,0,0.58),
    0 2px 10px rgba(0,0,0,0.35);
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
  transform-origin: top right;
  pointer-events: none;
  transition: opacity 200ms ease,
              transform 240ms cubic-bezier(.2,.8,.2,1);
  z-index: 11;
}
.kg-switcher-panel.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

/* ── Depressable pill buttons ────────────────────────────────────── */
.kg-switcher-pill {
  appearance: none;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02));
  border: 1px solid rgba(255,255,255,0.12);
  color: #fff;
  font: inherit; font-size: 13px; font-weight: 500;
  letter-spacing: 0.2px;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.15) inset,
    0 -1px 0 rgba(0,0,0,0.45) inset,
    0 3px 8px -2px rgba(0,0,0,0.5),
    0 1px 2px rgba(0,0,0,0.3);
  transition:
    background 160ms ease, border-color 160ms ease,
    color 160ms ease,
    transform 120ms cubic-bezier(.2,.8,.2,1),
    box-shadow 160ms ease;
}
.kg-switcher-pill-swatch {
  width: 10px; height: 10px; border-radius: 50%;
  background: #888;
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.4) inset,
    0 1px 2px rgba(0,0,0,0.5),
    0 0 10px currentColor;
  opacity: 0.9;
  flex-shrink: 0;
}
.kg-switcher-pill-label { line-height: 1; flex: 1; }
.kg-switcher-pill-check {
  font-size: 8px; line-height: 1;
  color: currentColor;
  opacity: 0.85;
}

/* Per-surface tints — applied via .kg-tint-* */
.kg-switcher-pill.kg-tint-os   { --tint-a: #00D9C5; --tint-b: #00A5B8; }
.kg-switcher-pill.kg-tint-neuro{ --tint-a: #A879FF; --tint-b: #6C45E0; }
.kg-switcher-pill.kg-tint-pay  { --tint-a: #00D9C5; --tint-b: #A879FF; }

.kg-switcher-pill .kg-switcher-pill-swatch {
  background: linear-gradient(135deg, var(--tint-a, #888), var(--tint-b, #888));
  color: var(--tint-a, transparent); /* feeds the 0 0 10px currentColor glow */
}
.kg-switcher-pill:hover {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--tint-a, #fff) 18%, rgba(255,255,255,0.12)),
    color-mix(in srgb, var(--tint-b, #fff) 12%, rgba(255,255,255,0.04))
  );
  border-color: color-mix(in srgb, var(--tint-a, #fff) 45%, rgba(255,255,255,0.18));
  transform: translateY(-1px);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.22) inset,
    0 -1px 0 rgba(0,0,0,0.5) inset,
    0 6px 16px -3px color-mix(in srgb, var(--tint-a, #000) 35%, rgba(0,0,0,0.6)),
    0 2px 4px rgba(0,0,0,0.3);
}
.kg-switcher-pill:active,
.kg-switcher-pill.is-pressed {
  transform: translateY(1px);
  box-shadow:
    0 2px 3px rgba(0,0,0,0.55) inset,
    0 -1px 0 rgba(255,255,255,0.08) inset,
    0 1px 2px rgba(0,0,0,0.2);
}
.kg-switcher-pill.is-active {
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--tint-a, #888) 28%, rgba(255,255,255,0.06)),
    color-mix(in srgb, var(--tint-b, #888) 22%, rgba(255,255,255,0.02))
  );
  border-color: color-mix(in srgb, var(--tint-a, #888) 55%, rgba(255,255,255,0.18));
  color: #fff;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.25) inset,
    0 -1px 0 rgba(0,0,0,0.5) inset,
    0 0 0 2px color-mix(in srgb, var(--tint-a, #000) 25%, transparent),
    0 6px 16px -3px color-mix(in srgb, var(--tint-a, #000) 40%, rgba(0,0,0,0.55));
}

@keyframes kgSwitcherDotPulse {
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .kg-switcher-trigger,
  .kg-switcher-chev,
  .kg-switcher-panel,
  .kg-switcher-pill,
  .kg-switcher-dot { transition: none !important; animation: none !important; }
}

@media (max-width: 560px) {
  .kg-nav { padding: 12px 16px; }
  .kg-switcher-panel { min-width: 180px; }
}
    `}</style>
  );
}
