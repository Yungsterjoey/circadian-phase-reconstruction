/**
 * WindowManager v7.0.1
 * Draggable, resizable glass windows — Apple HIG chrome + Liquid Glass
 * Consistent design system variables. Smooth spring animations.
 */
import { useRef, useCallback, useState, lazy, Suspense } from 'react';
import { useOSStore } from '../stores/osStore';

// Lazy-load app components
const KuroChatApp = lazy(() => import('./apps/KuroChatApp'));

const APP_COMPONENTS = {
  KuroChatApp,
};

const LoadingFallback = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: 'rgba(255,255,255,.3)', fontSize: 13,
    gap: 8,
  }}>
    <div className="wm-spinner" />
    Loading…
  </div>
);

function AppWindow({ appId, app, win }) {
  const { closeApp, minimizeApp, maximizeApp, focusWindow, updateWindowPosition } = useOSStore();
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);

  const onDragStart = useCallback((e) => {
    if (win.isMaximized) return;
    e.preventDefault();
    focusWindow(appId);
    const startX = (e.touches ? e.touches[0].clientX : e.clientX) - win.x;
    const startY = (e.touches ? e.touches[0].clientY : e.clientY) - win.y;
    setDragging(true);

    const onMove = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      updateWindowPosition(appId, cx - startX, cy - startY);
    };
    const onEnd = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }, [appId, win, focusWindow, updateWindowPosition]);

  if (win.isMinimized) return null;

  const AppComponent = APP_COMPONENTS[app.component];
  const isMax = win.isMaximized;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div
      className={`aw ${isMax ? 'maximized' : ''} ${dragging ? 'dragging' : ''} ${focused ? 'focused' : ''}`}
      style={{
        position: 'absolute',
        left: isMax ? 0 : win.x,
        top: isMax ? 32 : win.y,
        width: isMax ? '100%' : win.width,
        height: isMax ? 'calc(100% - 32px)' : win.height,
        zIndex: win.zIndex,
      }}
      onMouseDown={() => { focusWindow(appId); setFocused(true); }}
      onBlur={() => setFocused(false)}
    >
      {/* Title Bar */}
      <div className="aw-titlebar"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onDoubleClick={() => maximizeApp(appId)}>
        <div className="aw-traffic">
          <button className="aw-btn aw-close" onClick={(e) => { e.stopPropagation(); closeApp(appId); }}
            title="Close" />
          <button className="aw-btn aw-minimize" onClick={(e) => { e.stopPropagation(); minimizeApp(appId); }}
            title="Minimize" />
          <button className="aw-btn aw-maximize" onClick={(e) => { e.stopPropagation(); maximizeApp(appId); }}
            title={isMax ? 'Restore' : 'Maximize'} />
        </div>
        <span className="aw-title">{app.name}</span>
        <div className="aw-spacer" />
      </div>

      {/* Content */}
      <div className="aw-content">
        {AppComponent ? (
          <Suspense fallback={<LoadingFallback />}>
            <AppComponent />
          </Suspense>
        ) : (
          <div className="aw-placeholder">
            <span className="aw-placeholder-icon">{app.icon}</span>
            <span className="aw-placeholder-name">{app.name}</span>
            <span className="aw-placeholder-soon">Coming Soon</span>
          </div>
        )}
      </div>

      <style>{`
.aw{background:var(--k-glass-bg-thick,rgba(18,18,24,.88));backdrop-filter:blur(var(--k-glass-blur-heavy,60px)) saturate(1.6);-webkit-backdrop-filter:blur(var(--k-glass-blur-heavy,60px)) saturate(1.6);border:1px solid var(--k-glass-border,rgba(255,255,255,.07));border-radius:var(--k-radius-window,14px);overflow:hidden;box-shadow:var(--k-shadow-window);display:flex;flex-direction:column;transition:box-shadow .2s,border-color .2s;animation:awAppear .25s var(--k-ease-spring,cubic-bezier(.175,.885,.32,1.275)) both}
@keyframes awAppear{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
.aw.maximized{border-radius:0;border:none}
.aw.dragging{cursor:grabbing;box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 0 .5px rgba(255,255,255,.08)}
.aw.focused{border-color:rgba(255,255,255,.1)}
.aw::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06) 30%,rgba(255,255,255,.06) 70%,transparent);border-radius:var(--k-radius-window) var(--k-radius-window) 0 0;pointer-events:none;z-index:1}

.aw-titlebar{display:flex;align-items:center;gap:12px;height:38px;padding:0 14px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(255,255,255,.04);cursor:grab;flex-shrink:0;user-select:none;-webkit-user-select:none}
.aw-traffic{display:flex;gap:8px}
.aw-btn{width:12px;height:12px;border-radius:50%;border:none;cursor:pointer;transition:filter .15s,transform .1s;position:relative}
.aw-btn::after{content:'';position:absolute;inset:-4px;border-radius:50%}
.aw-close{background:#ff5f57}
.aw-minimize{background:#febc2e}
.aw-maximize{background:#28c840}
.aw-btn:hover{filter:brightness(1.2);transform:scale(1.15)}
.aw-btn:active{transform:scale(.9)}
.aw-title{flex:1;text-align:center;font-size:12px;font-weight:500;color:rgba(255,255,255,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aw-spacer{width:56px}
.aw-content{flex:1;overflow:hidden;position:relative}

.aw-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--k-text-tertiary)}
.aw-placeholder-icon{font-size:48px}
.aw-placeholder-name{font-size:16px;font-weight:600;color:var(--k-text-secondary)}
.aw-placeholder-soon{font-size:12px;padding:4px 12px;background:var(--k-bg-surface);border:1px solid var(--k-glass-border);border-radius:var(--k-radius-pill);color:var(--k-text-quaternary)}

.wm-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.1);border-top-color:rgba(255,255,255,.4);border-radius:50%;animation:k-spin .8s linear infinite}

@media(max-width:768px){
  .aw{border-radius:0!important}
  .aw-titlebar{height:34px;padding:0 10px}
  .aw-spacer{width:40px}
}
      `}</style>
    </div>
  );
}

export default function WindowManager() {
  const { apps, windows, windowOrder } = useOSStore();

  return (
    <div className="wm" style={{ position: 'absolute', inset: '32px 0 0 0', zIndex: 10 }}>
      {windowOrder.map(appId => {
        const win = windows[appId];
        const app = apps.find(a => a.id === appId);
        if (!win?.isOpen || !app) return null;
        return <AppWindow key={appId} appId={appId} app={app} win={win} />;
      })}
    </div>
  );
}
