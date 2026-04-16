import React, { useEffect, useRef } from 'react';

export default function DesktopBackground() {
  const glowRef = useRef(null);
  const mothsRef = useRef([]);
  const rafRef = useRef(null);
  const targetRef = useRef({ x: 50, y: 50 });
  const currentRef = useRef({ x: 50, y: 50 });

  useEffect(() => {
    let isActive = true;

    const handleMove = (e) => {
      const x = e.clientX ?? e.touches?.[0]?.clientX;
      const y = e.clientY ?? e.touches?.[0]?.clientY;
      if (x !== undefined) {
        targetRef.current.x = (x / window.innerWidth) * 100;
        targetRef.current.y = (y / window.innerHeight) * 100;
      }
    };

    const animate = () => {
      if (!isActive) return;
      
      currentRef.current.x += (targetRef.current.x - currentRef.current.x) * 0.06;
      currentRef.current.y += (targetRef.current.y - currentRef.current.y) * 0.06;
      
      if (glowRef.current) {
        glowRef.current.style.transform = `translate(-50%, -50%) translate3d(${currentRef.current.x - 50}vw, ${currentRef.current.y - 50}vh, 0)`;
      }
      
      mothsRef.current.forEach((moth, i) => {
        if (moth) {
          const offsetX = Math.sin(Date.now() / 1000 + i * 2) * 3;
          const offsetY = Math.cos(Date.now() / 800 + i * 2) * 3;
          const scale = 0.5 + Math.sin(Date.now() / 600 + i) * 0.2;
          moth.style.transform = `translate(-50%, -50%) translate3d(${currentRef.current.x - 50 + offsetX}vw, ${currentRef.current.y - 50 + offsetY}vh, 0) scale(${scale})`;
          moth.style.opacity = 0.3 + Math.sin(Date.now() / 500 + i) * 0.2;
        }
      });
      
      rafRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', handleMove, { passive: true });
    window.addEventListener('touchmove', handleMove, { passive: true });
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      isActive = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="desktop-bg">
      <div className="void-black" />
      <div className="void-depth" />
      <div className="lava-layer">
        <div className="orb o1" />
        <div className="orb o2" />
        <div className="orb o3" />
        <div className="orb o4" />
      </div>
      <div ref={glowRef} className="touch-glow" />
      <div ref={el => mothsRef.current[0] = el} className="moth m1" />
      <div ref={el => mothsRef.current[1] = el} className="moth m2" />
      <div ref={el => mothsRef.current[2] = el} className="moth m3" />
      <div className="vignette" />

      <style>{`
        .desktop-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; contain: strict; }
        .void-black { position: absolute; inset: 0; background: #000000; }
        .void-depth { position: absolute; inset: 0; background: radial-gradient(ellipse 100% 60% at 50% 120%, rgba(15,5,25,0.5) 0%, rgba(5,2,10,0.2) 50%, transparent 80%); }
        
        .lava-layer { position: absolute; inset: -15%; filter: blur(70px); opacity: 0.5; mix-blend-mode: screen; will-change: transform; }
        .orb { position: absolute; border-radius: 50%; will-change: transform; }
        
        .o1 { width: 55vmax; height: 55vmax; left: -10%; top: -20%; background: radial-gradient(circle at 35% 35%, rgba(147,51,234,0.9) 0%, rgba(126,34,206,0.5) 40%, transparent 70%); animation: f1 14s ease-in-out infinite; }
        .o2 { width: 45vmax; height: 45vmax; right: -15%; top: 5%; background: radial-gradient(circle, rgba(192,132,252,0.8) 0%, rgba(139,92,246,0.4) 40%, transparent 70%); animation: f2 18s ease-in-out infinite; }
        .o3 { width: 40vmax; height: 40vmax; left: 15%; bottom: -15%; background: radial-gradient(circle, rgba(236,130,250,0.7) 0%, rgba(168,85,247,0.35) 40%, transparent 70%); animation: f3 12s ease-in-out infinite; }
        .o4 { width: 50vmax; height: 50vmax; right: 5%; bottom: -25%; background: radial-gradient(circle, rgba(99,102,241,0.6) 0%, rgba(79,70,229,0.3) 40%, transparent 70%); animation: f4 20s ease-in-out infinite; }

        @keyframes f1 { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(18vw,22vh,0) scale(1.15); } }
        @keyframes f2 { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(-22vw,18vh,0) scale(1.1); } }
        @keyframes f3 { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(15vw,-20vh,0) scale(1.08); } }
        @keyframes f4 { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(-15vw,-25vh,0) scale(1.18); } }

        .touch-glow { position: absolute; left: 50%; top: 50%; width: 30vmax; height: 30vmax; background: radial-gradient(circle, rgba(168,85,247,0.25) 0%, rgba(139,92,246,0.12) 30%, transparent 60%); filter: blur(25px); pointer-events: none; will-change: transform; animation: breathe 4s ease-in-out infinite; }
        @keyframes breathe { 0%,100% { opacity: 0.8; filter: blur(25px); } 50% { opacity: 1; filter: blur(30px); } }
        
        .moth { position: absolute; left: 50%; top: 50%; width: 8vmax; height: 8vmax; background: radial-gradient(circle, rgba(236,130,250,0.6) 0%, rgba(168,85,247,0.3) 40%, transparent 70%); filter: blur(15px); pointer-events: none; will-change: transform, opacity; opacity: 0.4; }
        .m1 { animation: mf1 6s ease-in-out infinite; }
        .m2 { animation: mf2 8s ease-in-out infinite; }
        .m3 { animation: mf3 7s ease-in-out infinite; }
        @keyframes mf1 { 0%,100% { filter: blur(15px) brightness(1); } 50% { filter: blur(12px) brightness(1.3); } }
        @keyframes mf2 { 0%,100% { filter: blur(18px) brightness(0.8); } 50% { filter: blur(14px) brightness(1.2); } }
        @keyframes mf3 { 0%,100% { filter: blur(12px) brightness(1.1); } 50% { filter: blur(16px) brightness(0.9); } }

        .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 65% 65% at 50% 50%, transparent 0%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0.7) 100%); }
        
        @media (prefers-reduced-motion: reduce) { .orb, .touch-glow { animation: none !important; } .moth { display: none; } }
      `}</style>
    </div>
  );
}
