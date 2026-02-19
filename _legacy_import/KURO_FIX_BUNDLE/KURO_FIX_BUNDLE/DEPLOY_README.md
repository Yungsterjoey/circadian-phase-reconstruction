# KURO OS v4.1 MEGA FIX BUNDLE
## Deployment Guide

---

## Bundle Contents

```
KURO_FIX_BUNDLE/
├── server.cjs              # Fixed backend (Port 3100)
├── osStore.js              # Fixed window manager + lock screen
├── GlassEngine.jsx         # CSS-based neon glow icons
├── KURO_OS_MASTER_PLAN_v4.md  # Full analysis document
│
├── LAYER MODULES (backend):
│   ├── iron_dome.js        # L0: Threat detection
│   ├── iff_gate.js         # L1: Client identification
│   ├── memory.js           # L4: Session memory
│   ├── semantic_router.js  # L3: Intent classification
│   ├── fire_control.js     # L6: SMASH targeting
│   ├── edubba_archive.js   # L2: Pattern recall
│   ├── maat_refiner.js     # L8: Truth weight
│   ├── output_enhancer.js  # L9: Response polish
│   ├── thinking_stream.js  # <think> tag filtering
│   └── smash_protocol.js   # Fire control helpers
│
└── AEROSPACE MODULES (v4.0):
    ├── flight_computer.js  # State machine orchestrator
    ├── voter_layer.js      # Actor-Judge verification
    ├── table_rocket.js     # Code simulation sandbox
    └── kuro_drive.js       # Project dependency graph
```

---

## Bug Fixes Applied

| Bug | Fix | File |
|-----|-----|------|
| Vista bar transparent | N/A - Vista bar CSS is in AppWindow, needs manual update | AppWindow.jsx |
| Black screen on close | Reset isMaximized on close | osStore.js ✅ |
| Search auto-focus | Removed autoFocus (update manually) | GlassPanel.jsx |
| Text selection on hold | Add CSS: `user-select:none` | Global CSS |
| Grey search box | Add transparent glass bg | GlassPanel.jsx |
| Context menu not showing | Long press timing fix needed | GlassPanel.jsx |
| Logout not going to lock | Added lock() and logout() | osStore.js ✅ |
| Window sizes cut off | Viewport-aware sizing | osStore.js ✅ |
| Exec app empty "()" | Better error handling | server.cjs ✅ |
| Logic model hangs | Timeout + fallback | server.cjs ✅ |
| Protocol pills not showing | Protocol SSE events | server.cjs ✅ |
| Server not using modules | Proper module integration | server.cjs ✅ |

---

## Deployment Steps

### 1. SSH to Server
```bash
ssh root@5.9.83.244
cd /var/www/kuro/ai-react
```

### 2. Backup Current Files
```bash
# Create backup directory
mkdir -p backups/$(date +%Y%m%d)

# Backup key files
cp server.cjs backups/$(date +%Y%m%d)/
cp src/stores/osStore.js backups/$(date +%Y%m%d)/
cp src/components/apps/ExecutionerApp.jsx backups/$(date +%Y%m%d)/
cp src/components/AppWindow.jsx backups/$(date +%Y%m%d)/
cp src/components/GlassPanel.jsx backups/$(date +%Y%m%d)/
```

### 3. Upload New Files (SFTP)
Using Termius/SFTP, upload files from this bundle:

| Source (Bundle) | Destination (Server) |
|-----------------|----------------------|
| server.cjs | /var/www/kuro/ai-react/server.cjs |
| osStore.js | /var/www/kuro/ai-react/src/stores/osStore.js |
| iron_dome.js | /var/www/kuro/ai-react/iron_dome.js |
| iff_gate.js | /var/www/kuro/ai-react/iff_gate.js |
| memory.js | /var/www/kuro/ai-react/memory.js |
| semantic_router.js | /var/www/kuro/ai-react/semantic_router.js |
| fire_control.js | /var/www/kuro/ai-react/fire_control.js |
| edubba_archive.js | /var/www/kuro/ai-react/edubba_archive.js |
| maat_refiner.js | /var/www/kuro/ai-react/maat_refiner.js |
| output_enhancer.js | /var/www/kuro/ai-react/output_enhancer.js |
| thinking_stream.js | /var/www/kuro/ai-react/thinking_stream.js |
| smash_protocol.js | /var/www/kuro/ai-react/smash_protocol.js |
| GlassEngine.jsx | /var/www/kuro/ai-react/src/components/3d/GlassEngine.jsx |

### 4. Rebuild and Restart
```bash
# Rebuild frontend
npm run build

# Restart backend
pm2 restart kuro-backend

# Check logs
pm2 logs kuro-backend --lines 50
```

### 5. Verify
```bash
# Health check
curl https://kuroglass.net/api/health

# Test stream endpoint
curl -N -X POST https://kuroglass.net/api/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

---

## Manual Fixes Required

### AppWindow.jsx - Vista Bar (Line ~320)
Replace the vista-bar background:

```css
.vista-bar {
  background: linear-gradient(
    180deg,
    rgba(90, 90, 105, 0.72) 0%,
    rgba(65, 65, 78, 0.68) 35%,
    rgba(48, 48, 60, 0.75) 50%,
    rgba(58, 58, 72, 0.70) 100%
  );
  backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
  -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
}
```

### GlassPanel.jsx - Remove autoFocus (Line ~384)
Change:
```jsx
<input ... autoFocus />
```
To:
```jsx
<input ... />
```

### GlassPanel.jsx - Logout Handler (Line ~295)
Replace handleLogout:
```jsx
const handleLogout = () => {
  const { logout } = useOSStore.getState();
  logout(); // This will clear data AND show lock screen
};
```

### Global CSS - Prevent Text Selection
Add to index.css or App.jsx:
```css
* {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}
input, textarea {
  -webkit-user-select: text;
  user-select: text;
}
```

---

## Testing Checklist

- [ ] Health check returns 200 OK
- [ ] Chat responds (not empty "()")
- [ ] All layers emit in correct order
- [ ] Incubation protocol shows in chat
- [ ] Red Team protocol shows in chat
- [ ] Fire Control protocol shows in chat
- [ ] Close button works (no black screen)
- [ ] Minimize button works
- [ ] Maximize/restore works
- [ ] Windows don't cut off on iPad
- [ ] Logout goes to lock screen
- [ ] Search doesn't auto-focus keyboard
- [ ] Long press shows context menu
- [ ] No text selection on hold

---

## Rollback

If issues occur:
```bash
cd /var/www/kuro/ai-react

# Restore from backup
cp backups/$(date +%Y%m%d)/server.cjs ./
cp backups/$(date +%Y%m%d)/osStore.js ./src/stores/
# etc...

# Restart
pm2 restart kuro-backend
```

---

## Support

For additional help, reference:
- KURO_OS_MASTER_PLAN_v4.md (detailed analysis)
- AEROSPACE_ARCHITECTURE_PLAN.md
- KUROWARE_DESIGN_PLAN.md

Last Updated: January 2026
