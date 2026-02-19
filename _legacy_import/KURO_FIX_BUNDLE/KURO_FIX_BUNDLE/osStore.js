import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MessageSquare, Globe, FolderOpen, Settings, Shield, Terminal, Image, Code, Cpu } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM APPS REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
const SYSTEM_APPS = [
  { id: 'kuro.executioner', name: 'Executioner', icon: Shield, system: true, minSize: { width: 400, height: 500 } },
  { id: 'kuro.chat', name: 'Chat', icon: MessageSquare, system: true, minSize: { width: 350, height: 400 } },
  { id: 'kuro.browser', name: 'Browser', icon: Globe, system: true, minSize: { width: 500, height: 400 } },
  { id: 'kuro.files', name: 'Files', icon: FolderOpen, system: true, minSize: { width: 400, height: 350 } },
  { id: 'kuro.settings', name: 'Settings', icon: Settings, system: true, minSize: { width: 350, height: 400 } },
  { id: 'kuro.terminal', name: 'Terminal', icon: Terminal, system: true, minSize: { width: 500, height: 350 } },
  { id: 'kuro.vision', name: 'Vision', icon: Image, system: false, minSize: { width: 400, height: 400 } },
  { id: 'kuro.forge', name: 'Forge', icon: Code, system: false, minSize: { width: 500, height: 500 } },
  { id: 'kuro.system', name: 'System', icon: Cpu, system: true, minSize: { width: 350, height: 300 } },
];

// Get safe viewport dimensions
const getViewportSize = () => {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  
  // Account for safe areas on iOS
  const safeTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0');
  const safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0');
  const safeLeft = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sal') || '0');
  const safeRight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sar') || '0');
  
  return {
    width: Math.min(window.innerWidth - safeLeft - safeRight - 20, 1200),
    height: Math.min(window.innerHeight - safeTop - safeBottom - 100, 800), // 100 for dock/header
  };
};

// Calculate window size that fits viewport
const calculateWindowSize = (app) => {
  const viewport = getViewportSize();
  const minSize = app?.minSize || { width: 400, height: 400 };
  
  return {
    width: Math.min(Math.max(minSize.width, 600), viewport.width),
    height: Math.min(Math.max(minSize.height, 500), viewport.height),
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
      
      // System state
      isLocked: true, // Start locked - requires auth
      currentUser: null,
      
      // App Registry
      apps: SYSTEM_APPS,
      
      // Window Management
      windows: {},
      windowOrder: [],
      nextZIndex: 100,
      
      // UI State
      glassPanelOpen: false,
      dockVisible: true,
      
      // Pinned Apps (persisted)
      pinnedApps: ['kuro.executioner', 'kuro.chat', 'kuro.browser', 'kuro.files', 'kuro.settings'],
      
      // Modal State
      activeModal: null,
      contextMenu: null,
      
      // ═══════════════════════════════════════════════════════════════════
      // AUTH ACTIONS
      // ═══════════════════════════════════════════════════════════════════
      
      unlock: (user = 'User') => {
        set({ isLocked: false, currentUser: user });
      },
      
      lock: () => {
        // Close all windows first
        get().closeAllWindows();
        set({ 
          isLocked: true, 
          currentUser: null,
          glassPanelOpen: false,
        });
      },
      
      logout: () => {
        // Clear session data
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('kuro_token');
          localStorage.removeItem('exe_convs');
          localStorage.removeItem('exe_settings');
        }
        // Lock the screen
        get().lock();
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // WINDOW ACTIONS
      // ═══════════════════════════════════════════════════════════════════
      
      openApp: (appId) => {
        const app = get().apps.find(a => a.id === appId);
        if (!app) return;
        
        const existing = get().windows[appId];
        if (existing?.isOpen) {
          // Focus existing window, unminimize if needed
          get().focusWindow(appId);
          return;
        }
        
        // Calculate position and size based on viewport
        const openCount = Object.keys(get().windows).filter(id => get().windows[id]?.isOpen).length;
        const windowSize = calculateWindowSize(app);
        
        set((state) => ({
          windows: {
            ...state.windows,
            [appId]: {
              isOpen: true,
              isMinimized: false,
              isMaximized: false,
              isFocused: true,
              zIndex: state.nextZIndex,
              position: { 
                x: 50 + (openCount * 30) % 150, 
                y: 50 + (openCount * 25) % 100 
              },
              size: windowSize,
              // Store previous state for un-maximize
              prevPosition: null,
              prevSize: null,
            }
          },
          windowOrder: [...state.windowOrder.filter(id => id !== appId), appId],
          nextZIndex: state.nextZIndex + 1,
          glassPanelOpen: false,
          // Unfocus other windows
          ...Object.keys(state.windows).reduce((acc, id) => {
            if (id !== appId && state.windows[id]) {
              acc.windows = acc.windows || { ...state.windows };
              acc.windows[id] = { ...state.windows[id], isFocused: false };
            }
            return acc;
          }, {})
        }));
      },
      
      closeApp: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win) return state;
          
          return {
            windows: {
              ...state.windows,
              [appId]: { 
                ...win, 
                isOpen: false,
                isMinimized: false,
                isMaximized: false, // FIXED: Reset maximize state on close
                isFocused: false,
              }
            },
            windowOrder: state.windowOrder.filter(id => id !== appId),
          };
        });
        
        // Focus the next window in order
        const order = get().windowOrder;
        if (order.length > 0) {
          const nextId = order[order.length - 1];
          if (nextId && get().windows[nextId]?.isOpen) {
            get().focusWindow(nextId);
          }
        }
      },
      
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
                isFocused: false,
              }
            }
          };
        });
        
        // Focus next visible window
        const order = get().windowOrder;
        for (let i = order.length - 1; i >= 0; i--) {
          const id = order[i];
          if (id !== appId && get().windows[id]?.isOpen && !get().windows[id]?.isMinimized) {
            get().focusWindow(id);
            break;
          }
        }
      },
      
      maximizeApp: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win) return state;
          
          const isMaximizing = !win.isMaximized;
          
          return {
            windows: {
              ...state.windows,
              [appId]: { 
                ...win, 
                isMaximized: isMaximizing,
                // Store/restore position and size
                prevPosition: isMaximizing ? win.position : null,
                prevSize: isMaximizing ? win.size : null,
                position: isMaximizing ? { x: 0, y: 0 } : (win.prevPosition || win.position),
                size: isMaximizing ? { width: '100%', height: '100%' } : (win.prevSize || win.size),
              }
            }
          };
        });
      },
      
      focusWindow: (appId) => {
        set((state) => {
          const win = state.windows[appId];
          if (!win || !win.isOpen) return state;
          
          // Build new windows object with all unfocused
          const newWindows = {};
          Object.keys(state.windows).forEach(id => {
            newWindows[id] = {
              ...state.windows[id],
              isFocused: id === appId,
              isMinimized: id === appId ? false : state.windows[id].isMinimized,
              zIndex: id === appId ? state.nextZIndex : state.windows[id].zIndex,
            };
          });
          
          return {
            windows: newWindows,
            windowOrder: [...state.windowOrder.filter(id => id !== appId), appId],
            nextZIndex: state.nextZIndex + 1,
          };
        });
      },
      
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
          
          // Enforce minimum size
          const app = state.apps.find(a => a.id === appId);
          const minSize = app?.minSize || { width: 300, height: 200 };
          
          return {
            windows: {
              ...state.windows,
              [appId]: { 
                ...win, 
                size: {
                  width: Math.max(minSize.width, size.width),
                  height: Math.max(minSize.height, size.height),
                }
              }
            }
          };
        });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // GLASS PANEL (START MENU)
      // ═══════════════════════════════════════════════════════════════════
      
      toggleGlassPanel: () => {
        set((state) => ({ glassPanelOpen: !state.glassPanelOpen }));
      },
      
      closeGlassPanel: () => {
        set({ glassPanelOpen: false });
      },
      
      // ═══════════════════════════════════════════════════════════════════
      // DOCK PINNING
      // ═══════════════════════════════════════════════════════════════════
      
      togglePin: (appId) => {
        set((state) => {
          const isPinned = state.pinnedApps.includes(appId);
          const newPinned = isPinned
            ? state.pinnedApps.filter(id => id !== appId)
            : [...state.pinnedApps, appId];
          return { pinnedApps: newPinned };
        });
      },
      
      isPinned: (appId) => {
        return get().pinnedApps.includes(appId);
      },
      
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
      
      getApp: (appId) => {
        return get().apps.find(a => a.id === appId);
      },
      
      getOpenWindows: () => {
        const { windows } = get();
        return Object.entries(windows)
          .filter(([_, w]) => w.isOpen && !w.isMinimized)
          .map(([id, w]) => ({ id, ...w }));
      },
      
      closeAllWindows: () => {
        set((state) => ({
          windows: Object.fromEntries(
            Object.entries(state.windows).map(([id, w]) => [id, { 
              ...w, 
              isOpen: false, 
              isMinimized: false,
              isMaximized: false,
              isFocused: false,
            }])
          ),
          windowOrder: [],
        }));
      },
      
      // Recalculate window sizes on viewport change
      handleResize: () => {
        const viewport = getViewportSize();
        set((state) => {
          const newWindows = {};
          Object.entries(state.windows).forEach(([id, win]) => {
            if (win.isOpen && !win.isMaximized) {
              const app = state.apps.find(a => a.id === id);
              const minSize = app?.minSize || { width: 300, height: 200 };
              newWindows[id] = {
                ...win,
                size: {
                  width: Math.min(Math.max(minSize.width, win.size.width), viewport.width),
                  height: Math.min(Math.max(minSize.height, win.size.height), viewport.height),
                },
                position: {
                  x: Math.min(win.position.x, viewport.width - 100),
                  y: Math.min(win.position.y, viewport.height - 100),
                }
              };
            } else {
              newWindows[id] = win;
            }
          });
          return { windows: newWindows };
        });
      },
    }),
    {
      name: 'kuro-os-store',
      partialize: (state) => ({
        pinnedApps: state.pinnedApps,
        // Don't persist isLocked - always start locked for security
      }),
    }
  )
);

export default useOSStore;
