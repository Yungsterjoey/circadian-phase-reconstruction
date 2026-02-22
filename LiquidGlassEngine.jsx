/**
 * ═══════════════════════════════════════════════════════════════════════
 * KURO :: LIQUID GLASS ENGINE v2 — React Provider & Components
 *
 * AUDIT v2 FIXES:
 * [1] Tint prop: proper color normalization (hex/rgb/rgba/hsl all safe)
 * [2] GPU detection: iOS/mobile heuristics (Safari blocks WEBGL_debug_renderer_info)
 * [3] Performance mode sets data-attribute on <html> for CSS cascade
 * [4] Performance mode covers ALL blur tokens (light, frosted, heavy)
 * [5] Removed lg-refract class from <Glass> — refraction now opt-in via separate prop
 * [6] useMaterialization: fixed initial state (no animation on mount)
 * [7] useSpecularTilt: throttled to rAF, won't spam setState
 * [8] SVG filters simplified — only inject when refractionEnabled
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback, useMemo
} from 'react';


/* ═══════════════════════════════════════════════════════════════════════
   COLOR NORMALIZATION — Safe tint for any CSS color format
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Converts any CSS color string to rgba components.
 * Handles: #hex, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(), named.
 * Falls back to null if unparseable (caller should skip tinting).
 */
function parseColor(color) {
  if (!color || typeof color !== 'string') return null;
  color = color.trim();

  // hex shorthand: #rgb → #rrggbb
  const hexMatch = color.match(
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  );
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6,8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  // rgb()/rgba() — modern and legacy
  const rgbMatch = color.match(
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/
  );
  if (rgbMatch) {
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith('%')
        ? parseFloat(rgbMatch[4]) / 100
        : parseFloat(rgbMatch[4]);
    }
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3]),
      a: Math.min(1, Math.max(0, a))
    };
  }

  // hsl()/hsla() — convert to rgb
  const hslMatch = color.match(
    /^hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/
  );
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    let a = 1;
    if (hslMatch[4] !== undefined) {
      a = hslMatch[4].endsWith('%')
        ? parseFloat(hslMatch[4]) / 100
        : parseFloat(hslMatch[4]);
    }
    // hsl→rgb
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a: Math.min(1, Math.max(0, a))
    };
  }

  // Fallback: use a hidden canvas to parse named colors / other formats
  if (typeof document !== 'undefined') {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = color;
      const computed = ctx.fillStyle; // returns #rrggbb or rgba()
      if (computed !== color) return parseColor(computed);
    } catch (e) { /* noop */ }
  }

  return null;
}

/**
 * Build tint style object from any valid CSS color.
 * Returns {} if color is invalid (safe to spread).
 */
function buildTintStyle(color, alpha = 0.15) {
  const parsed = parseColor(color);
  if (!parsed) return {};
  const { r, g, b } = parsed;
  return {
    '--lg-accent-glass': `rgba(${r}, ${g}, ${b}, ${alpha})`,
    '--lg-accent-glow': `rgba(${r}, ${g}, ${b}, ${alpha + 0.10})`,
    background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    borderColor: `rgba(${r}, ${g}, ${b}, ${alpha * 0.8})`,
  };
}


/* ═══════════════════════════════════════════════════════════════════════
   DEVICE / GPU DETECTION
   ═══════════════════════════════════════════════════════════════════════ */

function detectPerformanceTier() {
  if (typeof navigator === 'undefined') return 'balanced';

  const ua = navigator.userAgent || '';

  // iOS detection: Safari blocks WEBGL_debug_renderer_info entirely.
  // Tier based on device generation heuristics.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // Check for older devices by screen resolution + devicePixelRatio
    const w = screen.width * (window.devicePixelRatio || 1);
    // iPhone SE / older iPads with < A14 chip: screen width ≤ 750 logical * 2 = 1500
    if (w <= 1500 && window.devicePixelRatio <= 2) return 'minimal';
    // Modern iPhones/iPads: balanced (their GPU can handle 28px blur)
    return 'balanced';
  }

  // Android detection
  const isAndroid = /Android/i.test(ua);
  if (isAndroid) {
    // Check device memory API (Chrome 63+)
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return 'minimal';
    // Check hardware concurrency
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return 'minimal';
    return 'balanced';
  }

  // Desktop: try WebGL renderer
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'minimal';

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).toLowerCase();
      // Known low-end
      if (/mali|powervr|swiftshader|llvmpipe|mesa|intel\s*(?:hd|uhd)\s*[2-5]\d{2}/i.test(renderer)) {
        return 'minimal';
      }
      // Known high-end discrete GPU
      if (/rtx|radeon\s*rx|geforce\s*(?:gtx\s*1[6-9]|rtx)|apple\s*m[2-9]/i.test(renderer)) {
        return 'maximum';
      }
    }

    // Fallback: balanced
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return 'balanced';
  } catch (e) {
    return 'balanced';
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   SVG FILTERS
   Only injected when refraction is enabled. Kept minimal.
   ═══════════════════════════════════════════════════════════════════════ */

const SVG_FILTERS = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;pointer-events:none" aria-hidden="true">
  <defs>
    <filter id="lg-refraction-filter" x="-5%" y="-5%" width="110%" height="110%"
            color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.015 0.015"
                    numOctaves="3" seed="1" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
                         scale="12" xChannelSelector="R" yChannelSelector="G"
                         result="displaced"/>
      <feSpecularLighting in="noise" surfaceScale="2" specularConstant="0.6"
                          specularExponent="25" lighting-color="#ffffff" result="specular">
        <fePointLight x="200" y="50" z="300"/>
      </feSpecularLighting>
      <feComposite in="specular" in2="displaced" operator="in" result="specMask"/>
      <feBlend in="displaced" in2="specMask" mode="screen"/>
    </filter>

    <filter id="lg-frosted-filter" x="-5%" y="-5%" width="110%" height="110%"
            color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blurred"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.02"
                    numOctaves="2" seed="3" result="noise"/>
      <feDisplacementMap in="blurred" in2="noise"
                         scale="8" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>
`;


/* ═══════════════════════════════════════════════════════════════════════
   CONTEXT
   ═══════════════════════════════════════════════════════════════════════ */

const LiquidGlassContext = createContext({
  theme: 'dark',
  refractionEnabled: true,
  performanceMode: 'balanced',
  setTheme: () => {},
  setPerformanceMode: () => {},
});

export const useLiquidGlass = () => useContext(LiquidGlassContext);


/* ═══════════════════════════════════════════════════════════════════════
   PROVIDER
   ═══════════════════════════════════════════════════════════════════════ */

export function LiquidGlassProvider({
  children,
  defaultTheme = 'dark',
  defaultPerformance = null, // null = auto-detect
}) {
  const [theme, setTheme] = useState(defaultTheme);
  const [performanceMode, setPerformanceMode] = useState(
    defaultPerformance || 'balanced'
  );
  const [refractionEnabled, setRefractionEnabled] = useState(true);
  const svgInjected = useRef(false);

  // Auto-detect performance on mount (once)
  useEffect(() => {
    if (defaultPerformance) return; // user explicitly set, skip detection
    const detected = detectPerformanceTier();
    setPerformanceMode(detected);
  }, [defaultPerformance]);

  // [FIX #3] Set data-attribute on <html> for CSS cascade
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-lg-perf', performanceMode);
    setRefractionEnabled(performanceMode !== 'minimal');
  }, [performanceMode]);

  // Apply theme to root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Inject SVG filters (only when refraction enabled)
  useEffect(() => {
    if (!refractionEnabled || svgInjected.current) return;

    const container = document.createElement('div');
    container.id = 'lg-svg-filters';
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    container.innerHTML = SVG_FILTERS;
    document.body.prepend(container);
    svgInjected.current = true;

    return () => {
      const el = document.getElementById('lg-svg-filters');
      if (el) el.remove();
      svgInjected.current = false;
    };
  }, [refractionEnabled]);

  const value = useMemo(() => ({
    theme,
    refractionEnabled,
    performanceMode,
    setTheme,
    setPerformanceMode,
  }), [theme, refractionEnabled, performanceMode]);

  return (
    <LiquidGlassContext.Provider value={value}>
      {children}
    </LiquidGlassContext.Provider>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT: <Glass> — Universal glass container
   
   variant: 'regular' | 'clear' | 'tinted' | 'frosted'
   shape:   'panel' | 'pill' | 'toolbar' | 'dock' | 'window' | 'notification'
   animate: boolean — play materialization on mount
   tint:    any CSS color — safely parsed via buildTintStyle()
   refract: boolean — opt-in SVG refraction pseudo-layer
   ═══════════════════════════════════════════════════════════════════════ */

export function Glass({
  children,
  variant = 'regular',
  shape = '',
  animate = false,
  tint = null,
  refract = false,
  style = {},
  className = '',
  as: Component = 'div',
  ...props
}) {
  const { refractionEnabled } = useLiquidGlass();

  const classes = [
    `lg-${variant}`,
    shape ? `lg-${shape}` : '',
    animate ? 'lg-materialize' : '',
    // [FIX #5] Refraction is opt-in, not auto-applied
    refract && refractionEnabled ? 'lg-refract-layer' : '',
    className,
  ].filter(Boolean).join(' ');

  // [FIX #1] Safe tint via proper color parser
  const tintStyle = tint ? buildTintStyle(tint) : {};

  return (
    <Component
      className={classes}
      style={{ ...tintStyle, ...style }}
      {...props}
    >
      {children}
    </Component>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   PREBUILT COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

export function GlassToolbar({ children, animate = true, className = '', ...props }) {
  return (
    <Glass variant="regular" shape="toolbar" animate={animate}
           className={className} {...props}>
      {children}
    </Glass>
  );
}

export function GlassDock({ children, className = '', ...props }) {
  return (
    <Glass variant="regular" shape="dock" animate
           className={className} {...props}>
      {children}
    </Glass>
  );
}

export function GlassPanel({ children, className = '', ...props }) {
  return (
    <Glass variant="regular" shape="panel" animate
           className={className} {...props}>
      {children}
    </Glass>
  );
}

export function GlassWindow({
  title,
  children,
  className = '',
  onClose,
  onMinimize,
  onMaximize,
  ...props
}) {
  return (
    <Glass variant="regular" shape="window" animate
           className={className} {...props}>
      <div className="lg-window-titlebar">
        <div style={{ display: 'flex', gap: '6px' }}>
          {onClose && (
            <button onClick={onClose} aria-label="Close" style={{
              width: 12, height: 12, borderRadius: '50%', border: 'none',
              background: '#ff5f57', cursor: 'pointer',
            }}/>
          )}
          {onMinimize && (
            <button onClick={onMinimize} aria-label="Minimize" style={{
              width: 12, height: 12, borderRadius: '50%', border: 'none',
              background: '#febc2e', cursor: 'pointer',
            }}/>
          )}
          {onMaximize && (
            <button onClick={onMaximize} aria-label="Maximize" style={{
              width: 12, height: 12, borderRadius: '50%', border: 'none',
              background: '#28c840', cursor: 'pointer',
            }}/>
          )}
        </div>
        {title && (
          <span style={{
            flex: 1, textAlign: 'center',
            color: 'var(--lg-text-secondary)',
            fontSize: '13px', fontWeight: 500,
            letterSpacing: '0.01em',
          }}>
            {title}
          </span>
        )}
      </div>
      <div className="lg-window-body">
        {children}
      </div>
    </Glass>
  );
}

export function GlassNotification({ children, className = '', ...props }) {
  return (
    <Glass variant="frosted" shape="notification" animate
           className={className} {...props}>
      {children}
    </Glass>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * useScrollResponsive — Shrinks glass elements on scroll (Apple tab bar behavior)
 */
export function useScrollResponsive(targetRef, { threshold = 10 } = {}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = targetRef?.current;
    if (!el) return;

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrolled(el.scrollTop > threshold);
          ticking = false;
        });
        ticking = true;
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [targetRef, threshold]);

  return scrolled;
}


/**
 * useSpecularTilt — Moves specular highlight based on pointer/gyro
 * [FIX #7] Throttled to rAF — won't spam React re-renders
 */
export function useSpecularTilt(ref) {
  const styleRef = useRef({});
  const [specStyle, setSpecStyle] = useState({});
  const rafId = useRef(null);

  useEffect(() => {
    const el = ref?.current;
    if (!el) return;

    const flush = () => {
      setSpecStyle({ ...styleRef.current });
      rafId.current = null;
    };

    const scheduleUpdate = (angle) => {
      styleRef.current = { '--lg-specular-angle': `${Math.round(angle)}deg` };
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(flush);
      }
    };

    const onPointer = (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 360;
      const y = ((e.clientY - rect.top) / rect.height) * 360;
      const angle = Math.atan2(y - 180, x - 180) * (180 / Math.PI) + 180;
      scheduleUpdate(angle);
    };

    const onOrientation = (e) => {
      if (e.gamma === null) return;
      const angle = ((e.gamma + 90) / 180) * 360;
      scheduleUpdate(angle);
    };

    el.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onOrientation, { passive: true });

    return () => {
      el.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onOrientation);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [ref]);

  return specStyle;
}


/**
 * useMaterialization — Trigger materialize/dematerialize
 * [FIX #6] Starts in 'idle' state, no animation class until triggered
 */
export function useMaterialization(initialVisible = false) {
  const [state, setState] = useState(
    initialVisible ? 'visible' : 'idle'
  );

  const materialize = useCallback(() => setState('materializing'), []);
  const dematerialize = useCallback(() => setState('dematerializing'), []);

  const className =
    state === 'materializing'  ? 'lg-materialize' :
    state === 'dematerializing' ? 'lg-dematerialize' :
    state === 'idle'            ? '' :
    '';  // 'visible' = no animation class, element is just there

  return { visible: state !== 'idle' && state !== 'dematerializing', materialize, dematerialize, className };
}


export default LiquidGlassProvider;
