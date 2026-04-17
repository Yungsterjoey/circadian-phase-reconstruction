/**
 * GlassCube — iconic 3D glass cube logomark.
 * Six-face CSS cube with perspective, preserve-3d, slow Y-rotation.
 * Ported from landing.html. Sizes: nav (18px), hero (120px).
 */
import React from 'react';

export default function GlassCube({ size = 'nav', className = '', paused = false }) {
  const cls = `gcube gcube-${size}${className ? ` ${className}` : ''}`;
  return (
    <span className={cls} aria-hidden="true">
      <span className={`gcube-inner${paused ? ' paused' : ''}`}>
        <span className="gcf ft" /><span className="gcf bk" />
        <span className="gcf rt" /><span className="gcf lt" />
        <span className="gcf tp" /><span className="gcf bt" />
      </span>
      <GlassCubeStyles />
    </span>
  );
}

let stylesInjected = false;
function GlassCubeStyles() {
  if (stylesInjected) return null;
  stylesInjected = true;
  return (
    <style>{`
.gcube { perspective: 600px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; vertical-align: middle; }
.gcube-inner { position: relative; transform-style: preserve-3d; animation: gcube-spin 20s linear infinite; }
.gcube-inner.paused { animation-play-state: paused; }
@keyframes gcube-spin {
  from { transform: rotateX(-20deg) rotateY(-30deg); }
  to   { transform: rotateX(-20deg) rotateY(330deg); }
}
.gcf {
  position: absolute;
  background: linear-gradient(135deg,
    rgba(91, 33, 182, 0.35) 0%,
    rgba(76, 29, 149, 0.25) 50%,
    rgba(49, 10, 101, 0.45) 100%);
  border: 1px solid rgba(139, 92, 246, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: inset 0 0 8px rgba(168, 121, 255, 0.12);
}
.gcf.ft { transform: translateZ(var(--gc-h)); }
.gcf.bk { transform: rotateY(180deg) translateZ(var(--gc-h)); }
.gcf.rt { transform: rotateY(90deg)  translateZ(var(--gc-h)); }
.gcf.lt { transform: rotateY(-90deg) translateZ(var(--gc-h)); }
.gcf.tp { transform: rotateX(90deg)  translateZ(var(--gc-h)); }
.gcf.bt { transform: rotateX(-90deg) translateZ(var(--gc-h)); }

/* ── nav (next to brand text) ── */
.gcube-nav { width: 26px; height: 26px; }
.gcube-nav .gcube-inner { width: 18px; height: 18px; transform: rotateX(-15deg) rotateY(-25deg); }
.gcube-nav .gcf { width: 18px; height: 18px; --gc-h: 9px; }

/* ── hero (centrepiece) ── */
.gcube-hero { width: 160px; height: 160px; }
.gcube-hero .gcube-inner { width: 120px; height: 120px; transform: rotateX(-20deg) rotateY(-30deg); }
.gcube-hero .gcf { width: 120px; height: 120px; --gc-h: 60px; }

@media (prefers-reduced-motion: reduce) {
  .gcube-inner { animation: none !important; }
}
    `}</style>
  );
}
