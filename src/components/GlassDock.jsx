/**
 * GlassDock v7.0.1
 * macOS-style dock — Apple HIG radii + Liquid Glass + magnification hover
 * Uses design system variables throughout
 */
import { useState, useCallback } from 'react';
import { useOSStore } from '../stores/osStore';
import { useAuthStore } from '../stores/authStore';
import KuroIcon from './KuroIcon';

export default function GlassDock() {
  const { apps, windows, pinnedApps, openApp, toggleGlassPanel, canAccessApp } = useOSStore();
  const { user } = useAuthStore();
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const tier = user?.tier || 'free';

  const dockApps = apps.filter(a => pinnedApps.includes(a.id));

  const getScale = useCallback((i) => {
    if (hoveredIdx < 0) return 1;
    const dist = Math.abs(hoveredIdx - i);
    if (dist === 0) return 1.35;
    if (dist === 1) return 1.15;
    if (dist === 2) return 1.05;
    return 1;
  }, [hoveredIdx]);

  const getTranslateY = useCallback((i) => {
    if (hoveredIdx < 0) return 0;
    const dist = Math.abs(hoveredIdx - i);
    if (dist === 0) return -8;
    if (dist === 1) return -4;
    if (dist === 2) return -1;
    return 0;
  }, [hoveredIdx]);

  return (
    <div className="gd-wrap">
      <div className="gd">
        {dockApps.map((app, i) => {
          const isOpen = windows[app.id]?.isOpen;
          const canAccess = canAccessApp(app.id, tier);
          const scale = getScale(i);
          const ty = getTranslateY(i);

          return (
            <button
              key={app.id}
              className={`gd-icon ${isOpen ? 'open' : ''} ${!canAccess ? 'locked' : ''}`}
              onClick={() => canAccess && openApp(app.id)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(-1)}
              style={{
                transform: `scale(${scale}) translateY(${ty}px)`,
                transition: 'transform .2s cubic-bezier(.175,.885,.32,1.275)',
              }}
              title={app.name}
            >
              <KuroIcon name={app.id} size={22} />
              {isOpen && <div className="gd-dot" />}
              {!canAccess && <div className="gd-lock-badge">PRO</div>}
            </button>
          );
        })}

        <div className="gd-sep" />

        <button className="gd-icon gd-launcher" onClick={toggleGlassPanel} title="Launchpad">
          <div className="gd-grid-icon">
            {[0,1,2,3,4,5,6,7,8].map(i => <div key={i} className="gd-grid-dot" />)}
          </div>
        </button>
      </div>

      <style>{`
.gd-wrap{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:var(--k-z-dock,800);pointer-events:none}
.gd{display:flex;align-items:flex-end;gap:4px;padding:6px 10px;background:var(--k-glass-bg,rgba(18,18,24,.72));backdrop-filter:blur(50px) saturate(1.6);-webkit-backdrop-filter:blur(50px) saturate(1.6);border:1px solid var(--k-glass-border,rgba(255,255,255,.07));border-radius:var(--k-radius-dock,22px);box-shadow:var(--k-shadow-dock,0 8px 32px rgba(0,0,0,.5));pointer-events:all;position:relative;overflow:visible}
.gd::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 30%,rgba(255,255,255,.06) 70%,transparent);border-radius:var(--k-radius-dock) var(--k-radius-dock) 0 0}
.gd-icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:var(--k-bg-surface,rgba(255,255,255,.04));border:none;border-radius:var(--k-radius-sm,12px);cursor:pointer;position:relative;transform-origin:bottom center}
.gd-icon:hover{background:var(--k-bg-surface-hover,rgba(255,255,255,.08))}
.gd-icon:active{transform:scale(.92)!important}
.gd-icon.locked{opacity:.35;cursor:not-allowed}
.gd-icon svg{color:rgba(255,255,255,0.78)}
.gd-dot{position:absolute;bottom:-4px;width:4px;height:4px;background:rgba(255,255,255,.5);border-radius:50%}
.gd-lock-badge{position:absolute;top:-2px;right:-2px;padding:1px 3px;font-size:7px;font-weight:700;background:rgba(168,85,247,.3);color:var(--k-accent,#a855f7);border-radius:4px;letter-spacing:.3px}
.gd-sep{width:1px;height:28px;background:var(--k-glass-border);margin:0 4px;flex-shrink:0;align-self:center}
.gd-launcher{background:transparent}
.gd-grid-icon{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;width:20px;height:20px}
.gd-grid-dot{width:4px;height:4px;background:rgba(255,255,255,.4);border-radius:50%;transition:background .15s}
.gd-launcher:hover .gd-grid-dot{background:rgba(255,255,255,.6)}
@media(max-width:768px){.gd-wrap{bottom:6px}.gd{padding:4px 8px;gap:2px}.gd-icon{width:40px;height:40px}}
      `}</style>
    </div>
  );
}
