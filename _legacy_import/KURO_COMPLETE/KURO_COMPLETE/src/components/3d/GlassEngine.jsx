import React from 'react';
import { Box, Circle, Triangle, Diamond, Hexagon, Octagon, Pentagon, Star } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// GLASS ENGINE v3 - CSS NEON GLOW (No WebGL)
// Performant replacement using Lucide icons with glow effects
// ═══════════════════════════════════════════════════════════════════════════

const ICON_MAP = {
  cube: Box,
  sphere: Circle,
  pyramid: Triangle,
  diamond: Diamond,
  torus: Hexagon,
  icosahedron: Octagon,
  dodecahedron: Pentagon,
  star: Star,
};

export default function GlassEngine({ type = 'cube', color = '#a855f7', size = 48, active = false }) {
  const Icon = ICON_MAP[type] || ICON_MAP.cube;
  const iconSize = Math.round(size * 0.6);
  
  return (
    <div 
      className="glass-icon"
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {/* Outer glow layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`,
          filter: active ? `blur(${size/4}px)` : `blur(${size/6}px)`,
          opacity: active ? 0.8 : 0.5,
          transition: 'all 0.3s ease',
        }}
      />
      
      {/* Icon with neon effect */}
      <Icon 
        size={iconSize}
        strokeWidth={1.5}
        style={{
          color: color,
          filter: `
            drop-shadow(0 0 ${active ? 8 : 4}px ${color})
            drop-shadow(0 0 ${active ? 16 : 8}px ${color}80)
            drop-shadow(0 0 2px rgba(255,255,255,0.5))
          `,
          opacity: active ? 1 : 0.85,
          transition: 'all 0.3s ease',
          animation: active ? 'iconPulse 2s ease-in-out infinite' : 'none',
        }}
      />
      
      <style>{`
        @keyframes iconPulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color}80) drop-shadow(0 0 2px rgba(255,255,255,0.5)); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 12px ${color}) drop-shadow(0 0 24px ${color}90) drop-shadow(0 0 4px rgba(255,255,255,0.7)); }
        }
      `}</style>
    </div>
  );
}
