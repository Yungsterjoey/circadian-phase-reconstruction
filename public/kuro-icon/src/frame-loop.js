/**
 * KURO::ICON — Frame Loop
 * 
 * Single rAF for all active icons. Pauses when no icons visible.
 * Uses IntersectionObserver to skip offscreen icons.
 */

const activeIcons = new Set();
let rafId = null;
let lastTime = 0;

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const icon = entry.target;
    if (entry.isIntersecting) {
      if (icon._kuroRender) {
        activeIcons.add(icon);
        ensureRunning();
      }
    } else {
      activeIcons.delete(icon);
      if (activeIcons.size === 0) stop();
    }
  }
}, { threshold: 0.01 });

function tick(time) {
  const dt = Math.min(time - lastTime, 33.33); // cap at ~30fps min
  lastTime = time;

  for (const icon of activeIcons) {
    if (icon._kuroRender) {
      icon._kuroRender(time, dt);
    }
  }

  if (activeIcons.size > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function ensureRunning() {
  if (rafId === null) {
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function stop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function registerIcon(element) {
  observer.observe(element);
}

export function unregisterIcon(element) {
  observer.unobserve(element);
  activeIcons.delete(element);
  if (activeIcons.size === 0) stop();
}
