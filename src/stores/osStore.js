import { create } from 'zustand';

const SYSTEM_APPS = [
  { id: 'kuro.chat', name: 'KURO Chat', icon: '💬', component: 'KuroChatApp', defaultWidth: 800, defaultHeight: 600, minTier: 'free' },
  { id: 'kuro.paxsilica', name: 'Pax Silica', icon: '🔧', component: 'PaxSilicaApp', defaultWidth: 900, defaultHeight: 700, minTier: 'free' },
  { id: 'kuro.files', name: 'Files', icon: '📁', component: 'FileExplorerApp', defaultWidth: 700, defaultHeight: 500, minTier: 'pro' },
  { id: 'kuro.browser', name: 'Browser', icon: '🌐', component: 'BrowserApp', defaultWidth: 900, defaultHeight: 700, minTier: 'pro' },
  { id: 'kuro.vision', name: 'Vision', icon: '🎨', component: 'VisionApp', defaultWidth: 800, defaultHeight: 600, minTier: 'pro' },
  { id: 'kuro.terminal', name: 'Terminal', icon: '⌨️', component: 'TerminalApp', defaultWidth: 800, defaultHeight: 500, minTier: 'sovereign' },
  { id: 'kuro.sandbox', name: 'Sandbox', icon: '🧪', component: 'SandboxApp', defaultWidth: 800, defaultHeight: 600, minTier: 'pro' },
  { id: 'kuro.about', name: 'About', icon: '🔮', component: 'AboutApp', defaultWidth: 420, defaultHeight: 480, minTier: 'free' },
  { id: 'kuro.settings', name: 'Settings', icon: '⚙️', component: 'SettingsApp', defaultWidth: 600, defaultHeight: 500, minTier: 'free' },
  // kuro.auth is a virtual window — not in SYSTEM_APPS, managed by App.jsx directly
];

const TIER_LEVEL = { free: 0, pro: 1, sovereign: 2 };

export const useOSStore = create((set, get) => ({
  // App registry
  apps: [...SYSTEM_APPS],

  // Window management
  windows: {},
  windowOrder: [],
  nextZIndex: 100,

  // UI state
  glassPanelOpen: false,
  dockVisible: true,
  pinnedApps: ['kuro.chat', 'kuro.files', 'kuro.terminal', 'kuro.sandbox', 'kuro.about'],

  // Mode
  modelMode: 'main',
  powerDial: 'instant',   // ⚡ instant | 🧠 deep | 👑 sovereign

  // Tier check helper (returns true if user can access app)
  canAccessApp: (appId, userTier) => {
    const app = get().apps.find(a => a.id === appId);
    if (!app) return false;
    return (TIER_LEVEL[userTier] || 0) >= (TIER_LEVEL[app.minTier] || 0);
  },

  openApp: (appId) => {
    const state = get();
    const app = state.apps.find(a => a.id === appId);
    if (!app) return;

    if (state.windows[appId]?.isOpen) {
      get().focusWindow(appId);
      return;
    }

    const isMobile = window.innerWidth < 768;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = isMobile ? vw : Math.min(app.defaultWidth || 800, vw - 40);
    const h = isMobile ? vh : Math.min(app.defaultHeight || 600, vh - 80);
    const x = isMobile ? 0 : Math.max(20, (vw - w) / 2 + (Object.keys(state.windows).length * 20));
    const y = isMobile ? 0 : Math.max(20, (vh - h) / 2 + (Object.keys(state.windows).length * 20));

    set(s => ({
      windows: {
        ...s.windows,
        [appId]: { isOpen: true, isMinimized: false, isMaximized: isMobile, x, y, width: w, height: h, zIndex: s.nextZIndex }
      },
      windowOrder: [...s.windowOrder.filter(id => id !== appId), appId],
      nextZIndex: s.nextZIndex + 1,
      glassPanelOpen: false
    }));
  },

  closeApp: (appId) => set(s => {
    const newWindows = { ...s.windows };
    delete newWindows[appId];
    return { windows: newWindows, windowOrder: s.windowOrder.filter(id => id !== appId) };
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

  toggleGlassPanel: () => set(s => ({ glassPanelOpen: !s.glassPanelOpen })),
  setModelMode: (mode) => set({ modelMode: mode }),
  setPowerDial: (dial) => set({ powerDial: dial }),
}));
