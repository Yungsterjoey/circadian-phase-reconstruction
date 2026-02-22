/**
 * ═══════════════════════════════════════════════════════════════════════
 * KURO :: LIQUID GLASS ENGINE v2 — Migration Guide + Verification
 * ═══════════════════════════════════════════════════════════════════════
 */


/* ═══════════════════════════════════════════════════════════════════════
   STEP 1: App.jsx — Wire Provider
   ═══════════════════════════════════════════════════════════════════════

   In src/App.jsx, add the import and wrap your root component:

   --- BEFORE ---
   
   import KuroDesktop from './KuroDesktop'; // or whatever your root is
   
   function App() {
     return <KuroDesktop />;
   }

   --- AFTER ---

   import { LiquidGlassProvider } from './components/LiquidGlassEngine';
   
   function App() {
     return (
       <LiquidGlassProvider>
         <KuroDesktop />
       </LiquidGlassProvider>
     );
   }

   NOTE: defaultTheme="dark" and performance auto-detection are defaults.
   Override if needed: <LiquidGlassProvider defaultPerformance="balanced">

*/


/* ═══════════════════════════════════════════════════════════════════════
   STEP 2: main.jsx — CSS Import
   
   The deploy script handles this automatically. If manual:
   Add to the top of src/main.jsx:
   
   import './liquid-glass.css';

*/


/* ═══════════════════════════════════════════════════════════════════════
   STEP 3: Component Migrations (do these one at a time, test each)
   ═══════════════════════════════════════════════════════════════════════ */


// ─── 3A: GlassDock.jsx ────────────────────────────────────────────────
//
// BEFORE: Custom inline styles / old --glass-* tokens
//
// AFTER:

/*
import { GlassDock } from './LiquidGlassEngine';

export default function Dock({ pinnedApps, openApp }) {
  return (
    <GlassDock style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 900,
    }}>
      {pinnedApps.map(app => (
        <button key={app.id} onClick={() => openApp(app.id)}>
          {app.icon}
        </button>
      ))}
    </GlassDock>
  );
}
*/
// The .lg-dock shape overrides --lg-blur-standard to 60px (desktop)
// or 32px (mobile via media query). No manual blur tuning needed.


// ─── 3B: AppWindow.jsx ────────────────────────────────────────────────
//
// BEFORE: Manual glass background + drag logic
//
// AFTER:

/*
import { GlassWindow } from './LiquidGlassEngine';

export default function AppWindow({ app, windowState, onClose, onMinimize, onMaximize }) {
  return (
    <GlassWindow
      title={app.name}
      onClose={onClose}
      onMinimize={onMinimize}
      onMaximize={onMaximize}
      style={{
        position: 'absolute',
        width: windowState.width,
        height: windowState.height,
        left: windowState.x,
        top: windowState.y,
        zIndex: windowState.zIndex,
      }}
    >
      <app.component />
    </GlassWindow>
  );
}
*/
// The .lg-window shape handles overflow, flex layout, titlebar styling.
// Content inside .lg-window-body is at z-index: 3, always above glass.
// Traffic light buttons have aria-labels for a11y.


// ─── 3C: ConfirmModal.jsx ─────────────────────────────────────────────
//
// AFTER:

/*
import { Glass } from './LiquidGlassEngine';

export default function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <>
      {/- Backdrop -/}
      <div
        className="lg-clear"
        onClick={onCancel}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.4)',
        }}
      />
      {/- Modal -/}
      <Glass variant="frosted" shape="panel" animate
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          maxWidth: 400, width: '90%',
        }}
      >
        <h3 style={{ color: 'var(--lg-text-primary)', margin: '0 0 12px' }}>
          Confirm
        </h3>
        <p style={{ color: 'var(--lg-text-secondary)', margin: '0 0 20px' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="lg-regular lg-pill" onClick={onCancel}>
            Cancel
          </button>
          <button className="lg-tinted lg-pill" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </Glass>
    </>
  );
}
*/
// Modal uses variant="frosted" for heavier privacy blur.
// Buttons use class-based glass (lg-regular/lg-tinted + lg-pill).


// ─── 3D: ChatSidebar.jsx ─────────────────────────────────────────────
//
// AFTER:

/*
import { Glass } from './LiquidGlassEngine';

export default function ChatSidebar({ sessions, onSelect, isOpen }) {
  if (!isOpen) return null;

  return (
    <Glass variant="regular" shape="panel" animate
      style={{
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        width: 280,
        zIndex: 800,
        overflowY: 'auto',
      }}
    >
      <h4 style={{ color: 'var(--lg-text-primary)', padding: '0 0 8px' }}>
        History
      </h4>
      {sessions.map(s => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className="lg-clear lg-pill"
          style={{ width: '100%', marginBottom: 4, justifyContent: 'flex-start' }}
        >
          {s.title || 'Untitled'}
        </button>
      ))}
    </Glass>
  );
}
*/
// Session items use lg-clear lg-pill for subtle interactive rows.


/* ═══════════════════════════════════════════════════════════════════════
   CSS VARIABLE MAPPING (old → new)
   ═══════════════════════════════════════════════════════════════════════
   
   OLD                             →  NEW
   ────────────────────────────────────────────────────────────────────
   --theme-bg-primary              →  --lg-surface-0
   --theme-bg-panel                →  --lg-surface-1 (or use .lg-regular)
   --theme-accent                  →  --lg-accent
   --theme-blur                    →  --lg-blur-standard
   --theme-glow                    →  box-shadow with --lg-accent-glow
   --theme-glass-enabled           →  REMOVED (handled by performanceMode)
   --glass-blur                    →  --lg-blur-standard
   --glass-bg                      →  --lg-glass-bg
   --glass-border                  →  --lg-glass-border

*/


/* ═══════════════════════════════════════════════════════════════════════
   CUSTOM TINTING — Examples
   ═══════════════════════════════════════════════════════════════════════

   // All of these work safely now:
   <Glass variant="tinted" tint="#ef4444" shape="pill">Red</Glass>
   <Glass variant="tinted" tint="rgb(59, 130, 246)" shape="pill">Blue</Glass>
   <Glass variant="tinted" tint="rgba(34, 197, 94, 0.8)" shape="pill">Green</Glass>
   <Glass variant="tinted" tint="hsl(270, 60%, 50%)" shape="pill">Purple</Glass>
   
   Invalid colors produce no tinting (safe fallback to variant default).
   
*/


/* ═══════════════════════════════════════════════════════════════════════
   D) VERIFICATION CHECKLIST
   ═══════════════════════════════════════════════════════════════════════

   VISUAL SANITY
   □ Dark mode:  Glass elements show blur + specular rim on dark bg
   □ Light mode: Glass elements show blur + specular on light bg
   □ Text inside glass is crisp, not warped (z-index: 3 above pseudos)
   □ All 4 variants render distinctly: regular/clear/tinted/frosted
   □ Tint prop works with hex (#ef4444) and rgb (rgb(59,130,246))
   
   INTERACTION
   □ Hover: background lightens subtly, shadow elevates
   □ Active/press: scale(0.985) on regular/tinted
   □ Toolbar children: scale(0.92) on active, bg highlight on hover
   □ No visible "flash" on first interaction
   
   ACCESSIBILITY
   □ DevTools → Rendering → prefers-reduced-motion: reduce
     → All animations stop, transitions instant
   □ DevTools → Rendering → prefers-reduced-transparency: reduce
     → Glass becomes opaque (--lg-surface-2), pseudo-elements hidden
   □ DevTools → Rendering → prefers-contrast: more
     → Borders brighten, text fully opaque
   □ Traffic light buttons have aria-labels
   
   PERFORMANCE
   □ iPhone Safari: scroll inside a GlassWindow — smooth, no jank
   □ Check <html data-lg-perf="..."> — should be 'balanced' on modern
   □ Older Android (≤4GB RAM): should auto-detect 'minimal'
   □ Desktop Chrome: should be 'balanced' or 'maximum'
   □ Minimal mode: no pseudo-elements rendered, single shadow layer
   □ No "will-change: backdrop-filter" in computed styles (removed)
   
   DATA ATTRIBUTES (inspect <html>)
   □ data-theme="dark" or "light"
   □ data-lg-perf="minimal" | "balanced" | "maximum"
   
   BROWSER MATRIX
   □ Chrome (desktop):  Full effect including SVG refraction if opted in
   □ Safari (desktop):  Backdrop blur + specular rim (no SVG refraction)
   □ Firefox:           Backdrop blur + specular rim
   □ iOS Safari:        Blur clamped to 28px, single shadow, smooth
   □ Android Chrome:    Auto-detects RAM/cores, may drop to minimal

*/
