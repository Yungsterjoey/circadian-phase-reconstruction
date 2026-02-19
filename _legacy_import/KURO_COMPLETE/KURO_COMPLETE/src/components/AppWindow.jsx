import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useOSStore } from '../stores/osStore';

// Liquid Glass Cube for Vista bar
const LiquidCube = () => (
  <div className="vista-cube">
    <div className="vc-inner">
      <div className="vc-face front" />
      <div className="vc-face back" />
      <div className="vc-face left" />
      <div className="vc-face right" />
      <div className="vc-face top" />
      <div className="vc-face bottom" />
    </div>
  </div>
);

export default function AppWindow({ appId, children }) {
  const { 
    windows, 
    apps,
    closeApp, 
    minimizeApp, 
    maximizeApp, 
    focusWindow,
    updateWindowPosition,
    updateWindowSize,
  } = useOSStore();
  
  const win = windows[appId];
  const app = apps.find(a => a.id === appId);
  
  const windowRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, winX: 0, winY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, direction: '' });
  
  // Touch feedback states
  const [activeButton, setActiveButton] = useState(null);
  
  if (!win?.isOpen || win.isMinimized) return null;

  const getCleanAppName = () => {
    if (!app?.name) return 'App';
    return app.name.replace(/^kuro\./i, '').replace(/^kuro::/i, '');
  };

  // Enhanced touch handlers with visual feedback
  const handleTrafficLight = (action, e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Haptic-style visual pulse
    setActiveButton(action);
    setTimeout(() => setActiveButton(null), 150);
    
    switch (action) {
      case 'close': closeApp(appId); break;
      case 'minimize': minimizeApp(appId); break;
      case 'maximize': maximizeApp(appId); break;
    }
  };

  // Drag handlers
  const handleDragStart = useCallback((e) => {
    if (e.target.closest('.traffic-light-zone')) return;
    
    focusWindow(appId);
    setIsDragging(true);
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    dragStart.current = {
      x: clientX,
      y: clientY,
      winX: win.position.x,
      winY: win.position.y,
    };
  }, [appId, win.position, focusWindow]);

  const handleDragMove = useCallback((e) => {
    if (!isDragging) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - dragStart.current.x;
    const deltaY = clientY - dragStart.current.y;
    
    updateWindowPosition(appId, {
      x: Math.max(0, dragStart.current.winX + deltaX),
      y: Math.max(0, dragStart.current.winY + deltaY),
    });
  }, [isDragging, appId, updateWindowPosition]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback((direction, e) => {
    e.stopPropagation();
    e.preventDefault();
    
    setIsResizing(true);
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    resizeStart.current = {
      x: clientX,
      y: clientY,
      width: win.size.width,
      height: win.size.height,
      direction,
    };
  }, [win.size]);

  const handleResizeMove = useCallback((e) => {
    if (!isResizing) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const deltaX = clientX - resizeStart.current.x;
    const deltaY = clientY - resizeStart.current.y;
    const dir = resizeStart.current.direction;
    
    let newWidth = resizeStart.current.width;
    let newHeight = resizeStart.current.height;
    
    if (dir.includes('e')) newWidth += deltaX;
    if (dir.includes('w')) newWidth -= deltaX;
    if (dir.includes('s')) newHeight += deltaY;
    if (dir.includes('n')) newHeight -= deltaY;
    
    const minSize = app?.minSize || { width: 300, height: 200 };
    
    updateWindowSize(appId, {
      width: Math.max(minSize.width, newWidth),
      height: Math.max(minSize.height, newHeight),
    });
  }, [isResizing, appId, app, updateWindowSize]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Global event listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove, { passive: true });
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: true });
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove, { passive: true });
      window.addEventListener('mouseup', handleResizeEnd);
      window.addEventListener('touchmove', handleResizeMove, { passive: true });
      window.addEventListener('touchend', handleResizeEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
      window.removeEventListener('touchmove', handleResizeMove);
      window.removeEventListener('touchend', handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const windowStyle = win.isMaximized ? {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: win.zIndex,
  } : {
    position: 'absolute',
    left: win.position.x,
    top: win.position.y,
    width: win.size.width,
    height: win.size.height,
    zIndex: win.zIndex,
  };

  return (
    <div
      ref={windowRef}
      className={`kuro-window ${win.isFocused ? 'focused' : ''} ${isDragging ? 'dragging' : ''} ${win.isMaximized ? 'maximized' : ''}`}
      style={windowStyle}
      onMouseDown={() => focusWindow(appId)}
      onTouchStart={() => focusWindow(appId)}
    >
      {/* Vista Bar - Liquid Glass Header */}
      <div 
        className="vista-bar"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        {/* Traffic Lights with Extended Touch Zones */}
        <div className="traffic-light-zone">
          <button 
            className={`traffic-light close ${activeButton === 'close' ? 'pulse' : ''}`}
            onMouseDown={(e) => handleTrafficLight('close', e)}
            onTouchStart={(e) => handleTrafficLight('close', e)}
            aria-label="Close"
          >
            <span className="glyph">×</span>
          </button>
          <button 
            className={`traffic-light minimize ${activeButton === 'minimize' ? 'pulse' : ''}`}
            onMouseDown={(e) => handleTrafficLight('minimize', e)}
            onTouchStart={(e) => handleTrafficLight('minimize', e)}
            aria-label="Minimize"
          >
            <span className="glyph">−</span>
          </button>
          <button 
            className={`traffic-light maximize ${activeButton === 'maximize' ? 'pulse' : ''}`}
            onMouseDown={(e) => handleTrafficLight('maximize', e)}
            onTouchStart={(e) => handleTrafficLight('maximize', e)}
            aria-label="Maximize"
          >
            <span className="glyph">+</span>
          </button>
        </div>

        {/* Divider */}
        <div className="vista-divider" />

        {/* Cube :: AppName */}
        <div className="vista-title">
          <LiquidCube />
          <span className="title-separator">::</span>
          <span className="title-text">{getCleanAppName()}</span>
        </div>
      </div>

      {/* Portal Content */}
      <div className="window-content">
        {children}
      </div>

      {/* Resize Handles */}
      {!win.isMaximized && (
        <>
          <div className="resize-handle n" onMouseDown={(e) => handleResizeStart('n', e)} onTouchStart={(e) => handleResizeStart('n', e)} />
          <div className="resize-handle s" onMouseDown={(e) => handleResizeStart('s', e)} onTouchStart={(e) => handleResizeStart('s', e)} />
          <div className="resize-handle e" onMouseDown={(e) => handleResizeStart('e', e)} onTouchStart={(e) => handleResizeStart('e', e)} />
          <div className="resize-handle w" onMouseDown={(e) => handleResizeStart('w', e)} onTouchStart={(e) => handleResizeStart('w', e)} />
          <div className="resize-handle ne" onMouseDown={(e) => handleResizeStart('ne', e)} onTouchStart={(e) => handleResizeStart('ne', e)} />
          <div className="resize-handle nw" onMouseDown={(e) => handleResizeStart('nw', e)} onTouchStart={(e) => handleResizeStart('nw', e)} />
          <div className="resize-handle se" onMouseDown={(e) => handleResizeStart('se', e)} onTouchStart={(e) => handleResizeStart('se', e)} />
          <div className="resize-handle sw" onMouseDown={(e) => handleResizeStart('sw', e)} onTouchStart={(e) => handleResizeStart('sw', e)} />
        </>
      )}

      <style>{`
        /* ═══════════════════════════════════════════════════════════════════════
           KURO WINDOW - Enhanced Glassmorphism + High Contrast
           Color Theory: Deep purples with luminous accents for depth perception
        ═══════════════════════════════════════════════════════════════════════ */
        
        .kuro-window {
          display: flex;
          flex-direction: column;
          border-radius: 14px;
          overflow: hidden;
          /* Enhanced shadow for Liquid Retina depth */
          box-shadow: 
            0 25px 60px rgba(0, 0, 0, 0.55),
            0 10px 25px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(255, 255, 255, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          /* Subtle outer glow for contrast in sunlight */
          filter: drop-shadow(0 0 1px rgba(168, 85, 247, 0.15));
          transition: box-shadow 0.2s ease, filter 0.2s ease;
          contain: layout style;
        }
        
        .kuro-window.focused {
          box-shadow: 
            0 30px 70px rgba(0, 0, 0, 0.6),
            0 15px 35px rgba(0, 0, 0, 0.45),
            0 0 0 1px rgba(168, 85, 247, 0.25),
            0 0 40px rgba(168, 85, 247, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.15);
          filter: drop-shadow(0 0 2px rgba(168, 85, 247, 0.25));
        }
        
        .kuro-window.dragging {
          opacity: 0.92;
          cursor: grabbing;
        }
        
        .kuro-window.dragging .vista-bar {
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        /* ═══════════════════════════════════════════════════════════════════════
           VISTA BAR - Apple Glassmorphism Pill
           Increased translucency, softer gradients, pill refraction border
        ═══════════════════════════════════════════════════════════════════════ */
        
        .vista-bar {
          display: flex;
          align-items: center;
          height: 44px;
          padding: 0 14px;
          gap: 10px;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          
          /* Enhanced glassmorphism - more translucent */
          background: linear-gradient(
            180deg,
            rgba(90, 90, 105, 0.72) 0%,
            rgba(65, 65, 78, 0.68) 35%,
            rgba(48, 48, 60, 0.75) 50%,
            rgba(58, 58, 72, 0.70) 100%
          );
          backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
          -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
          
          /* Pill refraction border - rainbow edge effect */
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          position: relative;
        }
        
        /* Pill highlight - top edge refraction */
        .vista-bar::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.25) 20%,
            rgba(255, 255, 255, 0.35) 50%,
            rgba(255, 255, 255, 0.25) 80%,
            transparent 100%
          );
        }
        
        /* Inner shadow for depth */
        .vista-bar::after {
          content: '';
          position: absolute;
          top: 1px;
          left: 0;
          right: 0;
          height: 50%;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06) 0%,
            transparent 100%
          );
          pointer-events: none;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           TRAFFIC LIGHTS - Enhanced Touch Targets (44x44 minimum)
           Apple HIG compliant touch zones with visual feedback
        ═══════════════════════════════════════════════════════════════════════ */
        
        .traffic-light-zone {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          margin: -8px;
          margin-right: 0;
          position: relative;
          z-index: 10;
        }
        
        .traffic-light {
          /* Visual size */
          width: 13px;
          height: 13px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          
          /* Touch target extension - invisible but tappable */
          /* 44x44 touch zone per Apple HIG */
        }
        
        /* Extended touch area */
        .traffic-light::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 44px;
          height: 44px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          /* Subtle touch feedback zone */
          background: transparent;
        }
        
        .traffic-light:active::before {
          background: rgba(255, 255, 255, 0.08);
        }
        
        /* Color gradients with enhanced contrast */
        .traffic-light.close {
          background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 50%, #d94848 100%);
          box-shadow: 
            0 1px 3px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            0 0 0 0.5px rgba(200, 60, 60, 0.5);
        }
        
        .traffic-light.minimize {
          background: linear-gradient(135deg, #ffd93d 0%, #f5c842 50%, #e5b82a 100%);
          box-shadow: 
            0 1px 3px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            0 0 0 0.5px rgba(200, 160, 30, 0.5);
        }
        
        .traffic-light.maximize {
          background: linear-gradient(135deg, #6bcf6b 0%, #4ac94a 50%, #3ab83a 100%);
          box-shadow: 
            0 1px 3px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            0 0 0 0.5px rgba(50, 160, 50, 0.5);
        }
        
        /* Hover states */
        .traffic-light:hover {
          transform: scale(1.15);
        }
        
        .traffic-light.close:hover {
          box-shadow: 
            0 2px 8px rgba(238, 90, 90, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            0 0 12px rgba(238, 90, 90, 0.3);
        }
        
        .traffic-light.minimize:hover {
          box-shadow: 
            0 2px 8px rgba(245, 200, 66, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.35),
            0 0 12px rgba(245, 200, 66, 0.3);
        }
        
        .traffic-light.maximize:hover {
          box-shadow: 
            0 2px 8px rgba(74, 201, 74, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            0 0 12px rgba(74, 201, 74, 0.3);
        }
        
        /* Pulse animation on touch */
        .traffic-light.pulse {
          animation: trafficPulse 0.15s ease-out;
        }
        
        @keyframes trafficPulse {
          0% { transform: scale(1); }
          50% { transform: scale(0.85); }
          100% { transform: scale(1); }
        }
        
        /* Glyphs */
        .traffic-light .glyph {
          opacity: 0;
          font-size: 11px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.55);
          line-height: 1;
          transition: opacity 0.15s ease;
        }
        
        .traffic-light-zone:hover .glyph,
        .traffic-light:active .glyph {
          opacity: 1;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           VISTA DIVIDER & TITLE
        ═══════════════════════════════════════════════════════════════════════ */
        
        .vista-divider {
          width: 1px;
          height: 22px;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(255, 255, 255, 0.18) 20%,
            rgba(255, 255, 255, 0.18) 80%,
            transparent 100%
          );
          margin: 0 6px;
        }
        
        .vista-title {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        
        /* Cube */
        .vista-cube {
          width: 20px;
          height: 20px;
          perspective: 80px;
        }
        
        .vc-inner {
          width: 11px;
          height: 11px;
          position: relative;
          transform-style: preserve-3d;
          animation: cubeRotate 10s linear infinite;
          margin: 4.5px;
        }
        
        .vc-face {
          position: absolute;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, rgba(180, 120, 255, 0.9) 0%, rgba(140, 80, 220, 0.75) 100%);
          border: 0.5px solid rgba(200, 150, 255, 0.6);
          box-shadow: inset 0 0 4px rgba(200, 150, 255, 0.4);
        }
        
        .vc-face.front { transform: translateZ(5.5px); }
        .vc-face.back { transform: translateZ(-5.5px) rotateY(180deg); }
        .vc-face.left { transform: translateX(-5.5px) rotateY(-90deg); }
        .vc-face.right { transform: translateX(5.5px) rotateY(90deg); }
        .vc-face.top { transform: translateY(-5.5px) rotateX(90deg); }
        .vc-face.bottom { transform: translateY(5.5px) rotateX(-90deg); }
        
        @keyframes cubeRotate {
          0% { transform: rotateX(-20deg) rotateY(0deg); }
          100% { transform: rotateX(-20deg) rotateY(360deg); }
        }
        
        /* Title Separator */
        .title-separator {
          font-size: 15px;
          font-weight: 700;
          color: rgba(180, 130, 255, 0.9);
          text-shadow: 0 0 12px rgba(168, 85, 247, 0.6);
          letter-spacing: -1px;
        }
        
        /* App Name - High contrast for readability */
        .title-text {
          font-size: 13px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
          letter-spacing: 0.3px;
          text-transform: capitalize;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           WINDOW CONTENT - Portal Effect
        ═══════════════════════════════════════════════════════════════════════ */
        
        .window-content {
          flex: 1;
          overflow: hidden;
          position: relative;
          background: linear-gradient(
            180deg,
            rgba(12, 12, 18, 0.98) 0%,
            rgba(8, 8, 14, 1) 100%
          );
        }
        
        /* Scanline overlay for depth */
        .window-content::after {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            rgba(0, 0, 0, 0.015) 2px,
            rgba(0, 0, 0, 0.015) 4px
          );
          pointer-events: none;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           RESIZE HANDLES - Enhanced touch targets
        ═══════════════════════════════════════════════════════════════════════ */
        
        .resize-handle {
          position: absolute;
          background: transparent;
        }
        
        .resize-handle.n, .resize-handle.s { height: 8px; left: 10px; right: 10px; cursor: ns-resize; }
        .resize-handle.e, .resize-handle.w { width: 8px; top: 10px; bottom: 10px; cursor: ew-resize; }
        .resize-handle.n { top: -4px; }
        .resize-handle.s { bottom: -4px; }
        .resize-handle.e { right: -4px; }
        .resize-handle.w { left: -4px; }
        .resize-handle.ne, .resize-handle.nw, .resize-handle.se, .resize-handle.sw { width: 16px; height: 16px; }
        .resize-handle.ne { top: -4px; right: -4px; cursor: nesw-resize; }
        .resize-handle.nw { top: -4px; left: -4px; cursor: nwse-resize; }
        .resize-handle.se { bottom: -4px; right: -4px; cursor: nwse-resize; }
        .resize-handle.sw { bottom: -4px; left: -4px; cursor: nesw-resize; }

        /* ═══════════════════════════════════════════════════════════════════════
           MOBILE OPTIMIZATIONS - Larger touch targets
        ═══════════════════════════════════════════════════════════════════════ */
        
        @media (hover: none) and (pointer: coarse) {
          .vista-bar {
            height: 52px;
            padding: 0 16px;
            backdrop-filter: blur(25px);
            -webkit-backdrop-filter: blur(25px);
          }
          
          .traffic-light-zone {
            gap: 12px;
            padding: 12px;
            margin: -12px;
            margin-right: 4px;
          }
          
          .traffic-light {
            width: 16px;
            height: 16px;
          }
          
          /* Larger invisible touch zone on mobile */
          .traffic-light::before {
            width: 52px;
            height: 52px;
          }
          
          .traffic-light .glyph {
            opacity: 1;
            font-size: 12px;
          }
          
          .resize-handle.n, .resize-handle.s { height: 16px; }
          .resize-handle.e, .resize-handle.w { width: 16px; }
          .resize-handle.ne, .resize-handle.nw, .resize-handle.se, .resize-handle.sw { width: 24px; height: 24px; }
        }
        
        /* Tablet-specific (iPad, Samsung Tab) */
        @media (min-width: 768px) and (hover: none) and (pointer: coarse) {
          .traffic-light-zone {
            gap: 10px;
            padding: 10px;
            margin: -10px;
          }
          
          .traffic-light {
            width: 14px;
            height: 14px;
          }
          
          .traffic-light::before {
            width: 48px;
            height: 48px;
          }
        }
      `}</style>
    </div>
  );
}
