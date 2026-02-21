/**
 * KURO OS v9.1 — Root Application
 * G1: "/" renders Desktop immediately. AuthGate is an OS window.
 *     Dock always visible. Locked apps greyed until auth.
 * G2: Legacy 3D cube in dock start button. Glass tokens aligned.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LiquidGlassProvider } from './components/LiquidGlassEngine';
import { useOSStore } from './stores/osStore';
import { useAuthStore } from './stores/authStore';
import { AuthModal, VerifyModal, UpgradeModal, AuthStyles } from './components/AuthModals';
import AuthGate from './components/AuthGate';
import CookieBanner from './components/CookieBanner';
import DesktopBackground from './components/DesktopBackground';
import KuroChatApp from './components/apps/KuroChatApp';
import AdminApp from './components/apps/AdminApp';
import AboutApp from './components/apps/AboutApp';
import KuroIcon from './components/KuroIcon';

const APP_COMPONENTS = {
  KuroChatApp: KuroChatApp,
  PaxSilicaApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Pax Silica — Coming Soon</div>,
  FileExplorerApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Files — Coming Soon</div>,
  BrowserApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Browser — Coming Soon</div>,
  VisionApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Vision — Coming Soon</div>,
  TerminalApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Terminal — Coming Soon</div>,
  LiveEditApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>LiveEdit — Coming Soon</div>,
  SettingsApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Settings — Coming Soon</div>,
  SandboxApp: () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'rgba(255,255,255,0.4)',fontSize:14}}>Sandbox — Coming Soon</div>,
  AdminApp: AdminApp,
  AboutApp: AboutApp,
};

const TIER_LEVEL = { free: 0, pro: 1, sovereign: 2 };
const TIER_LABEL = { pro: 'PRO', sovereign: 'SOV' };
const AUTH_WINDOW_ID = 'kuro.auth';

// ═══════════════════════════════════════════════════════════════════════════
// APP WINDOW — noClose hides the close button (used for AuthGate window)
// ═══════════════════════════════════════════════════════════════════════════
function AppWindow({ appId, children, noClose, title, icon }) {
  const win = useOSStore(s => s.windows[appId]);
  const app = useOSStore(s => s.apps.find(a => a.id === appId));
  const { closeApp, finalizeClose, minimizeApp, maximizeApp, focusWindow, updateWindowPosition, updateWindowSize } = useOSStore();
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const windowRef = useRef(null);

  const onDragStart = useCallback((e) => {
    if (win?.isMaximized) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const baseX = win?.x || 0;
    const baseY = win?.y || 0;
    dragRef.current = { startMouseX: clientX, startMouseY: clientY, baseX, baseY, lastX: baseX, lastY: baseY };
    focusWindow(appId);
    const el = windowRef.current;
    // Promote to compositor layer — no layout reflow during drag
    if (el) { el.style.willChange = 'transform'; el.style.transition = 'none'; }
    const onMove = (ev) => {
      ev.preventDefault();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - dragRef.current.startMouseX;
      const dy = cy - dragRef.current.startMouseY;
      dragRef.current.lastX = dragRef.current.baseX + dx;
      dragRef.current.lastY = dragRef.current.baseY + dy;
      if (el) el.style.transform = `translate3d(${dx}px,${dy}px,0)`;
    };
    const onEnd = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.documentElement.classList.remove('is-dragging');
      // Clear GPU hint + commit new absolute position
      if (el) { el.style.transform = ''; el.style.willChange = ''; el.style.transition = ''; }
      updateWindowPosition(appId, dragRef.current.lastX, dragRef.current.lastY);
    };
    document.documentElement.classList.add('is-dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, [appId, win, focusWindow, updateWindowPosition]);

  const onResizeStart = useCallback((e) => {
    if (win?.isMaximized) return;
    e.preventDefault(); e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    resizeRef.current = { startX: clientX, startY: clientY, startW: win?.width || 800, startH: win?.height || 600, lastW: win?.width || 800, lastH: win?.height || 600 };
    focusWindow(appId);
    const el = windowRef.current;
    const onMove = (ev) => {
      ev.preventDefault();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const nw = Math.max(280, resizeRef.current.startW + (cx - resizeRef.current.startX));
      const nh = Math.max(200, resizeRef.current.startH + (cy - resizeRef.current.startY));
      resizeRef.current.lastW = nw;
      resizeRef.current.lastH = nh;
      if (el) { el.style.width = nw + 'px'; el.style.height = nh + 'px'; }
    };
    const onEnd = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.documentElement.classList.remove('is-dragging');
      updateWindowSize(appId, resizeRef.current.lastW, resizeRef.current.lastH);
    };
    document.documentElement.classList.add('is-dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, [appId, win, focusWindow, updateWindowSize]);

  if (!win || !win.isOpen || win.isMinimized) return null;

  const isClosing = win.isClosing;

  const style = win.isMaximized
    ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: win.zIndex, borderRadius: 0 }
    : { position: 'absolute', top: win.y, left: win.x, width: win.width, height: win.height, zIndex: win.zIndex };

  // Block interaction during close animation
  if (isClosing) style.pointerEvents = 'none';

  const displayIcon = icon || app?.icon || '';
  const displayTitle = title || app?.name || appId;

  return (
    <div ref={windowRef} className={`app-window${win.isMaximized ? ' maximized' : ''}${isClosing ? ' closing' : ''}`} style={style} onMouseDown={() => !isClosing && focusWindow(appId)} onTouchStart={() => !isClosing && focusWindow(appId)} onAnimationEnd={(e) => { if (isClosing && e.animationName === 'winClose') finalizeClose(appId); }}>
      <div className="window-titlebar" onMouseDown={onDragStart} onTouchStart={onDragStart}>
        <div className="traffic-lights">
          {!noClose && <button className="tl tl-close" onClick={(e) => { e.stopPropagation(); closeApp(appId); }} aria-label="Close" />}
          {noClose && <div className="tl tl-close-disabled" />}
          <button className="tl tl-min" onClick={(e) => { e.stopPropagation(); minimizeApp(appId); }} aria-label="Minimize" />
          <button className="tl tl-max" onClick={(e) => { e.stopPropagation(); maximizeApp(appId); }} aria-label="Maximize" />
        </div>
        <span className="window-title"><KuroIcon name={appId} size={14} color="rgba(255,255,255,0.6)" style={{verticalAlign:'middle',marginRight:6}} />{displayTitle}</span>
        <div className="titlebar-spacer" />
      </div>
      <div className="window-content">{children}</div>
      {!win.isMaximized && <div className="resize-handle" onMouseDown={onResizeStart} onTouchStart={onResizeStart} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCK BADGE
// ═══════════════════════════════════════════════════════════════════════════
function LockBadge({ minTier }) {
  return <span className="lock-badge" data-tier={minTier}>🔒{TIER_LABEL[minTier] || ''}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3D CUBE (ported from legacy KURO_COMPLETE GlassDock.jsx)
// ═══════════════════════════════════════════════════════════════════════════
function StartCube({ active }) {
  return (
    <div className={`start-cube-wrap ${active ? 'active' : ''}`}>
      <div className="start-cube">
        <div className="cube-face front" />
        <div className="cube-face back" />
        <div className="cube-face left" />
        <div className="cube-face right" />
        <div className="cube-face top" />
        <div className="cube-face bottom" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GLASS DOCK — Always visible. Locked-state aware.
// ═══════════════════════════════════════════════════════════════════════════
function GlassDock({ isLocked, onLockedAppClick }) {
  const [dockHidden, setDockHidden] = useState(false);
  const { pinnedApps, apps, windows, openApp, focusWindow, restoreApp, toggleGlassPanel, glassPanelOpen } = useOSStore();
  const { user } = useAuthStore();
  const userTier = user?.tier || 'free';
  const isAdmin = user?.isAdmin;
  const pinnedAppData = apps.filter(a => pinnedApps.includes(a.id)).filter(a => a.id !== 'kuro.admin' || isAdmin);

  const handleClick = (app) => {
    // When locked (no user), all apps redirect to AuthGate window
    if (isLocked) {
      onLockedAppClick();
      return;
    }
    const hasAccess = (TIER_LEVEL[userTier] || 0) >= (TIER_LEVEL[app.minTier] || 0);
    if (!hasAccess) {
      return; // tier-gated — already shown as locked
    }
    const win = windows[app.id];
    if (win?.isOpen) { if (win.isMinimized) restoreApp(app.id); else focusWindow(app.id); }
    else openApp(app.id);
  };

  // Show AuthGate icon in dock when locked and AuthGate is minimized
  const authWin = windows[AUTH_WINDOW_ID];
  const showAuthInDock = isLocked && authWin?.isOpen && authWin?.isMinimized;

  if (dockHidden) {
    return (
      <button className="dock-reveal-tab" onClick={() => setDockHidden(false)} aria-label="Show Dock">
        <span className="dock-reveal-chevron">▴</span>
      </button>
    );
  }

  return (
    <div className="dock-outer">
      <button className="dock-hide-btn" onClick={() => setDockHidden(true)} aria-label="Hide Dock">
        <span className="dock-hide-chevron">▾</span>
      </button>
      <div className="glass-dock">
        <button className="dock-cube" onClick={toggleGlassPanel}>
          <StartCube active={glassPanelOpen} />
        </button>
        <div className="dock-sep" />
        {pinnedAppData.map(app => {
          const locked = isLocked || ((TIER_LEVEL[userTier] || 0) < (TIER_LEVEL[app.minTier] || 0));
          return (
            <button key={app.id} className={`dock-item ${windows[app.id]?.isOpen ? 'open' : ''} ${locked ? 'locked' : ''}`}
              onClick={() => handleClick(app)} title={app.name}>
              <span className="dock-icon"><KuroIcon name={app.id} size={22} color="rgba(255,255,255,0.85)" /></span>
              {locked && !isLocked && <LockBadge minTier={app.minTier} />}
              {locked && isLocked && <span className="lock-badge" style={{background:'rgba(255,255,255,0.15)'}}>🔒</span>}
              {windows[app.id]?.isOpen && !locked && <div className="dock-indicator" />}
            </button>
          );
        })}
        {showAuthInDock && (
          <>
            <div className="dock-sep" />
            <button className="dock-item" onClick={() => { focusWindow(AUTH_WINDOW_ID); restoreApp(AUTH_WINDOW_ID); }} title="Sign In">
              <span className="dock-icon"><KuroIcon name="kuro.auth" size={22} color="rgba(255,255,255,0.85)" /></span>
              <div className="dock-indicator" />
            </button>
          </>
        )}
        <div className="dock-sep" />
        {user ? (
          <button className="dock-user" onClick={() => useAuthStore.getState().logout()} title={`${user.name || user.email} · ${user.tier}`}>
            <span className="dock-user-tier" data-tier={user.tier}>{user.tier[0].toUpperCase()}</span>
          </button>
        ) : (
          <button className="dock-user" onClick={onLockedAppClick} title="Sign in">
            <span className="dock-user-anon">→</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GLASS PANEL (App Launcher) — locked-state aware
// ═══════════════════════════════════════════════════════════════════════════
function GlassPanel({ isLocked, onLockedAppClick }) {
  const { apps, openApp, glassPanelOpen } = useOSStore();
  const { user } = useAuthStore();
  const userTier = user?.tier || 'free';
  const isAdmin = user?.isAdmin;

  if (!glassPanelOpen) return null;

  const handleClick = (app) => {
    if (isLocked) { onLockedAppClick(); return; }
    const hasAccess = (TIER_LEVEL[userTier] || 0) >= (TIER_LEVEL[app.minTier] || 0);
    if (!hasAccess) return;
    openApp(app.id);
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">KURO OS</div>
      <div className="panel-grid">
        {apps.filter(a => a.id !== 'kuro.admin' || isAdmin).map(app => {
          const locked = isLocked || ((TIER_LEVEL[userTier] || 0) < (TIER_LEVEL[app.minTier] || 0));
          return (
            <button key={app.id} className={`panel-app ${locked ? 'locked' : ''}`} onClick={() => handleClick(app)}>
              <span className="panel-icon"><KuroIcon name={app.id} size={28} color="rgba(255,255,255,0.85)" /></span>
              <span className="panel-label">{app.name}</span>
              {locked && !isLocked && <LockBadge minTier={app.minTier} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP — Desktop always rendered. AuthGate is an OS window.
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const { windows, apps, openApp, focusWindow, restoreApp } = useOSStore();
  const { init, loading, user } = useAuthStore();

  const isLocked = !user && !loading;

  useEffect(() => { init(); }, []);

  // Auto-open AuthGate window when locked
  useEffect(() => {
    if (isLocked && !windows[AUTH_WINDOW_ID]?.isOpen) {
      // Open auth window centered — auto-maximize on mobile
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw < 768;
      const w = isMobile ? vw : Math.min(420, vw - 32);
      const h = isMobile ? vh : Math.min(580, vh - 80);
      const x = isMobile ? 0 : Math.max(16, (vw - w) / 2);
      const y = isMobile ? 0 : Math.max(16, (vh - h) / 2);
      useOSStore.setState(s => ({
        windows: {
          ...s.windows,
          [AUTH_WINDOW_ID]: { isOpen: true, isMinimized: false, isMaximized: isMobile, x, y, width: w, height: h, zIndex: s.nextZIndex, ...(isMobile ? { _prevX: x, _prevY: y, _prevW: w, _prevH: h } : {}) }
        },
        windowOrder: [...s.windowOrder.filter(id => id !== AUTH_WINDOW_ID), AUTH_WINDOW_ID],
        nextZIndex: s.nextZIndex + 1,
      }));
    }
  }, [isLocked]);

  // Close AuthGate window when user authenticates
  useEffect(() => {
    if (user && windows[AUTH_WINDOW_ID]?.isOpen) {
      useOSStore.getState().closeApp(AUTH_WINDOW_ID);
    }
  }, [user]);

  // Auto-open KuroChat after auth
  useEffect(() => {
    if (user && !windows['kuro.chat']?.isOpen) {
      openApp('kuro.chat');
    }
  }, [user]);

  // Post-upgrade redirect check
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      useAuthStore.getState().refreshUser?.();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Focus/restore AuthGate window (used by locked dock clicks)
  const focusAuthWindow = useCallback(() => {
    const authWin = useOSStore.getState().windows[AUTH_WINDOW_ID];
    if (authWin?.isOpen) {
      if (authWin.isMinimized) restoreApp(AUTH_WINDOW_ID);
      else focusWindow(AUTH_WINDOW_ID);
    }
  }, [focusWindow, restoreApp]);

  return (
    <LiquidGlassProvider defaultTheme="dark">
      <div className="kuro-desktop">
        <DesktopBackground />
        <CookieBanner />

        {/* AuthGate as OS window — no close button, minimize+maximize allowed */}
        {isLocked && windows[AUTH_WINDOW_ID]?.isOpen && (
          <AppWindow appId={AUTH_WINDOW_ID} noClose title="KURO .OS" icon="🔐">
            <AuthGate />
          </AppWindow>
        )}

        {/* App windows — only render when authenticated */}
        {user && Object.entries(windows).map(([appId, win]) => {
          if (appId === AUTH_WINDOW_ID) return null;
          if (!win.isOpen) return null;
          const app = apps.find(a => a.id === appId);
          if (!app) return null;
          const Component = APP_COMPONENTS[app.component];
          if (!Component) return null;
          return (
            <AppWindow key={appId} appId={appId}>
              <Component />
            </AppWindow>
          );
        })}

        <GlassPanel isLocked={isLocked} onLockedAppClick={focusAuthWindow} />
        <GlassDock isLocked={isLocked} onLockedAppClick={focusAuthWindow} />

        <AuthModal />
        <VerifyModal />
        <UpgradeModal />
        <AuthStyles />

        <style>{`
.kuro-desktop {
  width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; position: fixed; inset: 0;
  background: var(--lg-surface-0, #000); color: var(--lg-text-primary, #fff);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}
/* macOS HIG window animations — fast, subtle, no bounce */
@keyframes winOpen {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes winClose {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.94); }
}
@keyframes winMinimize {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to   { opacity: 0; transform: scale(0.72) translateY(52px); }
}
@keyframes dockBounce {
  0%   { transform: translateY(0); }
  22%  { transform: translateY(-12px); }
  44%  { transform: translateY(0); }
  60%  { transform: translateY(-6px); }
  76%  { transform: translateY(0); }
  88%  { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}

.app-window {
  border-radius: var(--lg-radius-xl, 28px); overflow: hidden; display: flex; flex-direction: column;
  background: var(--lg-surface-1, rgba(18,18,22,0.85));
  backdrop-filter: blur(var(--lg-blur-standard, 40px)) saturate(var(--lg-saturate, 1.6));
  -webkit-backdrop-filter: blur(var(--lg-blur-standard, 40px)) saturate(var(--lg-saturate, 1.6));
  border: 1px solid var(--lg-glass-border, rgba(255,255,255,0.08));
  box-shadow:
    0 0 0 0.5px rgba(255,255,255,0.06),
    0 4px 16px rgba(0,0,0,0.4),
    0 24px 60px rgba(0,0,0,0.45),
    inset 0 1px 0 rgba(255,255,255,0.10);
  animation: winOpen 0.2s cubic-bezier(0.2, 0, 0, 1) both;
  will-change: transform, opacity;
}
.app-window.closing {
  animation: winClose 0.18s cubic-bezier(0.4, 0, 1, 1) both;
}
.window-titlebar {
  height: 42px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; padding: 0 12px;
  /* Liquid glass: diagonal specular sweep + heavy top catch-light */
  background:
    linear-gradient(180deg,
      rgba(255,255,255,0.09) 0%,
      rgba(255,255,255,0.03) 60%,
      rgba(255,255,255,0.01) 100%),
    linear-gradient(105deg,
      rgba(255,255,255,0.06) 0%,
      transparent 55%,
      rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(60px) saturate(2.2) brightness(1.05); -webkit-backdrop-filter: blur(60px) saturate(2.2) brightness(1.05);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  box-shadow:
    inset 0 1.5px 0 rgba(255,255,255,0.20),   /* top catch-light */
    inset 0 -1px 0 rgba(0,0,0,0.12),            /* bottom depth shadow */
    inset 1px 0 0 rgba(255,255,255,0.04),        /* left edge refraction */
    inset -1px 0 0 rgba(255,255,255,0.04);       /* right edge refraction */
  position: relative; cursor: grab; user-select: none; flex-shrink: 0;
  -webkit-user-select: none; -webkit-touch-callout: none;
}
/* Noise grain layer — prevents plastic/flat look */
.window-titlebar::before {
  content: '';
  position: absolute; inset: 0; border-radius: inherit;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23g)' opacity='0.05'/%3E%3C/svg%3E");
  background-size: 160px 160px;
  opacity: 0.6; pointer-events: none; mix-blend-mode: overlay;
}
.window-titlebar:active { cursor: grabbing; }
.window-titlebar { touch-action: none; }
.resize-handle { touch-action: none; }
.traffic-lights { display: flex; gap: 7px; align-items: center; }
.titlebar-spacer { min-width: 55px; }
.tl {
  width: 13px; height: 13px; border-radius: 50%; border: none; cursor: pointer;
  transition: opacity 0.15s, transform 0.1s; opacity: 0.8;
}
.tl:hover { opacity: 1; transform: scale(1.15); }
.tl:active { transform: scale(0.9); }
.tl-close { background: #ff5f57; }
.tl-close-disabled { width: 13px; height: 13px; border-radius: 50%; background: rgba(255,255,255,0.08); }
.tl-min { background: #ffbd2e; }
.tl-max { background: #28c840; }
.window-title { font-size: 13px; color: var(--lg-text-secondary, rgba(255,255,255,0.7)); flex: 1; text-align: center; }
.window-content { flex: 1; overflow: hidden; position: relative; display: flex; flex-direction: column; }
.resize-handle {
  position: absolute; bottom: 0; right: 0; width: 28px; height: 28px; cursor: nwse-resize; z-index: 10;
  background: transparent;
}
.resize-handle::after {
  content: ''; position: absolute; bottom: 3px; right: 3px;
  width: 14px; height: 14px;
  border-right: 2.5px solid rgba(255,255,255,0.2);
  border-bottom: 2.5px solid rgba(255,255,255,0.2);
  border-radius: 0 0 10px 0;
  transition: border-color 0.15s, opacity 0.15s;
}
.resize-handle:hover::after { border-color: rgba(168,85,247,0.55); border-width: 2.5px; }
.resize-handle:active::after { border-color: rgba(168,85,247,0.8); border-width: 2.5px; }

/* ═══ DOCK ═══ */
.dock-outer {
  position: fixed;
  bottom: max(12px, env(safe-area-inset-bottom, 12px));
  left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; z-index: 9999;
}
.dock-hide-btn {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-bottom: none; border-radius: 8px 8px 0 0;
  padding: 4px 40px 3px; cursor: pointer; color: rgba(255,255,255,0.2);
  line-height: 1; transition: color 0.2s, background 0.2s;
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
}
.dock-hide-btn:hover { color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.07); }
.dock-hide-btn:active { color: rgba(255,255,255,0.85); }
.dock-hide-chevron, .dock-reveal-chevron {
  display: inline-block; width: 7px; height: 7px;
  border-left: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  border-radius: 0.5px; font-size: 0; vertical-align: middle;
}
.dock-hide-chevron { transform: rotate(-45deg); margin-top: -2px; }
.dock-reveal-chevron { transform: rotate(135deg); margin-top: 1px; }
.dock-reveal-tab {
  position: fixed; bottom: env(safe-area-inset-bottom, 0px); left: 50%; transform: translateX(-50%);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
  border-bottom: none; border-radius: 10px 10px 0 0;
  padding: 6px 44px 4px; cursor: pointer; color: rgba(255,255,255,0.3);
  z-index: 9999; transition: color 0.2s, background 0.2s;
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
  animation: dockReveal 0.3s cubic-bezier(0.34,1.4,0.64,1) both;
}
.dock-reveal-tab:hover { background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.65); }
.dock-reveal-tab:active { color: rgba(255,255,255,0.9); }
@keyframes dockReveal {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.glass-dock {
  display: flex; align-items: center; gap: 2px; padding: 6px 10px;
  touch-action: manipulation; position: relative;
  background: rgba(28,28,32,0.55);
  backdrop-filter: blur(40px) saturate(1.6); -webkit-backdrop-filter: blur(40px) saturate(1.6);
  border-radius: var(--lg-radius-lg, 22px); border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10);
}
.glass-dock::before {
  content: ''; position: absolute; inset: -0.5px; border-radius: calc(var(--lg-radius-lg, 22px) + 0.5px);
  background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 55%);
  pointer-events: none; z-index: -1;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude; -webkit-mask-composite: xor; padding: 0.5px;
}
.dock-cube {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; transition: transform 0.2s;
}
.dock-cube:hover { transform: scale(1.1); }
.dock-cube:active { transform: scale(0.95); }

/* ═══ 3D CUBE — ported from legacy KURO_COMPLETE GlassDock.jsx ═══ */
.start-cube-wrap {
  width: 22px; height: 22px; perspective: 600px;
}
.start-cube-wrap.active .start-cube { animation: cubeSpinFast 1s ease-in-out; }
.start-cube {
  width: 22px; height: 22px; position: relative; transform-style: preserve-3d;
  animation: cubeSpin 8s linear infinite;
}
.cube-face {
  position: absolute; width: 22px; height: 22px;
  background: linear-gradient(135deg, rgba(168,85,247,0.35), rgba(91,33,182,0.25) 50%, rgba(49,10,101,0.45));
  border: 1px solid rgba(139,92,246,0.3);
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
}
.cube-face.front  { transform: translateZ(11px); }
.cube-face.back   { transform: rotateY(180deg) translateZ(11px); }
.cube-face.left   { transform: rotateY(-90deg) translateZ(11px); }
.cube-face.right  { transform: rotateY(90deg) translateZ(11px); }
.cube-face.top    { transform: rotateX(90deg) translateZ(11px); }
.cube-face.bottom { transform: rotateX(-90deg) translateZ(11px); }
@keyframes cubeSpin { from { transform: rotateX(-20deg) rotateY(0deg); } to { transform: rotateX(-20deg) rotateY(360deg); } }
@keyframes cubeSpinFast { from { transform: rotateX(-20deg) rotateY(0deg); } to { transform: rotateX(-20deg) rotateY(720deg); } }


.dock-sep { width: 1px; height: 20px; background: rgba(255,255,255,0.08); margin: 0 4px; }
.dock-item {
  width: 44px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; border-radius: var(--lg-radius-sm, 12px); position: relative;
  transition: transform 0.22s cubic-bezier(0.34,1.5,0.64,1), background 0.15s;
}
.dock-item:hover { transform: translateY(-7px) scale(1.12); background: rgba(255,255,255,0.06); }
.dock-item:active { transform: translateY(-2px) scale(1.03); transition-duration: 0.08s; }
.dock-item.open .dock-icon { animation: dockBounce 0.55s cubic-bezier(0.34,1.5,0.64,1); }
.dock-item.locked { opacity: 0.45; cursor: default; }
.dock-item.locked:hover { opacity: 0.55; transform: translateY(-2px); }
.dock-icon { font-size: 24px; }
.dock-indicator { position: absolute; bottom: -2px; width: 4px; height: 4px; border-radius: 50%; background: var(--lg-accent, #a855f7); }
.lock-badge {
  position: absolute; top: -4px; right: -4px; font-size: 8px; line-height: 1;
  padding: 1px 3px; border-radius: 4px; background: rgba(239,68,68,0.8); color: #fff; font-weight: 600; pointer-events: none;
}
.lock-badge[data-tier="pro"] { background: rgba(59,130,246,0.8); }
.lock-badge[data-tier="sovereign"] { background: linear-gradient(135deg,#9333ea,#6366f1); }
.dock-user {
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04); cursor: pointer; transition: all 0.15s;
}
.dock-user:hover { background: rgba(255,255,255,0.08); }
.dock-user-tier { font-size: 13px; font-weight: 700; color: var(--lg-accent, #a855f7); }
.dock-user-tier[data-tier="pro"] { color: #3b82f6; }
.dock-user-tier[data-tier="sovereign"] { color: #d946ef; }
.dock-user-anon { font-size: 14px; color: rgba(255,255,255,0.4); }

/* ═══ PANEL ═══ */
.glass-panel {
  position: fixed; bottom: 88px; left: 50%; transform: translateX(-50%);
  width: 380px; padding: 20px;
  background: rgba(20,20,24,0.85);
  backdrop-filter: blur(50px) saturate(1.6); -webkit-backdrop-filter: blur(50px) saturate(1.6);
  border-radius: var(--lg-radius-xl, 28px); border: 1px solid var(--lg-glass-border, rgba(255,255,255,0.1)); z-index: 9998;
  box-shadow: 0 12px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10);
}
.panel-header { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.5); letter-spacing: 2px; text-align: center; margin-bottom: 16px; }
.panel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.panel-app {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer; padding: 12px 4px; border-radius: var(--lg-radius-sm, 12px);
  transition: background 0.15s; color: #fff; position: relative;
}
.panel-app:hover { background: rgba(255,255,255,0.08); }
.panel-app.locked { opacity: 0.4; }
.panel-icon { font-size: 28px; }
.panel-label { font-size: 10px; color: rgba(255,255,255,0.7); }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
/* ═══ REDUCED MOTION ═══ */
@media (prefers-reduced-motion: reduce) {
  .app-window { animation: none !important; }
  .dock-item { transition: background 0.15s !important; }
  .dock-item:hover { transform: none !important; }
  .dock-item:active { transform: none !important; }
  .dock-item.open .dock-icon { animation: none !important; }
  .glass-dock { transition: none !important; }
  .glass-panel { transition: none !important; }
  .dock-cube:hover { transform: none !important; }
  .dock-cube:active { transform: none !important; }
  .dock-reveal-tab { animation: none !important; }
}

/* ═══ TABLET (iPad portrait & landscape) ═══ */
@media (max-width: 1024px) {
  .app-window { border-radius: var(--lg-radius-xl, 28px); }
  .window-titlebar { height: 40px; padding: 0 10px; }
  .tl { width: 12px; height: 12px; }
  .window-title { font-size: 12px; }
  .dock-outer { bottom: max(18px, calc(env(safe-area-inset-bottom) + 10px)); }
  .glass-dock { padding: 5px 10px; gap: 3px; }
  .dock-cube, .dock-item { width: 42px; height: 42px; }
  .dock-icon { font-size: 22px; }
  .glass-panel { width: 360px; bottom: 86px; padding: 18px; }
  .panel-icon { font-size: 26px; }
  .panel-label { font-size: 10px; }
}

/* ═══ PHONE (iPhone / small tablets) ═══ */
@media (max-width: 768px) {
  .app-window { border-radius: var(--lg-radius-xl, 28px); }
  .window-titlebar { height: 38px; padding: 0 8px; }
  .tl { width: 11px; height: 11px; }
  .tl-close-disabled { width: 11px; height: 11px; }
  .traffic-lights { gap: 6px; }
  .window-title { font-size: 12px; }
  .titlebar-spacer { min-width: 42px; }
  .dock-outer { bottom: max(16px, calc(env(safe-area-inset-bottom) + 8px)); }
  .glass-dock { padding: 4px 8px; gap: 2px; border-radius: var(--lg-radius-md, 16px); }
  .dock-cube, .dock-item { width: 38px; height: 38px; }
  .dock-icon { font-size: 20px; }
  .dock-sep { height: 22px; margin: 0 2px; }
  .dock-user { width: 30px; height: 30px; }
  .dock-user-tier { font-size: 11px; }
  .start-cube-wrap { width: 18px; height: 18px; }
  .start-cube { width: 18px; height: 18px; }
  .cube-face { width: 18px; height: 18px; }
  .cube-face.front  { transform: translateZ(9px); }
  .cube-face.back   { transform: rotateY(180deg) translateZ(9px); }
  .cube-face.left   { transform: rotateY(-90deg) translateZ(9px); }
  .cube-face.right  { transform: rotateY(90deg) translateZ(9px); }
  .cube-face.top    { transform: rotateX(90deg) translateZ(9px); }
  .cube-face.bottom { transform: rotateX(-90deg) translateZ(9px); }
  .glass-panel { width: calc(100vw - 24px); bottom: 76px; padding: 16px; }
  .panel-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .panel-app { padding: 10px 4px; gap: 5px; }
  .panel-icon { font-size: 24px; }
  .panel-label { font-size: 9px; }
  .panel-header { font-size: 12px; margin-bottom: 12px; }
}

/* ═══ MOBILE PERFORMANCE — reduce GPU load ═══ */
@media (max-width: 768px) {
  /* Halve all hardcoded blur values */
  .window-titlebar {
    backdrop-filter: blur(20px) saturate(1.4) brightness(1.02) !important;
    -webkit-backdrop-filter: blur(20px) saturate(1.4) brightness(1.02) !important;
  }
  .glass-dock {
    backdrop-filter: blur(14px) saturate(1.3) !important;
    -webkit-backdrop-filter: blur(14px) saturate(1.3) !important;
  }
  .glass-panel {
    backdrop-filter: blur(18px) saturate(1.3) !important;
    -webkit-backdrop-filter: blur(18px) saturate(1.3) !important;
  }
  .dock-chevron-btn, .dock-hide-btn {
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
  }
  /* Skip window open animation on phone — already fullscreen */
  .app-window { animation: none !important; }
  /* Kill dock hover bounce — it's a scrolling cost on touch */
  .dock-item { transition: background 0.1s !important; }
  .dock-item:hover { transform: none !important; }
  .dock-cube:hover { transform: none !important; }
  .dock-cube:active { transform: scale(0.95) !important; }
}

/* ═══ MAXIMIZED WINDOW — notch / Dynamic Island safe areas ═══ */
@media (max-width: 768px) {
  .app-window.maximized .window-titlebar {
    height: calc(38px + env(safe-area-inset-top, 0px));
    padding-top: calc(4px + env(safe-area-inset-top, 0px));
    padding-left: max(12px, env(safe-area-inset-left, 0px));
    padding-right: max(12px, env(safe-area-inset-right, 0px));
  }
  .app-window.maximized .window-content {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}

/* ═══ SMALL PHONE (iPhone SE / Mini) ═══ */
@media (max-width: 430px) {
  .app-window { border-radius: var(--lg-radius-xl, 28px); }
  .dock-outer { bottom: max(14px, calc(env(safe-area-inset-bottom) + 6px)); }
  .glass-dock { padding: 3px 6px; gap: 1px; border-radius: var(--lg-radius-sm, 12px); }
  .dock-cube, .dock-item { width: 34px; height: 34px; }
  .dock-icon { font-size: 18px; }
  .dock-sep { height: 20px; }
  .dock-user { width: 28px; height: 28px; }
  .dock-user-tier { font-size: 10px; }
  .start-cube-wrap { width: 16px; height: 16px; }
  .start-cube { width: 16px; height: 16px; }
  .cube-face { width: 16px; height: 16px; }
  .cube-face.front  { transform: translateZ(8px); }
  .cube-face.back   { transform: rotateY(180deg) translateZ(8px); }
  .cube-face.left   { transform: rotateY(-90deg) translateZ(8px); }
  .cube-face.right  { transform: rotateY(90deg) translateZ(8px); }
  .cube-face.top    { transform: rotateX(90deg) translateZ(8px); }
  .cube-face.bottom { transform: rotateX(-90deg) translateZ(8px); }
  .glass-panel { width: calc(100vw - 16px); bottom: 70px; padding: 14px; }
  .panel-grid { grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .panel-app { padding: 8px 2px; }
  .panel-icon { font-size: 22px; }
}
        `}</style>
      </div>
    </LiquidGlassProvider>
  );
}
