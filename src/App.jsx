/**
 * KURO OS — Desktop Shell
 *
 * iOS-style OS compositor:
 *   - HomeScreen when no app visible (scales down during app launch)
 *   - Fullscreen apps with transform-based launch animation (GPU-composited)
 *   - OSDock always present (dock on home, home indicator in-app)
 *   - StatusBar always on top
 */
import React, { Component, Suspense, lazy, useEffect, useRef } from 'react';
import { useOSStore } from './stores/osStore';
import { useAuthStore } from './stores/authStore';
import { PHYSICS } from './lib/gestureEngine';
import HomeScreen from './components/os/HomeScreen';
import OSDock from './components/os/OSDock';
import StatusBar from './components/os/StatusBar';
import ContextMenu from './components/os/ContextMenu';
import CookieBanner from './components/CookieBanner';
import DesktopBackground from './components/DesktopBackground';

// ─── Lazy-loaded app components ──────────────────────────────────────────────
const APP_COMPONENTS = {
  AuthGateApp:     lazy(() => import('./components/apps/AuthGateApp')),
  KuroChatApp:     lazy(() => import('./components/apps/KuroChatApp')),
  FileExplorerApp: lazy(() => import('./components/apps/FileExplorerApp')),
  AboutApp:        lazy(() => import('./components/apps/AboutApp')),
  AdminApp:        lazy(() => import('./components/apps/AdminApp')),
  GitPatchApp:     lazy(() => import('./components/apps/GitPatchApp')),
  SandboxApp:      lazy(() => import('./components/apps/SandboxPanel')),
  PhoneApp:        lazy(() => import('./components/apps/PhoneApp')),
  MessagesApp:     lazy(() => import('./components/apps/MessagesApp')),
  WagerApp:        lazy(() => import('./components/apps/WagerApp')),
  KuroPayApp:      lazy(() => import('./components/apps/KuroPayApp')),
};

// ─── Loading spinner ─────────────────────────────────────────────────────────
function AppLoading() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: '#000',
    }}>
      <div style={{
        width: 24, height: 24, border: '2px solid rgba(168,85,247,0.3)',
        borderTop: '2px solid #a855f7', borderRadius: '50%',
        animation: 'kuro-spin 0.8s linear infinite',
      }} />
    </div>
  );
}

// ─── Error Boundary ──────────────────────────────────────────────────────────
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(error, info) { console.error('[KURO] Render error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', padding: 32,
        }}>
          <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: 4, color: 'rgba(255,255,255,0.9)', marginBottom: 16 }}>KURO</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, marginBottom: 24 }}>Something went wrong.</div>
            <button onClick={() => window.location.reload()} style={{ padding: '10px 28px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── OS Shell ────────────────────────────────────────────────────────────────
export default function App() {
  const { apps, openApps, visibleAppId, contextMenu, openApp, closeApp, appTransition, clearTransition } = useOSStore();
  const { user } = useAuthStore();
  const booted = useRef(false);
  const prevUser = useRef(user);
  const appRefs = useRef({});

  // Lock viewport for OS shell
  useEffect(() => {
    document.documentElement.classList.add('kuro-shell');
    return () => document.documentElement.classList.remove('kuro-shell');
  }, []);

  // Auto-open on first boot: guests get AuthGate, authed users get Chat
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      const t = setTimeout(() => {
        if (user) openApp('kuro.chat');
        else openApp('kuro.auth');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [user, openApp]);

  // Auth transition: when user changes from null → object, close AuthGate + open Chat
  useEffect(() => {
    if (!prevUser.current && user) {
      const t = setTimeout(() => {
        if (openApps.includes('kuro.auth')) closeApp('kuro.auth');
        openApp('kuro.chat');
      }, 150);
      return () => clearTimeout(t);
    }
    prevUser.current = user;
  }, [user, openApp, closeApp, openApps]);

  // ── Transform-based launch animation (GPU-composited) ─────────────────
  useEffect(() => {
    if (!appTransition) return;
    const { appId, fromRect, phase } = appTransition;
    const el = appRefs.current[appId];
    if (!el || !fromRect) {
      clearTransition();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const iconCX = (fromRect.left + fromRect.right) / 2;
    const iconCY = (fromRect.top + fromRect.bottom) / 2;
    const iconW = fromRect.right - fromRect.left;
    const startScale = Math.max(iconW / vw, iconW / vh);

    if (phase === 'launching') {
      // Step 1: position at icon (no transition) — all GPU-composited properties
      el.style.transition = 'none';
      el.style.transformOrigin = `${iconCX}px ${iconCY}px`;
      el.style.transform = `scale(${startScale})`;
      el.style.borderRadius = `${PHYSICS.ICON_RADIUS}px`;
      el.style.opacity = '0.6';
      el.style.overflow = 'hidden';
      el.style.zIndex = '10';
      el.style.pointerEvents = 'auto';

      // Step 2: animate to fullscreen (double-rAF ensures browser commits initial state)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.34s cubic-bezier(0.2,0.9,0.3,1), opacity 0.18s ease-out, border-radius 0.34s cubic-bezier(0.2,0.9,0.3,1)';
          el.style.transform = 'scale(1)';
          el.style.opacity = '1';
          el.style.borderRadius = '0px';
        });
      });

      // Step 3: cleanup — hand control back to React declarative styles
      const cleanup = setTimeout(() => {
        if (el) {
          el.style.transition = '';
          el.style.transformOrigin = '';
          el.style.transform = '';
          el.style.borderRadius = '';
          el.style.opacity = '';
          el.style.overflow = '';
          el.style.zIndex = '';
          el.style.pointerEvents = '';
        }
        clearTransition();
      }, 380);
      return () => clearTimeout(cleanup);
    }

    if (phase === 'closing') {
      el.style.transition = 'transform 0.3s cubic-bezier(0.4,0,1,1), opacity 0.25s ease-in, border-radius 0.3s';
      el.style.transformOrigin = `${iconCX}px ${iconCY}px`;
      el.style.transform = `scale(${startScale})`;
      el.style.borderRadius = `${PHYSICS.ICON_RADIUS}px`;
      el.style.opacity = '0';
      el.style.overflow = 'hidden';

      const cleanup = setTimeout(() => {
        if (el) {
          el.style.transition = '';
          el.style.transformOrigin = '';
          el.style.transform = '';
          el.style.borderRadius = '';
          el.style.opacity = '';
          el.style.overflow = '';
        }
        clearTransition();
      }, 320);
      return () => clearTimeout(cleanup);
    }
  }, [appTransition, clearTransition]);

  const isLaunching = appTransition?.phase === 'launching';
  // Show home screen when: no app visible, OR during launch animation (for depth effect)
  const showHS = !visibleAppId || isLaunching;

  return (
    <AppErrorBoundary>
      <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
        <DesktopBackground />

        {/* Home Screen */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          display: showHS ? 'flex' : 'none',
          flexDirection: 'column',
          // Only opacity + transform — both GPU-composited. No filter.
          opacity: isLaunching ? 0.5 : 1,
          transform: isLaunching ? 'scale(0.92)' : 'scale(1)',
          transition: isLaunching
            ? 'transform 0.34s cubic-bezier(0.2,0.9,0.3,1), opacity 0.25s'
            : 'transform 0.3s cubic-bezier(0.2,0.9,0.3,1), opacity 0.2s',
          pointerEvents: visibleAppId ? 'none' : 'auto',
        }}>
          <HomeScreen />
        </div>

        {/* Fullscreen apps: mounted when open, visible when active */}
        {openApps.map(appId => {
          const app = apps.find(a => a.id === appId);
          if (!app) return null;
          const Comp = APP_COMPONENTS[app.component];
          const isVisible = visibleAppId === appId;
          const isTransitioning = appTransition?.appId === appId;

          return (
            <div
              key={appId}
              ref={el => { if (el) appRefs.current[appId] = el; }}
              data-app-id={appId}
              data-app-visible={isVisible ? 'true' : undefined}
              style={{
                position: 'absolute', inset: 0,
                zIndex: isVisible ? 10 : 1,
                display: 'flex', flexDirection: 'column',
                height: '100%', width: '100%',
                ...(isTransitioning ? {} : {
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? 'scale(1)' : 'scale(0.92)',
                  transition: 'opacity 0.25s cubic-bezier(0.2,0.9,0.3,1), transform 0.25s cubic-bezier(0.2,0.9,0.3,1)',
                  pointerEvents: isVisible ? 'auto' : 'none',
                }),
              }}
            >
              {Comp && (
                <Suspense fallback={<AppLoading />}>
                  <Comp />
                </Suspense>
              )}
            </div>
          );
        })}

        <StatusBar />
        <OSDock />
        {contextMenu && <ContextMenu />}
        <CookieBanner />
      </div>
    </AppErrorBoundary>
  );
}
