import { create } from 'zustand';

// ═══════════════════════════════════════════════════════════════════════════
// KURO OS — APP & REALM REGISTRY
//
// Naming convention (locked 2026-04-16):
//   • KURO[App]   — discrete apps (KUROChat, KUROPay, KUROSound, ...)
//                   Display in OS UI WITHOUT the prefix → "Chat", "Pay"
//   • [Realm]KURO — architectural families (NeuroKURO, FluxKURO, ShadowKURO)
//                   Modules live beneath a realm, not as standalone apps
//
// Internal `id` keeps the legacy `kuro.<name>` form so user localStorage
// (kuro_app_order, kuro_pinned_apps) doesn't reset on rename.
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_APPS = [
  { id: 'kuro.auth',     canonical: 'KUROAuth',     displayName: 'Sign In',     realm: null,         icon: 'kuro.auth',     component: 'AuthGateApp',     defaultWidth: 440, defaultHeight: 620, minTier: 'guest',     locked: false },
  { id: 'kuro.chat',     canonical: 'KUROChat',     displayName: 'Chat',        realm: null,         icon: 'kuro.chat',     component: 'KuroChatApp',     defaultWidth: 800, defaultHeight: 600, minTier: 'free',      locked: true  },
  { id: 'kuro.pay',      canonical: 'KUROPay',      displayName: 'Pay',         realm: null,         icon: 'kuro.pay',      component: 'KuroPayApp',      defaultWidth: 500, defaultHeight: 750, minTier: 'sovereign', locked: true  },
  { id: 'kuro.wager',    canonical: 'KUROWager',    displayName: 'Wager',       realm: 'FluxKURO',   icon: 'kuro.wager',    component: 'WagerApp',        defaultWidth: 500, defaultHeight: 700, minTier: 'sovereign', locked: true  },
  { id: 'kuro.phone',    canonical: 'KUROCall',     displayName: 'Call',        realm: null,         icon: 'kuro.phone',    component: 'PhoneApp',        defaultWidth: 400, defaultHeight: 700, minTier: 'sovereign', locked: true  },
  { id: 'kuro.media',    canonical: 'KUROFlix',     displayName: 'Flix',        realm: null,         icon: 'kuro.media',    component: 'KuroMediaApp',    defaultWidth: 600, defaultHeight: 700, minTier: 'pro',       locked: true  },
  { id: 'kuro.messages', canonical: 'KUROMessages', displayName: 'Messages',    realm: null,         icon: 'kuro.messages', component: 'MessagesApp',     defaultWidth: 500, defaultHeight: 700, minTier: 'sovereign', locked: false },
  { id: 'kuro.files',    canonical: 'KUROFiles',    displayName: 'Files',       realm: null,         icon: 'kuro.files',    component: 'FileExplorerApp', defaultWidth: 700, defaultHeight: 500, minTier: 'pro',       locked: false },
  { id: 'kuro.sandbox',  canonical: 'KUROForge',    displayName: 'Forge',       realm: null,         icon: 'kuro.sandbox',  component: 'SandboxApp',      defaultWidth: 800, defaultHeight: 600, minTier: 'pro',       locked: false },
  { id: 'kuro.git',      canonical: 'KUROGit',      displayName: 'Git Patches', realm: null,         icon: 'kuro.git',      component: 'GitPatchApp',     defaultWidth: 920, defaultHeight: 620, minTier: 'pro',       locked: false },
  { id: 'kuro.admin',    canonical: 'KUROAdmin',    displayName: 'Admin',       realm: null,         icon: 'kuro.admin',    component: 'AdminApp',        defaultWidth: 700, defaultHeight: 500, minTier: 'sovereign', locked: false },
  { id: 'kuro.about',    canonical: 'KUROAbout',    displayName: 'About',       realm: null,         icon: 'kuro.about',    component: 'AboutApp',        defaultWidth: 680, defaultHeight: 580, minTier: 'guest',     locked: false },
  // ─── Locked apps not yet implemented (surface in registry for IA continuity) ───
  { id: 'kuro.sound',    canonical: 'KUROSound',    displayName: 'Sound',       realm: null,         icon: 'kuro.sound',    component: null,              defaultWidth: 500, defaultHeight: 700, minTier: 'pro',       locked: true,  available: false },
  { id: 'kuro.grab',     canonical: 'KUROGrab',     displayName: 'Grab',        realm: null,         icon: 'kuro.grab',     component: null,              defaultWidth: 500, defaultHeight: 700, minTier: 'pro',       locked: true,  available: false },
];

// ═══════════════════════════════════════════════════════════════════════════
// REALMS — architectural families with multiple modules beneath them
// (Realms are not opened as apps; they group modules and surface in /api/realms)
// ═══════════════════════════════════════════════════════════════════════════

const REALMS = {
  NeuroKURO: {
    canonical: 'NeuroKURO',
    displayName: 'Neuro',
    description: 'Circadian, pharmacokinetics, clinical, recommendation',
    modules: ['circadian_phase', 'pharmacokinetics', 'clinical_trials', 'recommendation'],
  },
  FluxKURO: {
    canonical: 'FluxKURO',
    displayName: 'Flux',
    description: 'Trading system — hunt, confirm, execute',
    modules: ['hunt', 'confirm', 'execute'],
  },
  ShadowKURO: {
    canonical: 'ShadowKURO',
    displayName: 'Shadow',
    description: 'Sovereign network layer',
    modules: ['nephilim_gate', 'babylon_protocol', 'mnemosyne_cache', 'shadow_vpn'],
  },
};

const TIER_LEVEL = { guest: -1, free: 0, pro: 1, sovereign: 2 };

// ─── Persistence helpers ────────────────────────────────────────────────────
const DEFAULT_APP_ORDER = SYSTEM_APPS.map(a => a.id);
const DEFAULT_PINNED    = ['kuro.chat', 'kuro.phone', 'kuro.messages', 'kuro.files', 'kuro.about'];
const MAX_BG_APPS       = 4; // LRU eviction limit for background apps

function loadLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Merge saved order with current SYSTEM_APPS:
// - preserve user's order for known apps
// - append any new apps not yet in saved order
// - drop IDs that no longer exist
function mergeAppOrder(saved) {
  const knownIds = new Set(DEFAULT_APP_ORDER);
  const filtered = saved.filter(id => knownIds.has(id));
  const missing  = DEFAULT_APP_ORDER.filter(id => !filtered.includes(id));
  return [...filtered, ...missing];
}

// ─── Store ──────────────────────────────────────────────────────────────────
export const useOSStore = create((set, get) => ({
  // App + realm registry
  apps: [...SYSTEM_APPS],
  realms: { ...REALMS },

  // ── iOS Home Screen state ──────────────────────────────────────────────────
  // Icon grid order (persisted + merged with new apps on every load)
  appOrder: mergeAppOrder(loadLS('kuro_app_order', DEFAULT_APP_ORDER)),
  // Apps that are "running" in the background (React tree mounted, state preserved)
  openApps: [],
  // The app currently filling the screen (null = Home Screen)
  visibleAppId: null,
  // Edit mode: icons wobble, drag-to-reorder enabled
  editMode: false,
  // Context menu state
  contextMenu: null, // { appId, x, y }

  // ── Dock ────────────────────────────────────────────────────────────────────
  glassPanelOpen: false,
  dockVisible: true,
  pinnedApps: loadLS('kuro_pinned_apps', DEFAULT_PINNED),

  // ── Legacy windowed mode (flag for rollback) ──────────────────────────────
  // Windows state kept for legacy windowed mode (LEGACY_WINDOWED=true)
  windows: {},
  windowOrder: [],
  nextZIndex: 100,

  // ── App transition (launch/close animation) ────────────────────────────────
  // { appId, fromRect: { top, right, bottom, left }, phase: 'launching' | 'closing' }
  appTransition: null,

  // ── Mode ───────────────────────────────────────────────────────────────────
  modelMode: 'main',
  powerDial: 'sovereign',

  // ─── Helpers ────────────────────────────────────────────────────────────────

  canAccessApp: (appId, userTier) => {
    const app = get().apps.find(a => a.id === appId);
    if (!app) return false;
    if (app.available === false) return false;
    const effectiveTier = userTier || 'guest';
    return (TIER_LEVEL[effectiveTier] ?? -1) >= (TIER_LEVEL[app.minTier] ?? -1);
  },

  // ─── iOS-style app open: sets visibleAppId, adds to openApps ────────────────
  openApp: (appId) => {
    const state = get();
    const app = state.apps.find(a => a.id === appId);
    if (!app || app.available === false) return;

    set(s => {
      // If already open, just bring to front
      if (s.openApps.includes(appId)) {
        return { visibleAppId: appId, glassPanelOpen: false };
      }
      // LRU eviction: keep at most MAX_BG_APPS
      let next = [...s.openApps, appId];
      if (next.length > MAX_BG_APPS) next = next.slice(next.length - MAX_BG_APPS);

      // Clean up windows entries for evicted apps so they don't re-appear
      // in the legacy windowed fallback renderer in App.jsx
      const evicted = s.openApps.filter(id => !next.includes(id));

      // Also update legacy windows for LEGACY_WINDOWED compatibility
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw < 768;
      const cascade = Object.keys(s.windows).length * 16;
      const w = isMobile ? Math.min(app.defaultWidth || 800, vw - 24) : Math.min(app.defaultWidth || 800, vw - 40);
      const h = isMobile ? Math.min(app.defaultHeight || 600, vh - 80) : Math.min(app.defaultHeight || 600, vh - 80);
      const x = isMobile ? Math.max(12, (vw - w) / 2) : Math.max(20, (vw - w) / 2 + cascade);
      const y = isMobile ? Math.max(12, (vh - h) / 2) : Math.max(20, (vh - h) / 2 + cascade);

      // Build windows object with evicted entries removed
      const baseWindows = { ...s.windows };
      evicted.forEach(id => delete baseWindows[id]);

      return {
        openApps: next,
        visibleAppId: appId,
        glassPanelOpen: false,
        windows: {
          ...baseWindows,
          [appId]: {
            isOpen: true, isMinimized: false,
            isMaximized: isMobile,
            x, y, width: w, height: h,
            zIndex: s.nextZIndex,
            ...(isMobile ? { _prevX: x, _prevY: y, _prevW: w, _prevH: h } : {})
          }
        },
        windowOrder: [...s.windowOrder.filter(id => id !== appId), appId],
        nextZIndex: s.nextZIndex + 1,
      };
    });
  },

  // Return to Home Screen (app stays in openApps — state preserved)
  goHome: () => set({ visibleAppId: null }),

  // Switch directly to another running app
  switchToApp: (appId) => {
    const { openApps } = get();
    if (openApps.includes(appId)) set({ visibleAppId: appId });
    else get().openApp(appId);
  },

  closeApp: (appId) => {
    const win = get().windows[appId];
    if (win && !win.isClosing) {
      set(s => ({
        windows: { ...s.windows, [appId]: { ...s.windows[appId], isClosing: true } }
      }));
      setTimeout(() => get().finalizeClose(appId), 220);
    } else {
      get().finalizeClose(appId);
    }
  },

  finalizeClose: (appId) => set(s => {
    const newWindows = { ...s.windows };
    delete newWindows[appId];
    return {
      windows: newWindows,
      windowOrder: s.windowOrder.filter(id => id !== appId),
      openApps: s.openApps.filter(id => id !== appId),
      visibleAppId: s.visibleAppId === appId ? null : s.visibleAppId,
    };
  }),

  minimizeApp: (appId) => set(s => ({
    windows: { ...s.windows, [appId]: { ...s.windows[appId], isMinimized: true } }
  })),

  restoreApp: (appId) => set(s => ({
    windows: { ...s.windows, [appId]: { ...s.windows[appId], isMinimized: false, zIndex: s.nextZIndex } },
    windowOrder: [...s.windowOrder.filter(id => id !== appId), appId],
    nextZIndex: s.nextZIndex + 1
  })),

  maximizeApp: (appId) => set(s => {
    const win = s.windows[appId];
    if (!win) return s;
    const isMax = !win.isMaximized;
    return {
      windows: {
        ...s.windows,
        [appId]: {
          ...win,
          isMaximized: isMax,
          ...(isMax ? {} : { x: win._prevX || 40, y: win._prevY || 40, width: win._prevW || 800, height: win._prevH || 600 }),
          ...(isMax ? { _prevX: win.x, _prevY: win.y, _prevW: win.width, _prevH: win.height } : {})
        }
      }
    };
  }),

  focusWindow: (appId) => set(s => ({
    windows: { ...s.windows, [appId]: { ...s.windows[appId], zIndex: s.nextZIndex } },
    windowOrder: [...s.windowOrder.filter(id => id !== appId), appId],
    nextZIndex: s.nextZIndex + 1
  })),

  updateWindowPosition: (appId, x, y) => set(s => ({
    windows: { ...s.windows, [appId]: { ...s.windows[appId], x, y } }
  })),

  updateWindowSize: (appId, width, height) => set(s => ({
    windows: { ...s.windows, [appId]: { ...s.windows[appId], width, height } }
  })),

  // ─── Home Screen actions ────────────────────────────────────────────────────

  setAppOrder: (order) => {
    saveLS('kuro_app_order', order);
    set({ appOrder: order });
  },

  toggleEditMode: () => set(s => ({ editMode: !s.editMode, contextMenu: null })),
  exitEditMode:   () => set({ editMode: false }),

  openContextMenu:  (appId, x, y) => set({ contextMenu: { appId, x, y }, editMode: false }),
  closeContextMenu: () => set({ contextMenu: null }),

  // ─── Dock actions ───────────────────────────────────────────────────────────

  pinApp: (appId) => set(s => {
    if (s.pinnedApps.includes(appId)) return s;
    const next = [...s.pinnedApps, appId];
    saveLS('kuro_pinned_apps', next);
    return { pinnedApps: next };
  }),

  unpinApp: (appId) => set(s => {
    const next = s.pinnedApps.filter(id => id !== appId);
    saveLS('kuro_pinned_apps', next);
    return { pinnedApps: next };
  }),

  // ─── Misc ──────────────────────────────────────────────────────────────────
  // ─── Launch animation ──────────────────────────────────────────────────
  launchApp: (appId, fromRect) => {
    set({ appTransition: { appId, fromRect, phase: 'launching' } });
    get().openApp(appId);
  },
  clearTransition: () => set({ appTransition: null }),

  toggleGlassPanel: () => set(s => ({ glassPanelOpen: !s.glassPanelOpen })),
  setModelMode:     (mode) => set({ modelMode: mode }),
  setPowerDial:     (dial) => set({ powerDial: dial }),
}));

// ─── Convenience exports ────────────────────────────────────────────────────
export { SYSTEM_APPS, REALMS, TIER_LEVEL };
