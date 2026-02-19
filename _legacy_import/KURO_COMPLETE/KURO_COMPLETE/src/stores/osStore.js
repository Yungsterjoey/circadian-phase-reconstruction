import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MessageSquare, Globe, FolderOpen, Settings, Shield, Terminal, Image, Code, Cpu } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM APPS REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
const SYSTEM_APPS = [
  { id: 'kuro.executioner', name: 'Executioner', icon: Shield, system: true },
  { id: 'kuro.chat', name: 'Chat', icon: MessageSquare, system: true },
  { id: 'kuro.browser', name: 'Browser', icon: Globe, system: true },
  { id: 'kuro.files', name: 'Files', icon: FolderOpen, system: true },
  { id: 'kuro.settings', name: 'Settings', icon: Settings, system: true },
  { id: 'kuro.terminal', name: 'Terminal', icon: Terminal, system: true },
  { id: 'kuro.vision', name: 'Vision', icon: Image, system: false },
  { id: 'kuro.forge', name: 'Forge', icon: Code, system: false },
  { id: 'kuro.system', name: 'System', icon: Cpu, system: true },
];

// ═══════════════════════════════════════════════════════════════════════════
// VIEWPORT HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const getViewportSize = () => {
  if (typeof window === 'undefined') return { width: 1200, height: 800 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const calculateWindowSize = (viewport) => {
  const maxWidth = Math.min(900, viewport.width - 40);
  const maxHeight = Math.min(650, viewport.height - 120);
  return {
    width: Math.max(320, maxWidth),
    height: Math.max(300, maxHeight),
  };
};

const calculateWindowPosition = (index, viewport) => {
  const cascade = 30;
  const startX = 50 + (index * cascade) % 150;
  const startY = 50 + (index * cascade) % 100;
  return {
    x: Math.min(startX, Math.max(10, viewport.width - 350)),
    y: Math.min(startY, Math.max(10, viewport.height - 400)),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// OS STORE
// ═══════════════════════════════════════════════════════════════════════════
export const useOSStore = create(
  persist(
    (set, get) => ({
      // ═══════════════════════════════════════════════════════════════════
      // STATE
      // ═══════════════════════════════════════════════════════════════════
      apps: SYSTEM_APPS,
      windows: {},
      windowOrder: [],
      nextZIndex: 100,
      glassPanelOpen: false,
      dockVisible: true,
      isLocked: true,
      pinnedApps: ['kuro.executioner', 'kuro.chat', 'kuro.browser', 'kuro.files', 'kuro.settings'],
      activeModal: null,
      contextMenu: null,
      
      // ═══════════════════════════════════════════════════════════════════
      // LOCK SCREEN
      // ═══════════════════════════════════════════════════════════════════
      unlock: () => set({ isLocked: false }),
      
      lock: () => set({
        isLocked: true,
        windows: {},
        windowOrder: [],
        glassPanelOpen: false,
      }),
      
      logout: () => {
        localStorage.removeItem('kuro_token');
        localStorage.removeItem('kuro_session');
        set({
          isLocked: true,
          windows: {},
          windowOrder: [],
          glassPanelOpen: false,
          contextMenu: null,
          activeModal: null,
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // OPEN APP
      // ═══════════════════════════════════════════════════════════════════
      openApp: (appId) => {
        const app = get().apps.find(a => a.id === appId);
        if (!app) return;
        
        const existing = get().windows[appId];
        if (existing?.isOpen) {
          get().focusWindow(appId);
          return;
        }
        
        const viewport = getViewportSize();
        const openCount = Object.values(get().windows).filter(w => w.isOpen).length;
        const size = calculateWindowSize(viewport);
        const position = calculateWindowPosition(openCount, viewport);
        
        set((state) => ({
          windows: {
            ...state.windows,
            [appId]: {
              isOpen: true,
              isMinimized: false,
              isMaximized: false,
              zIndex: state.nextZIndex,
              position,
              size,
              prevPosition: null,
              prevSize: null,
            }
          },
          windowOrder: [...state.windowOrder.filter(id => id !== appId), appId],
          nextZIndex: state.nextZIndex + 1,
          glassPanelOpen: false,
        }));
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // CLOSE APP - FIXED: Reset ALL state including isMaximized
      // ═══════════════════════════════════════════════════════════════════
      closeApp: (appId) => {
        set((state) => {
          // Remove from windows entirely to prevent stale state
          const newWindows = { ...state.windows };
          delete newWindows[appId];
          
          return {
            windows: newWindows,
            windowOrder: state.windowOrder.filter(id => id !== appId),
          };
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // MINIMIZE APP - FIXED: Preserve maximize state for restore
      // ═══════════════════════════════════════════════════════════════════
      minimizeApp: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win) return state;
          
          return {
            windows: {
              ...state.windows,
              [appId]: {
                ...win,
                isMinimized: true,
                // Keep isMaximized so restore brings back maximized state
              }
            },
            windowOrder: state.windowOrder.filter(id => id !== appId),
          };
        });
        
        // Focus next visible window
        const { windowOrder, windows } = get();
        const visible = windowOrder.filter(id => 
          windows[id]?.isOpen && !windows[id]?.isMinimized
        );
        if (visible.length > 0) {
          get().focusWindow(visible[visible.length - 1]);
        }
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // MAXIMIZE APP - FIXED: Save/restore previous position and size
      // ═══════════════════════════════════════════════════════════════════
      maximizeApp: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win) return state;
          
          if (win.isMaximized) {
            // RESTORE: Use saved position/size
            return {
              windows: {
                ...state.windows,
                [appId]: {
                  ...win,
                  isMaximized: false,
                  position: win.prevPosition || win.position,
                  size: win.prevSize || win.size,
                  prevPosition: null,
                  prevSize: null,
                }
              }
            };
          } else {
            // MAXIMIZE: Save current position/size first
            return {
              windows: {
                ...state.windows,
                [appId]: {
                  ...win,
                  isMaximized: true,
                  prevPosition: { ...win.position },
                  prevSize: { ...win.size },
                }
              }
            };
          }
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // FOCUS WINDOW - FIXED: Restore from minimized
      // ═══════════════════════════════════════════════════════════════════
      focusWindow: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win) return state;
          
          return {
            windows: {
              ...state.windows,
              [appId]: {
                ...win,
                zIndex: state.nextZIndex,
                isMinimized: false,
              }
            },
            windowOrder: [...state.windowOrder.filter(id => id !== appId), appId],
            nextZIndex: state.nextZIndex + 1,
          };
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // UPDATE POSITION/SIZE - Don't update if maximized
      // ═══════════════════════════════════════════════════════════════════
      updateWindowPosition: (appId, position) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win || win.isMaximized) return state;
          return {
            windows: {
              ...state.windows,
              [appId]: { ...win, position }
            }
          };
        });
      },
      
      updateWindowSize: (appId, size) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win || win.isMaximized) return state;
          return {
            windows: {
              ...state.windows,
              [appId]: { ...win, size }
            }
          };
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // VIEWPORT RESIZE HANDLER
      // ═══════════════════════════════════════════════════════════════════
      handleResize: () => {
        const viewport = getViewportSize();
        
        set((state) => {
          const updatedWindows = { ...state.windows };
          let changed = false;
          
          Object.entries(updatedWindows).forEach(([appId, win]) => {
            if (!win.isOpen || win.isMaximized) return;
            
            const maxX = viewport.width - 100;
            const maxY = viewport.height - 100;
            const maxW = viewport.width - 40;
            const maxH = viewport.height - 120;
            
            let needsUpdate = false;
            const updates = { ...win };
            
            if (win.position.x > maxX) {
              updates.position = { ...win.position, x: Math.max(10, maxX) };
              needsUpdate = true;
            }
            if (win.position.y > maxY) {
              updates.position = { ...updates.position, y: Math.max(10, maxY) };
              needsUpdate = true;
            }
            if (win.size.width > maxW) {
              updates.size = { ...win.size, width: maxW };
              needsUpdate = true;
            }
            if (win.size.height > maxH) {
              updates.size = { ...updates.size, height: maxH };
              needsUpdate = true;
            }
            
            if (needsUpdate) {
              updatedWindows[appId] = updates;
              changed = true;
            }
          });
          
          return changed ? { windows: updatedWindows } : state;
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // GLASS PANEL
      // ═══════════════════════════════════════════════════════════════════
      toggleGlassPanel: () => set((state) => ({ glassPanelOpen: !state.glassPanelOpen })),
      closeGlassPanel: () => set({ glassPanelOpen: false }),
      
      // ═══════════════════════════════════════════════════════════════════
      // DOCK PINNING
      // ═══════════════════════════════════════════════════════════════════
      togglePin: (appId) => {
        set((state) => ({
          pinnedApps: state.pinnedApps.includes(appId)
            ? state.pinnedApps.filter(id => id !== appId)
            : [...state.pinnedApps, appId]
        }));
      },
      
      isPinned: (appId) => get().pinnedApps.includes(appId),
      
      // ═══════════════════════════════════════════════════════════════════
      // MODALS & CONTEXT MENUS
      // ═══════════════════════════════════════════════════════════════════
      setActiveModal: (modal) => set({ activeModal: modal }),
      closeModal: () => set({ activeModal: null }),
      setContextMenu: (menu) => set({ contextMenu: menu }),
      closeContextMenu: () => set({ contextMenu: null }),
      
      // ═══════════════════════════════════════════════════════════════════
      // UTILITY
      // ═══════════════════════════════════════════════════════════════════
      getApp: (appId) => get().apps.find(a => a.id === appId),
      
      getOpenWindows: () => {
        const { windows } = get();
        return Object.entries(windows)
          .filter(([_, w]) => w.isOpen && !w.isMinimized)
          .map(([id, w]) => ({ id, ...w }));
      },
      
      getMinimizedWindows: () => {
        const { windows } = get();
        return Object.entries(windows)
          .filter(([_, w]) => w.isOpen && w.isMinimized)
          .map(([id, w]) => ({ id, ...w }));
      },
      
      closeAllWindows: () => set({ windows: {}, windowOrder: [] }),
      
      reset: () => set({
        windows: {},
        windowOrder: [],
        nextZIndex: 100,
        glassPanelOpen: false,
        activeModal: null,
        contextMenu: null,
      }),
    }),
    {
      name: 'kuro-os-store',
      partialize: (state) => ({ pinnedApps: state.pinnedApps }),
    }
  )
);

// ═══════════════════════════════════════════════════════════════════════════
// VIEWPORT RESIZE LISTENER - Call in App.jsx useEffect
// ═══════════════════════════════════════════════════════════════════════════
export const initViewportListener = () => {
  if (typeof window === 'undefined') return () => {};
  
  const handleResize = () => useOSStore.getState().handleResize();
  
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  handleResize();
  
  return () => {
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('orientationchange', handleResize);
  };
};

export default useOSStore;
