import React, { useRef, useEffect, memo } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// DESKTOP BACKGROUND - True Void Black + PS1 Analog Clock Orbs
// Optimized: 30fps cap, passive listeners, will-change
// ═══════════════════════════════════════════════════════════════════════════

const DesktopBackground = memo(function DesktopBackground() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const orbsRef = useRef([]);
  const lastRef = useRef(0);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Fewer orbs for performance
      const count = Math.min(6, Math.floor((canvas.width * canvas.height) / 200000));
      orbsRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        r: 100 + Math.random() * 150,
        hue: 260 + Math.random() * 40,
        alpha: 0.025 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    
    resize();
    window.addEventListener('resize', resize, { passive: true });
    return () => window.removeEventListener('resize', resize);
  }, []);
  
  useEffect(() => {
    let throttle = false;
    const onMove = (e) => {
      if (throttle) return;
      throttle = true;
      requestAnimationFrame(() => {
        mouseRef.current.tx = e.clientX;
        mouseRef.current.ty = e.clientY;
        throttle = false;
      });
    };
    const onTouch = (e) => {
      if (e.touches[0]) {
        mouseRef.current.tx = e.touches[0].clientX;
        mouseRef.current.ty = e.touches[0].clientY;
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
    };
  }, []);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    
    const draw = (time) => {
      // 30fps cap
      if (time - lastRef.current < 33) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      lastRef.current = time;
      
      const { width, height } = canvas;
      
      // TRUE VOID BLACK
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      
      // Smooth mouse lerp
      mouseRef.current.x += (mouseRef.current.tx - mouseRef.current.x) * 0.04;
      mouseRef.current.y += (mouseRef.current.ty - mouseRef.current.y) * 0.04;
      
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const orbs = orbsRef.current;
      
      for (let i = 0; i < orbs.length; i++) {
        const o = orbs[i];
        
        // Subtle mouse attraction
        const dx = mx - o.x, dy = my - o.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 350 && dist > 0) {
          o.vx += (dx / dist) * 0.008;
          o.vy += (dy / dist) * 0.008;
        }
        
        // Apply velocity
        o.vx *= 0.99;
        o.vy *= 0.99;
        o.x += o.vx;
        o.y += o.vy;
        
        // Wrap
        if (o.x < -o.r) o.x = width + o.r;
        if (o.x > width + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = height + o.r;
        if (o.y > height + o.r) o.y = -o.r;
        
        // Pulse
        o.phase += 0.004;
        const pulse = Math.sin(o.phase) * 0.015 + o.alpha;
        
        // Draw orb
        const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        grad.addColorStop(0, `hsla(${o.hue}, 85%, 55%, ${pulse * 1.2})`);
        grad.addColorStop(0.4, `hsla(${o.hue}, 75%, 40%, ${pulse * 0.7})`);
        grad.addColorStop(1, 'hsla(270, 50%, 20%, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
      }
      
      // Cursor glow
      if (mx > 0 && my > 0) {
        const cg = ctx.createRadialGradient(mx, my, 0, mx, my, 120);
        cg.addColorStop(0, 'hsla(275, 100%, 70%, 0.06)');
        cg.addColorStop(0.5, 'hsla(280, 80%, 50%, 0.03)');
        cg.addColorStop(1, 'transparent');
        ctx.fillStyle = cg;
        ctx.fillRect(mx - 120, my - 120, 240, 240);
      }
      
      // Subtle vignette
      const vig = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.7);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      
      animRef.current = requestAnimationFrame(draw);
    };
    
    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />;
});

export default DesktopBackground;
