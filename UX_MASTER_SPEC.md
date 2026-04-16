# KURO OS — UX Master Spec

> **Single source of truth** for visual design, naming, and interaction across kuroglass.net (`/`, `/landing-legacy`, `/offline.html`) and the in-app SPA shell. Locked 2026-04-16.
>
> If you are about to add UI without reading this, stop.

---

## 0. The locked naming convention

This is non-negotiable. Drift = bug.

### `KURO[App]` — discrete apps
Apps are individual products under the KURO OS umbrella. Always written in the canonical form internally; **the OS shell strips the `KURO` prefix for display**.

| Canonical (id, code, logs) | OS-shell display | Status |
|---|---|---|
| `KUROChat`     | Chat     | live |
| `KUROPay`      | Pay      | live |
| `KUROWager`    | Wager    | live (FluxKURO realm member) |
| `KUROCall`     | Call     | live (formerly "Phone") |
| `KUROFlix`     | Flix     | live (formerly "Media") |
| `KUROSound`    | Sound    | reserved — not yet implemented |
| `KUROGrab`     | Grab     | reserved — not yet implemented |

Non-canonical OS apps follow the same `KURO[Name]` form (`KUROFiles`, `KUROAuth`, `KUROAdmin`, `KUROGit`, `KUROAbout`, `KUROForge`, `KUROMessages`) but are flagged `locked: false` in the registry.

### `[Realm]KURO` — architectural families
A realm is a **family surname** that groups multiple modules beneath it. Realms are not opened as apps — they're surfaced in `/api/realms` and on the landing as architecture sections.

| Realm | Modules |
|---|---|
| `NeuroKURO`  | circadian, pharmacokinetics, clinical, recommendation |
| `FluxKURO`   | hunt, confirm, execute (trading system) |
| `ShadowKURO` | nephilim_gate, babylon_protocol, mnemosyne_cache, shadow_vpn (sovereign network layer) |

**The Japanese family-name analogy:** NeuroKURO is the family surname; the modules underneath it are family members. Apps (KUROChat etc.) are individual products. Mixing the two conventions ("PayKURO", "KURONeuro") is a hard error — there is no such thing.

---

## 1. Material system: Liquid Glass v9

The design system lives in **`public/liquid-glass.css`** (token foundation, 22 KB). Every page must link it BEFORE any inline `<style>`:

```html
<link rel="stylesheet" href="/liquid-glass.css">
<script type="module" src="/kuro-icon/src/kuro-icon.js"></script>
```

### Token vocabulary (use only these)

| Category | Tokens |
|---|---|
| Surfaces | `--lg-surface-0..3` (0 = OLED black) |
| Glass    | `--lg-glass-bg`, `--lg-glass-border`, `--lg-glass-highlight`, `--lg-glass-shadow` |
| Frosted  | `--lg-frosted-bg`, `--lg-frosted-bg-hover` |
| Accent   | `--lg-accent: #a855f7`, `--lg-accent-glass`, `--lg-accent-glow` |
| Text     | `--lg-text-{primary,secondary,tertiary,on-accent}` |
| Blur     | `--lg-blur-{light,standard,heavy,frosted}` |
| Timing   | `--lg-duration-{instant,fast,standard,slow,morph}`, `--lg-ease-{standard,decelerate,accelerate,spring,glass}` |
| Radius   | `--lg-radius-{xs,sm,md,lg,xl,pill}` |

**Never invent new color tokens.** If you need a tone the spec doesn't have, that's a spec issue — open it for discussion, don't shadow the system locally.

### Component vocabulary

| Class | Use for |
|---|---|
| `.lg-regular`  | Standard nav, cards, default surface |
| `.lg-clear`    | Transparent content-passthrough (light blur, minimal tint) |
| `.lg-tinted`   | Accent CTAs, highlighted state, "active" surfaces |
| `.lg-frosted`  | Privacy panels, modals, notifications, anything that should obscure what's behind it |
| `.lg-pill`     | Pill-shaped element (radius: 9999px), inline-flex |
| `.lg-toolbar`  | Floating toolbar pill — ALWAYS centered, NEVER full-width |
| `.lg-dock`     | Bottom dock (heavier blur, app icons) |
| `.lg-panel`    | Padded panel container (radius xl) |
| `.lg-window`   | App window chrome (titlebar + body) |
| `.lg-notification` | Toast/banner |
| `.lg-materialize`  | Entry animation (opacity + transform — NOT backdrop-filter) |
| `.lg-stagger > *`  | Cascading entry (60ms increments, up to 8 children) |
| `.lg-pulse`    | Idle attention — accent glow pulse, 2.4s loop |

Compose: `<button class="lg-tinted lg-pill lg-materialize">CTA</button>` is valid.

### Brand rules (from kuro-v9 CHANGELOG)

- **H1 — No emoji.** Functional UI symbols (✕ close, ❯ chevron) are allowed. Decorative emoji (📡 ⚡ 🚀 ✨) are banned. Error messages use `[ERROR]` text prefixes, not warning glyphs.
- **H2 — Floating glass islands.** Toolbars, navs, and input bars are centered floating pills with rounded corners + glass backdrop. Never full-width opaque bars.
- **H3 — Safe-area islands.** Inputs/toolbars on touch devices use `margin: 8px` minimum + glass radius so they sit cleanly on notched screens. Combine with `env(safe-area-inset-*)` for padding.
- **M1 — All colors/blurs/radii via `--lg-*` tokens.** No hardcoded `rgba(168,85,247,...)` — alias or token, always.

---

## 2. Typography stack

The locked stack (overrides the spec's SF Pro default — these are stronger brand):

```css
--font-head: 'Clash Display', 'Bebas Neue', sans-serif;   /* Headlines, hero, CTAs */
--font-mono: 'DM Mono', 'Courier New', monospace;          /* Labels, badges, system text, telemetry */
--font-body: 'Instrument Serif', Georgia, serif;           /* Body copy, prose, italic prose */
```

Loaded via:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@200,300,400,500,600,700&display=swap" rel="stylesheet">
```

**Rationale:** Clash Display gives the brand a confident, technical-yet-elegant headline voice. DM Mono is for system telemetry and metadata (matches the audit-chain / sovereignty aesthetic). Instrument Serif for body copy is unusual on a tech site and gives the prose a deliberate, editorial quality — distinguishes KURO from generic SaaS landings.

**Never use:** `-apple-system`, `system-ui`, `Inter`, `Roboto`, `Arial`, `SF Pro` as primary. They are AI-slop defaults. The above stack with system fallbacks is fine.

---

## 3. The `<kuro-icon>` web component

The iconic glasscube is a **WebGL2 web component**, not a JPEG. Source lives at `public/kuro-icon/src/`.

```html
<kuro-icon size="64" pose="idle"></kuro-icon>
```

Attributes: `size` (px), `pose` (`idle` | `tilt` | `spin`). Falls back gracefully (renders nothing) if WebGL is unavailable — pages should provide a CSS fallback `::before` with a gradient cube where the icon matters (see `offline.html` for the pattern).

Keep `<link rel="icon" href="/kuro-logo.jpg">` as the browser favicon — favicons can't be web components.

---

## 4. Performance modes

Set on `<html data-lg-perf="...">`:

| Mode | When | Effect |
|---|---|---|
| (none / default) | Standard render | Spec defaults |
| `minimal` | Battery saver, weak GPU, `prefers-reduced-transparency` | Blur clamped to 8px, pseudo-elements disabled |
| `maximum` | Premium devices, hero pages | Blur 60px, saturate 1.8 |

Mobile auto-clamps blur via `@media (max-width: 768px), (pointer: coarse)`. Don't override.

---

## 5. Per-page conformance checklist

Run these greps to detect drift:

```bash
# 1. liquid-glass.css linked on every page?
grep -L "liquid-glass.css" public/*.html landing.html
# Expected: empty (every page links it)

# 2. lg-* classes used (≥5 per landing-class page)
grep -c "lg-regular\|lg-frosted\|lg-tinted\|lg-clear\|lg-toolbar\|lg-dock\|lg-pill" public/index.html
# Expected: ≥5

# 3. No emoji
python3 -c "import re; [print(f) for f in ['public/index.html','landing.html','public/offline.html'] if re.search(r'[\U0001F300-\U0001FAFF]', open(f).read())]"
# Expected: empty

# 4. No SF Pro / system fonts as PRIMARY
grep -nE "font-family:\s*-apple-system" public/*.html landing.html
# Expected: empty (only in fallback chains is OK)

# 5. No naming-convention violations
grep -nEi "PayKURO|ChatKURO|KURONeuro|KUROFlux|KUROShadow" .
# Expected: empty

# 6. Locked apps surface canonical names internally
grep -nE "canonical:\s*'(KUROChat|KUROPay|KUROWager|KUROCall|KUROFlix|KUROSound|KUROGrab)'" src/stores/osStore.js
# Expected: ≥7 hits
```

---

## 6. Per-page status (as of 2026-04-16)

| Page | URL | liquid-glass.css | Brand fonts | `<kuro-icon>` | H1/H2/H3 | Locked naming |
|---|---|---|---|---|---|---|
| Live landing | `/` | ✅ linked | ✅ Clash + DM Mono + Instrument Serif | ✅ embedded | ✅ enforced | ✅ surfaced |
| Legacy landing | `/landing-legacy` | ✅ linked (overlay only) | ✅ adopted | ❌ uses old SVG K | partial — kept as historical preview | n/a |
| PWA offline | `/offline.html` | ✅ linked | ✅ adopted | ✅ embedded (with fallback) | ✅ enforced | n/a |
| In-app SPA shell | `/app/*` (Vite) | imports liquid-glass.css | per Vite bundle | per `LiquidGlassProvider` | per spec | ✅ via `osStore.canonical` |

---

## 7. Drift prevention

When making any UI change:

1. **Read this doc first.** If your change isn't covered, it's a candidate for a spec amendment, not a one-off.
2. **Use the conformance greps in §5** before committing.
3. **Renames must update both `id` (legacy compat) and `canonical` (locked name)** in `src/stores/osStore.js` — never one without the other.
4. **No new color/blur/radius literals.** If `--lg-*` doesn't have what you need, propose adding a token to the spec.
5. **No new emoji.** Ever. There is no "but this one is tasteful" exception.
6. **Floating-island invariant.** Any nav/toolbar/input that spans the viewport width is wrong. If it must, justify it inline as a comment explaining why the spec doesn't apply.

---

## 8. Reference files

| File | Role |
|---|---|
| `public/liquid-glass.css` | Token + class system (THE spec stylesheet) |
| `public/kuro-icon/` | WebGL2 glasscube web component |
| `src/components/LiquidGlassEngine.jsx` | React `<Glass>` wrapper + `<LiquidGlassProvider>` |
| `src/components/DesktopBackground.jsx` | Official void-kill bg for SPA shell |
| `src/stores/osStore.js` | App + realm registry (canonical names live here) |
| `/home/user/.claude/projects/-home-user/memory/project_kuro_naming.md` | Memory copy of the locked naming convention |
| `kuro-v9-liquidglass.zip` | Original v9 spec drop (kept for archive) |
| `kuro-icon-spec.md` (in `/tmp/kuro-spec`) | Full WebGL2 icon component spec |

---

*This document is the design contract. Anything in the wild that contradicts it is wrong — fix the wild thing, not the doc. If the doc is wrong, propose an amendment with rationale.*
