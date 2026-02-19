import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronUp, Circle } from 'lucide-react';
import { useOSStore } from '../stores/osStore';

// ═══════════════════════════════════════════════════════════════════════════
// GLASS DOCK - Auto-hide with Spring Animations
// ═══════════════════════════════════════════════════════════════════════════

export default function GlassDock() {
  const { 
    apps, 
    windows, 
    pinnedApps, 
    openApp, 
    focusWindow,
    toggleGlassPanel,
    glassPanelOpen 
  } = useOSStore();
  
  // Dock visibility state
  const [dockState, setDockState] = useState('visible'); // 'visible' | 'hidden' | 'peeking'
  const [hovering, setHovering] = useState(false);
  const timeoutRef = useRef(null);
  const peekTimeoutRef = useRef(null);
  
  // Get running apps and pinned apps
  const runningAppIds = Object.keys(windows).filter(id => windows[id]?.isOpen);
  const hasOpenWindows = runningAppIds.length > 0;
  
  const pinnedAppsList = pinnedApps
    .map(id => apps.find(a => a.id === id))
    .filter(Boolean);
  
  const runningNotPinned = runningAppIds
    .filter(id => !pinnedApps.includes(id))
    .map(id => apps.find(a => a.id === id))
    .filter(Boolean);
  
  const dockApps = [...pinnedAppsList, ...runningNotPinned];
  
  // Auto-hide when windows are open
  useEffect(() => {
    if (hasOpenWindows && !hovering && dockState === 'visible') {
      timeoutRef.current = setTimeout(() => {
        setDockState('hidden');
      }, 2000);
    }
    
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [hasOpenWindows, hovering, dockState]);
  
  // Handle dock peek timeout (5.5 seconds)
  useEffect(() => {
    if (dockState === 'peeking' && !hovering) {
      peekTimeoutRef.current = setTimeout(() => {
        setDockState('hidden');
      }, 5500);
    }
    
    return () => {
      if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    };
  }, [dockState, hovering]);
  
  // Show dock permanently when no windows
  useEffect(() => {
    if (!hasOpenWindows) {
      setDockState('visible');
    }
  }, [hasOpenWindows]);
  
  const handleChevronClick = useCallback(() => {
    if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    setDockState('peeking');
  }, []);
  
  const handleDockHover = useCallback((entering) => {
    setHovering(entering);
    if (entering) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    }
  }, []);
  
  const handleAppClick = useCallback((app) => {
    const win = windows[app.id];
    if (win?.isOpen) {
      focusWindow(app.id);
    } else {
      openApp(app.id);
    }
  }, [windows, focusWindow, openApp]);
  
  const isRunning = (appId) => runningAppIds.includes(appId);
  const isFocused = (appId) => {
    const maxZ = Math.max(...Object.values(windows).map(w => w?.zIndex || 0), 0);
    return windows[appId]?.zIndex === maxZ && windows[appId]?.isOpen;
  };

  return (
    <>
      {/* CHEVRON PILL - Shows when dock is hidden */}
      <div 
        className={`dock-chevron ${dockState === 'hidden' ? 'visible' : ''}`}
        onClick={handleChevronClick}
      >
        <ChevronUp size={16} />
      </div>
      
      {/* MAIN DOCK */}
      <div 
        className={`glass-dock ${dockState}`}
        onMouseEnter={() => handleDockHover(true)}
        onMouseLeave={() => handleDockHover(false)}
        onTouchStart={() => handleDockHover(true)}
      >
        {/* Start Button (Glass Cube) */}
        <button 
          className={`dock-start ${glassPanelOpen ? 'active' : ''}`}
          onClick={toggleGlassPanel}
        >
          <div className="start-cube">
            <div className="cube-face front" />
            <div className="cube-face back" />
            <div className="cube-face left" />
            <div className="cube-face right" />
            <div className="cube-face top" />
            <div className="cube-face bottom" />
          </div>
        </button>
        
        {/* Divider */}
        <div className="dock-divider" />
        
        {/* App Icons */}
        <div className="dock-apps">
          {dockApps.map((app) => (
            <button
              key={app.id}
              className={`dock-app ${isRunning(app.id) ? 'running' : ''} ${isFocused(app.id) ? 'focused' : ''}`}
              onClick={() => handleAppClick(app)}
              title={app.name}
            >
              <div className="app-icon">
                {app.icon ? <app.icon size={24} /> : <Circle size={24} />}
              </div>
              {isRunning(app.id) && <div className="running-indicator" />}
            </button>
          ))}
        </div>
      </div>
      
      <style>{`
        .dock-chevron {
          position: fixed;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%) translateY(60px);
          padding: 8px 24px;
          background: rgba(20, 20, 24, 0.85);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          z-index: 999;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        
        .dock-chevron.visible {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
          pointer-events: auto;
        }
        
        .dock-chevron:hover {
          background: rgba(30, 30, 36, 0.95);
          border-color: rgba(168, 85, 247, 0.3);
          color: #a855f7;
          transform: translateX(-50%) translateY(-2px);
        }
        
        .dock-chevron:active {
          transform: translateX(-50%) translateY(0) scale(0.95);
        }
        
        .dock-chevron svg {
          animation: chevronBounce 2s ease-in-out infinite;
        }
        
        @keyframes chevronBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        
        .glass-dock {
          position: fixed;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%) translateY(0);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(20, 20, 24, 0.75);
          backdrop-filter: blur(40px) saturate(1.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          z-index: 1000;
          transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
          will-change: transform, opacity;
        }
        
        .glass-dock.hidden {
          transform: translateX(-50%) translateY(calc(100% + 20px));
          opacity: 0;
          pointer-events: none;
        }
        
        .glass-dock.peeking {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
          pointer-events: auto;
        }
        
        .glass-dock::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 19px;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), transparent, rgba(99, 102, 241, 0.2));
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          z-index: -1;
        }
        
        .glass-dock:hover::before { opacity: 1; }
        
        .dock-start {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0;
          perspective: 100px;
          transition: transform 0.3s ease;
        }
        
        .dock-start:hover { transform: scale(1.1); }
        .dock-start:active { transform: scale(0.95); }
        .dock-start.active .start-cube { animation: cubeSpinFast 1s ease-in-out; }
        
        .start-cube {
          width: 22px;
          height: 22px;
          position: relative;
          transform-style: preserve-3d;
          animation: cubeSpin 8s linear infinite;
        }
        
        .cube-face {
          position: absolute;
          width: 22px;
          height: 22px;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(99, 102, 241, 0.4));
          border: 1px solid rgba(168, 85, 247, 0.5);
          backdrop-filter: blur(4px);
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.3) inset;
        }
        
        .cube-face.front  { transform: translateZ(11px); }
        .cube-face.back   { transform: rotateY(180deg) translateZ(11px); }
        .cube-face.left   { transform: rotateY(-90deg) translateZ(11px); }
        .cube-face.right  { transform: rotateY(90deg) translateZ(11px); }
        .cube-face.top    { transform: rotateX(90deg) translateZ(11px); }
        .cube-face.bottom { transform: rotateX(-90deg) translateZ(11px); }
        
        @keyframes cubeSpin {
          0% { transform: rotateX(-15deg) rotateY(0deg); }
          100% { transform: rotateX(-15deg) rotateY(360deg); }
        }
        
        @keyframes cubeSpinFast {
          0% { transform: rotateX(0deg) rotateY(0deg); }
          100% { transform: rotateX(360deg) rotateY(360deg); }
        }
        
        .dock-divider {
          width: 1px;
          height: 28px;
          background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.15), transparent);
          margin: 0 4px;
        }
        
        .dock-apps { display: flex; align-items: center; gap: 4px; }
        
        .dock-app {
          position: relative;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        .dock-app:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-8px) scale(1.15);
        }
        
        .dock-app:active { transform: translateY(-4px) scale(1.05); }
        .dock-app.focused { background: rgba(168, 85, 247, 0.15); }
        
        .app-icon { color: rgba(255, 255, 255, 0.85); transition: all 0.2s ease; }
        
        .dock-app:hover .app-icon {
          color: #fff;
          filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.5));
        }
        
        .running-indicator {
          position: absolute;
          bottom: 2px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          background: #a855f7;
          border-radius: 50%;
          box-shadow: 0 0 6px #a855f7;
        }
        
        .dock-app.focused .running-indicator {
          width: 6px;
          background: #22c55e;
          box-shadow: 0 0 8px #22c55e;
        }
        
        @media (max-width: 600px) {
          .glass-dock { bottom: 8px; padding: 4px 8px; gap: 4px; border-radius: 16px; }
          .dock-start, .dock-app { width: 40px; height: 40px; }
          .start-cube { width: 18px; height: 18px; }
          .cube-face { width: 18px; height: 18px; }
          .cube-face.front  { transform: translateZ(9px); }
          .cube-face.back   { transform: rotateY(180deg) translateZ(9px); }
          .cube-face.left   { transform: rotateY(-90deg) translateZ(9px); }
          .cube-face.right  { transform: rotateY(90deg) translateZ(9px); }
          .cube-face.top    { transform: rotateX(90deg) translateZ(9px); }
          .cube-face.bottom { transform: rotateX(-90deg) translateZ(9px); }
          .app-icon svg { width: 20px; height: 20px; }
          .dock-chevron { padding: 10px 28px; }
        }
        
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .glass-dock { bottom: calc(12px + env(safe-area-inset-bottom)); }
          .dock-chevron { bottom: calc(8px + env(safe-area-inset-bottom)); }
        }
      `}</style>
    </>
  );
}
