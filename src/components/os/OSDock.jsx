/**
 * KURO OS — OSDock
 *
 * iPad/iPhone-style dock:
 *   - Pill-shaped glass bar, bottom-center
 *   - Cube "Start" button (existing 3D CSS cube)
 *   - Pinned app icons (up to 6)
 *   - Home indicator line when an app is fullscreen
 *   - Peek behavior: slides up when user touches near bottom while in app
 *   - Drag-to-reorder in edit mode (same interaction as HomeScreen)
 *   - Open indicator dots
 *   - Tier-gating badges
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOSStore } from '../../stores/osStore';
import { useAuthStore } from '../../stores/authStore';
import KuroIcon from '../KuroIcon';

const TIER_LABEL  = { pro: 'PRO', sovereign: 'SOV' };
const TIER_LEVEL  = { free: 0, pro: 1, sovereign: 2 };
const PEEK_ZONE   = 80;   // px from bottom that triggers peek
const PEEK_HIDE   = 3000; // ms before dock hides again after peek

// ── 3D Cube (Start button) ────────────────────────────────────────────────
function StartCube({ active }) {
  return (
    <div className={`osd-cube-scene${active ? ' osd-cube-active' : ''}`} aria-hidden="true">
      <div className="osd-cube">
        {['ft','bk','rt','lt','tp','bt'].map(f => (
          <div key={f} className={`osd-face osd-${f}`} />
        ))}
      </div>
    </div>
  );
}

// ── Dock icon ─────────────────────────────────────────────────────────────
function DockIcon({ app, isOpen, isLocked, onTap, editMode }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); }
  };

  return (
    <button
      className={`osd-icon${isOpen ? ' osd-open' : ''}${isLocked ? ' osd-locked' : ''}`}
      aria-label={`${app.name}${isLocked ? ' (locked)' : ''}${isOpen ? ' (open)' : ''}`}
      aria-pressed={isOpen}
      tabIndex={0}
      onClick={onTap}
      onKeyDown={handleKey}
      disabled={isLocked}
    >
      <span className="osd-icon-bg" aria-hidden="true">
        <KuroIcon name={app.id} size={22} color={isLocked ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)'} />
      </span>
      {isLocked && app.minTier !== 'free' && (
        <span className="osd-lock-badge" aria-hidden="true">
          {TIER_LABEL[app.minTier] || ''}
        </span>
      )}
      {isOpen && !isLocked && (
        <span className="osd-dot" aria-hidden="true" />
      )}
    </button>
  );
}

// ── Main Dock ─────────────────────────────────────────────────────────────
export default function OSDock() {
  const {
    apps, pinnedApps, openApps, visibleAppId, glassPanelOpen,
    openApp, closeApp, switchToApp, goHome,
    toggleGlassPanel, pinApp, unpinApp,
    editMode,
  } = useOSStore();
  const { user } = useAuthStore();

  const [peek, setPeek] = useState(false); // dock peek when in fullscreen app
  const peekTimer = useRef(null);

  const isInApp = !!visibleAppId;

  // Peek behavior: show dock briefly when cursor/finger near bottom
  useEffect(() => {
    if (!isInApp) { setPeek(false); return; }
    const handleMove = (e) => {
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      if (window.innerHeight - clientY <= PEEK_ZONE) {
        setPeek(true);
        clearTimeout(peekTimer.current);
        peekTimer.current = setTimeout(() => setPeek(false), PEEK_HIDE);
      }
    };
    window.addEventListener('mousemove', handleMove, { passive: true });
    window.addEventListener('touchmove', handleMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMove, { passive: true });
      window.removeEventListener('touchmove', handleMove, { passive: true });
      clearTimeout(peekTimer.current);
    };
  }, [isInApp]);

  // Resolve pinned apps
  const pinnedAppData = pinnedApps
    .map(id => apps.find(a => a.id === id))
    .filter(Boolean)
    .filter(app => app.id !== 'kuro.admin' || user?.isAdmin)
    .slice(0, 6);

  const getIsLocked = (app) => {
    if (!user) return true;
    return (TIER_LEVEL[user.tier] || 0) < (TIER_LEVEL[app.minTier] || 0);
  };

  const handleIconTap = useCallback((app) => {
    if (getIsLocked(app)) return;
    if (openApps.includes(app.id)) {
      if (visibleAppId === app.id) goHome();
      else switchToApp(app.id);
    } else {
      openApp(app.id);
    }
  }, [user, openApps, visibleAppId, openApp, switchToApp, goHome]);

  // Home indicator tap → go home
  const handleIndicatorTap = () => { if (isInApp) goHome(); };

  return (
    <div
      className={[
        'osd-outer',
        isInApp && !peek ? 'osd-hidden' : '',
        peek ? 'osd-peeking' : '',
      ].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label="Dock"
    >
      {/* Home indicator (iPhone-style line) — shown when app is open */}
      {isInApp && (
        <button
          className="osd-home-indicator"
          aria-label="Return to Home Screen"
          onClick={handleIndicatorTap}
        />
      )}

      <div className="osd-bar lg-frosted">
        {/* Cube: Start / launcher */}
        <button
          className={`osd-cube-btn${glassPanelOpen ? ' osd-cube-active' : ''}`}
          onClick={toggleGlassPanel}
          aria-label={glassPanelOpen ? 'Close launcher' : 'Open launcher'}
          aria-expanded={glassPanelOpen}
          tabIndex={0}
        >
          <StartCube active={glassPanelOpen} />
        </button>

        <div className="osd-sep" aria-hidden="true" />

        {/* Pinned icons */}
        {pinnedAppData.map(app => (
          <DockIcon
            key={app.id}
            app={app}
            isOpen={openApps.includes(app.id)}
            isLocked={getIsLocked(app)}
            onTap={() => handleIconTap(app)}
            editMode={editMode}
          />
        ))}
      </div>

      <style>{`
        /* ── Outer wrapper ──────────────────────────────────────────── */
        .osd-outer {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 200;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          transition: transform 200ms var(--lg-ease-standard, cubic-bezier(0.25,0.46,0.45,0.94)),
                      opacity   200ms var(--lg-ease-standard);
        }
        .osd-outer.osd-hidden {
          transform: translateX(-50%) translateY(calc(100% + 32px));
          opacity: 0;
          pointer-events: none;
        }
        .osd-outer.osd-peeking {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
          pointer-events: auto;
        }
        @media (prefers-reduced-motion: reduce) {
          .osd-outer, .osd-outer.osd-hidden { transition: none; }
        }

        /* ── Home indicator ─────────────────────────────────────────── */
        .osd-home-indicator {
          width: var(--kuro-os-indicator-w, 134px);
          height: var(--kuro-os-indicator-h, 5px);
          border-radius: 3px;
          background: rgba(255,255,255, var(--kuro-os-indicator-opacity, 0.3));
          border: none;
          cursor: pointer;
          transition: background 200ms, opacity 200ms;
          animation: osd-ind-fade 3s 2s forwards;
        }
        @keyframes osd-ind-fade {
          to { opacity: 0.15; }
        }
        .osd-home-indicator:hover { background: rgba(255,255,255,0.55); animation: none; }
        .osd-home-indicator:focus-visible {
          outline: 2px solid var(--lg-accent, #a855f7);
          outline-offset: 3px;
        }

        /* ── Bar ────────────────────────────────────────────────────── */
        .osd-bar {
          height: var(--kuro-os-dock-h, 56px);
          max-width: var(--kuro-os-dock-max-w, 420px);
          border-radius: var(--kuro-os-dock-radius, 28px) !important;
          display: flex;
          align-items: center;
          padding: 0 10px;
          gap: 4px;
        }

        /* ── Separator ──────────────────────────────────────────────── */
        .osd-sep {
          width: 1px;
          height: 24px;
          background: rgba(255,255,255,0.10);
          margin: 0 4px;
          flex-shrink: 0;
        }

        /* ── Cube button ────────────────────────────────────────────── */
        .osd-cube-btn {
          width: 44px; height: 44px;
          border: none; background: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          border-radius: 12px;
          transition: background 150ms;
        }
        .osd-cube-btn:hover { background: rgba(255,255,255,0.06); }
        .osd-cube-btn:focus-visible { outline: 2px solid var(--lg-accent, #a855f7); outline-offset: 2px; }

        /* ── 3D cube ────────────────────────────────────────────────── */
        .osd-cube-scene {
          width: 22px; height: 22px;
          perspective: 80px;
        }
        .osd-cube {
          width: 100%; height: 100%;
          transform-style: preserve-3d;
          animation: osd-cube-spin 8s linear infinite;
        }
        .osd-cube-scene.osd-cube-active .osd-cube {
          animation: osd-cube-spin-fast 1s linear infinite;
        }
        @keyframes osd-cube-spin      { from { transform: rotateX(-20deg) rotateY(0);     } to { transform: rotateX(-20deg) rotateY(360deg); } }
        @keyframes osd-cube-spin-fast { from { transform: rotateX(-20deg) rotateY(0);     } to { transform: rotateX(-20deg) rotateY(720deg); } }
        @media (prefers-reduced-motion: reduce) {
          .osd-cube { animation: none; transform: rotateX(-20deg) rotateY(-30deg); }
        }
        .osd-face {
          position: absolute;
          width: 22px; height: 22px;
          background: linear-gradient(135deg, rgba(168,85,247,0.35), rgba(91,33,182,0.25) 50%, rgba(49,10,101,0.45));
          border: 1px solid rgba(139,92,246,0.3);
          backdrop-filter: blur(2px);
        }
        .osd-ft { transform: translateZ(11px); }
        .osd-bk { transform: rotateY(180deg) translateZ(11px); }
        .osd-rt { transform: rotateY(90deg)  translateZ(11px); }
        .osd-lt { transform: rotateY(-90deg) translateZ(11px); }
        .osd-tp { transform: rotateX(90deg)  translateZ(11px); }
        .osd-bt { transform: rotateX(-90deg) translateZ(11px); }

        /* ── Dock icon ──────────────────────────────────────────────── */
        .osd-icon {
          position: relative;
          width: 44px; height: 44px; /* HIG 44pt touch target */
          border: none; background: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          border-radius: 12px;
          transition: transform 150ms cubic-bezier(0.34,1.5,0.64,1), background 150ms;
          -webkit-tap-highlight-color: transparent;
          outline: none;
        }
        .osd-icon:hover { transform: translateY(-7px) scale(1.12); }
        .osd-icon:active { transform: scale(0.9); }
        .osd-icon:focus-visible { outline: 2px solid var(--lg-accent, #a855f7); outline-offset: 2px; }
        .osd-icon.osd-locked { opacity: 0.4; cursor: default; }
        .osd-icon-bg { pointer-events: none; display: flex; align-items: center; justify-content: center; }

        /* ── Lock badge ─────────────────────────────────────────────── */
        .osd-lock-badge {
          position: absolute;
          bottom: 0; right: 0;
          font-size: 7px; font-weight: 700; letter-spacing: 0.4px;
          background: rgba(168,85,247,0.85);
          color: #fff;
          padding: 1px 3px;
          border-radius: 3px;
          pointer-events: none;
        }

        /* ── Open dot ───────────────────────────────────────────────── */
        .osd-dot {
          position: absolute;
          bottom: 1px; left: 50%;
          transform: translateX(-50%);
          width: 4px; height: 4px;
          border-radius: 50%;
          background: var(--lg-accent, #a855f7);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
