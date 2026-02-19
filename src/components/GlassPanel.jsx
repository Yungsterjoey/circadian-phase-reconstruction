/**
 * GlassPanel v7.0.1
 * Full-screen app launcher / launchpad — Apple HIG + Liquid Glass
 * Uses design system variables throughout
 */
import { useOSStore } from '../stores/osStore';
import { useAuthStore } from '../stores/authStore';

export default function GlassPanel() {
  const { apps, openApp, toggleGlassPanel, canAccessApp } = useOSStore();
  const { user } = useAuthStore();
  const tier = user?.tier || 'free';

  return (
    <div className="gp-backdrop" onClick={toggleGlassPanel}>
      <div className="gp" onClick={e => e.stopPropagation()}>
        <h2 className="gp-title">Apps</h2>
        <div className="gp-grid">
          {apps.map(app => {
            const canAccess = canAccessApp(app.id, tier);
            return (
              <button key={app.id}
                className={`gp-app ${!canAccess ? 'locked' : ''}`}
                onClick={() => { if (canAccess) { openApp(app.id); toggleGlassPanel(); } }}>
                <div className="gp-icon">{app.icon}</div>
                <span className="gp-name">{app.name}</span>
                {!canAccess && <span className="gp-lock">PRO</span>}
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
.gp-backdrop{position:fixed;inset:0;z-index:var(--k-z-panel,850);background:rgba(0,0,0,.5);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;animation:k-fadeIn .25s ease}
.gp{width:100%;max-width:480px;margin:16px;padding:32px 24px;background:var(--k-glass-bg-thick,rgba(18,18,24,.88));backdrop-filter:blur(var(--k-glass-blur-heavy,60px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--k-glass-blur-heavy,60px)) saturate(1.6);border:1px solid var(--k-glass-border,rgba(255,255,255,.07));border-radius:var(--k-radius-xl,28px);box-shadow:var(--k-shadow-xl);animation:k-scaleIn .3s var(--k-ease-spring) both;position:relative;overflow:hidden}
.gp::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 30%,rgba(255,255,255,.06) 70%,transparent)}
.gp-title{font-size:18px;font-weight:600;color:rgba(255,255,255,.9);margin:0 0 24px;text-align:center;letter-spacing:1px}
.gp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.gp-app{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:none;border:none;border-radius:var(--k-radius-md,16px);cursor:pointer;transition:all .15s;position:relative;font-family:inherit}
.gp-app:hover{background:var(--k-bg-surface,rgba(255,255,255,.04))}
.gp-app:active{transform:scale(.92)}
.gp-app.locked{opacity:.4;cursor:not-allowed}
.gp-icon{width:52px;height:52px;display:flex;align-items:center;justify-content:center;background:var(--k-bg-surface);border:1px solid rgba(255,255,255,.06);border-radius:var(--k-radius-window,14px);font-size:24px;transition:all .15s}
.gp-app:hover .gp-icon{background:var(--k-bg-surface-hover);border-color:rgba(255,255,255,.1)}
.gp-name{font-size:11px;color:rgba(255,255,255,.6);text-align:center}
.gp-lock{position:absolute;top:8px;right:4px;padding:2px 5px;background:rgba(168,85,247,.2);border-radius:4px;font-size:9px;font-weight:600;color:var(--k-accent,#a855f7)}
@media(max-width:480px){.gp-grid{grid-template-columns:repeat(3,1fr)}.gp{margin:8px;padding:24px 16px;border-radius:var(--k-radius-lg,22px)}}
      `}</style>
    </div>
  );
}
