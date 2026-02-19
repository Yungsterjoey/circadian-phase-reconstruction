# KURO OS v4.0 - COMPREHENSIVE ANALYSIS & FIX PLAN

## Executive Summary

After analyzing all uploaded files including:
- ExecutionerApp_v8_3.jsx (1386 lines)
- ExecutionerApp_v8_4.jsx (808 lines)
- ExecutionerApp.jsx from zip (1507 lines)
- server.cjs (608 lines)
- All layer modules (iron_dome, iff_gate, memory, etc.)
- UI components (AppWindow, GlassPanel, GlassDock, osStore)
- Architecture plans (Aerospace, KuroWare)
- Flight Computer, Voter Layer, Table Rocket modules

---

## Bug Analysis & Root Causes

### 1. Vista Bar Transparent (Not Liquid Glass)
**File:** `AppWindow.jsx` lines 320-345
**Root Cause:** Uses rgba backgrounds without proper SwiftUI-style blur pill effect
**Fix:** Add proper glassmorphism with refraction borders, inner glow, and saturation

### 2. Black Screen on Close/Minimize (Full Screen Mode)
**File:** `osStore.js` - `closeApp` and `minimizeApp` functions
**Root Cause:** When closing a maximized window, the isMaximized state persists causing layout issues
**Fix:** Reset isMaximized on close, add proper z-index cleanup

### 3. Auto-Focus Search on Panel Open
**File:** `GlassPanel.jsx` line 384
**Root Cause:** `autoFocus` attribute on search input
**Fix:** Remove autoFocus, add manual focus on explicit tap

### 4. Text Selection on Long Press (Mobile)
**File:** Multiple CSS files
**Root Cause:** Missing `-webkit-user-select: none` and `user-select: none`
**Fix:** Add global user-select:none and touch-action:manipulation

### 5. Grey Search Box in Start Panel
**File:** `GlassPanel.jsx` CSS
**Root Cause:** Input has default browser styling without glass background
**Fix:** Add transparent/glass background with proper border

### 6. Context Menu Not Appearing on Long Press
**File:** `GlassPanel.jsx` - AppTile component
**Root Cause:** Touch event handling may be interrupted by scroll or other handlers
**Fix:** Add touchmove detection to cancel long press, use touch-action:none on tiles

### 7. Logout Not Going to Lock Screen
**File:** `GlassPanel.jsx` line 295-302
**Root Cause:** Uses `window.location.reload()` but lock state isn't persisted
**Fix:** Add isLocked state to osStore and persist it

### 8. Window Sizes Cut Off on iPad
**File:** `osStore.js` - `openApp` function
**Root Cause:** Fixed default size { width: 900, height: 650 } doesn't account for viewport
**Fix:** Calculate max size based on viewport and safe areas

### 9. Exec App Returns Empty "()"
**File:** `server.cjs` streaming logic
**Root Cause:** Multiple issues:
  - Model may not be responding
  - Stream parsing may fail silently
  - Iron Dome skipping (layer not emitted properly)
**Fix:** Add error handling, ensure all layers emit, fix stream parser

### 10. Logic Model Hangs on Reasoning Layer
**File:** `server.cjs` line 387-403
**Root Cause:** Ollama request may timeout or fail without proper error handling
**Fix:** Add timeout, better error handling, fallback model

### 11. Protocol Pills Not Displaying (Incubation, Fire Control, Nuclear Fusion)
**File:** `ExecutionerApp.jsx` - MessageBubble component
**Root Cause:** CogBox component doesn't render when `protocols.incubation` etc is set
**Fix:** Add proper protocol type detection and rendering

### 12. Server Not Using Layer Modules
**File:** `server.cjs`
**Root Cause:** Some layer modules imported but not fully utilized
**Fix:** Ensure each layer module is called and emits proper SSE events

---

## File Comparison Matrix

| Feature | v8_3 | v8_4 | ZIP | MEGA (Target) |
|---------|------|------|-----|---------------|
| GlassEngine 3D Icons | ✅ | ❌ | ✅ | ✅ |
| TRUE_TONE Colors | ✅ | ❌ | ✅ | ✅ |
| Markdown Renderer | ✅ | ❌ | ✅ | ✅ |
| TerminalText Animation | ❌ | ✅ | ❌ | ✅ |
| CogPill (Modern Pills) | ❌ | ✅ | ❌ | ✅ |
| DeadDropModal | ✅ | ❌ | ✅ | ✅ |
| ArtifactModal | ✅ | ❌ | ✅ | ✅ |
| ExportModal | ✅ | ❌ | ✅ | ✅ |
| Protocol Pills (Inc/FC/NF) | ⚠️ | ✅ | ⚠️ | ✅ |
| Trust Badge | ✅ | ✅ | ✅ | ✅ |
| Network Panel | ✅ | ❌ | ✅ | ✅ |
| Safe Areas (iOS) | ⚠️ | ✅ | ✅ | ✅ |
| Touch Optimization | ⚠️ | ✅ | ⚠️ | ✅ |

---

## Files to Create/Update

### 1. ExecutionerApp_MEGA.jsx
Merge best of all versions:
- GlassEngine integration from v8_3
- TerminalText animation from v8_4
- Modern CogPill styling from v8_4
- All modals from v8_3
- TRUE_TONE colors from ZIP
- Fixed protocol rendering
- Fixed streaming logic
- Proper touch handling
- Safe area support

### 2. AppWindow_FIXED.jsx
- Proper Liquid Glass Vista bar
- Fixed close/minimize handling
- Better touch zones
- No black screen on close

### 3. GlassPanel_FIXED.jsx
- Remove autoFocus on search
- Fix context menu long press
- Proper logout to lock screen
- Glass styled search input

### 4. osStore_FIXED.js
- Add isLocked state
- Fix closeApp to reset maximized
- Add viewport-aware window sizing
- Add logout action

### 5. server_FIXED.cjs
- Proper layer module integration
- Better error handling
- Fixed streaming
- Timeout handling

---

## Deployment Steps

```bash
# 1. Backup current files
cp /var/www/kuro/ai-react/src/components/apps/ExecutionerApp.jsx /var/www/kuro/ai-react/src/components/apps/ExecutionerApp.jsx.bak
cp /var/www/kuro/ai-react/src/components/AppWindow.jsx /var/www/kuro/ai-react/src/components/AppWindow.jsx.bak
cp /var/www/kuro/ai-react/src/components/GlassPanel.jsx /var/www/kuro/ai-react/src/components/GlassPanel.jsx.bak
cp /var/www/kuro/ai-react/src/stores/osStore.js /var/www/kuro/ai-react/src/stores/osStore.js.bak
cp /var/www/kuro/ai-react/server.cjs /var/www/kuro/ai-react/server.cjs.bak

# 2. Upload new files via SFTP
# ExecutionerApp_MEGA.jsx -> /var/www/kuro/ai-react/src/components/apps/ExecutionerApp.jsx
# AppWindow_FIXED.jsx -> /var/www/kuro/ai-react/src/components/AppWindow.jsx
# GlassPanel_FIXED.jsx -> /var/www/kuro/ai-react/src/components/GlassPanel.jsx
# osStore_FIXED.js -> /var/www/kuro/ai-react/src/stores/osStore.js
# server_FIXED.cjs -> /var/www/kuro/ai-react/server.cjs

# 3. Rebuild and restart
cd /var/www/kuro/ai-react
npm run build
pm2 restart kuro-backend

# 4. Test
curl https://kuroglass.net/api/health
```

---

## Priority Order

1. **server_FIXED.cjs** - Backend must work first
2. **osStore_FIXED.js** - State management
3. **AppWindow_FIXED.jsx** - Window handling (black screen fix)
4. **GlassPanel_FIXED.jsx** - Start menu fixes
5. **ExecutionerApp_MEGA.jsx** - Chat interface

---

## Next Steps

Creating the fixed files now...
