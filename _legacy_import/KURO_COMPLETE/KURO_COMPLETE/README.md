# KURO OS v4.1 COMPLETE BUNDLE
## Sovereign Intelligence Platform - Full Deployment Package

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ██╗  ██╗██╗   ██╗██████╗  ██████╗      ██████╗ ███████╗                      ║
║  ██║ ██╔╝██║   ██║██╔══██╗██╔═══██╗    ██╔═══██╗██╔════╝                      ║
║  █████╔╝ ██║   ██║██████╔╝██║   ██║    ██║   ██║███████╗                      ║
║  ██╔═██╗ ██║   ██║██╔══██╗██║   ██║    ██║   ██║╚════██║                      ║
║  ██║  ██╗╚██████╔╝██║  ██║╚██████╔╝    ╚██████╔╝███████║                      ║
║  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝      ╚═════╝ ╚══════╝                      ║
║                                                                               ║
║  v4.1 COMPLETE - All Modules Included                                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

## Bundle Contents (34 Files)

### 🔧 Core Server
| File | Description |
|------|-------------|
| `server.cjs` | **FIXED** - Express 5.x compatible (502 fix) |

### ⚡ Layer Modules (12 files) → `/layers/`
| Layer | File | Function |
|-------|------|----------|
| L0 | `iron_dome.js` | Threat detection, content filtering |
| L1 | `iff_gate.js` | Rate limiting, client identification |
| L2 | `edubba_archive.js` | Pattern matching, knowledge recall |
| L3 | `semantic_router.js` | Intent classification, temp selection |
| L4 | `memory.js` | Session history, context management |
| L6 | `fire_control.js` | SMASH targeting, safety checks |
| L6+ | `smash_protocol.js` | Extended fire control |
| L8 | `maat_refiner.js` | Truth weight, response refinement |
| L9 | `output_enhancer.js` | Response polishing |
| L10 | `thinking_stream.js` | Think block filtering, SSE |
| — | `bloodhound.js` | Asset recovery protocol |
| — | `harvester.js` | Data collection protocol |

### 🕶️ Shadow Protocols (5 files) → `/shadow/`
| File | Layer | Function |
|------|-------|----------|
| `config.js` | — | Feature flags, trust zones |
| `nephilimGate.js` | L0.25 | Advanced rate limiting, dead drops, onion routing |
| `babylonProtocol.js` | L1.5 | Content obfuscation, custom encoding |
| `mnemosyneCache.js` | L11 | Deniable encrypted storage |
| `ShadowVPN.js` | L11.5 | WireGuard VPN control |

### 🖥️ Frontend Components (14 files) → `/src/components/`

#### Core Components
| File | Description |
|------|-------------|
| `AppWindow.jsx` | Window container with drag/resize |
| `GlassDock.jsx` | macOS-style dock with auto-hide |
| `GlassPanel.jsx` | Start menu, app launcher |
| `DesktopBackground.jsx` | Void-kill animated background |
| `LoginScreen.jsx` | Auth screen |

#### Apps (`/apps/`)
| File | Description |
|------|-------------|
| `ExecutionerApp.jsx` | **MEGA** - TRUE_TONE, GlassEngine, TerminalText, all modals |
| `NetworkApp.jsx` | VPN control, DNS stats |
| `NetworkApp.css` | Network app styles |

#### Sovereign Components (`/sovereign/`)
| File | Description |
|------|-------------|
| `TrustZoneRail.jsx` | Trust zone indicator |
| `IntentCostRail.jsx` | Token/cost display |
| `AttestationBadge.jsx` | Signed/sealed badges |
| `ProvenanceOverlay.jsx` | Run provenance modal |
| `index.js` | Component exports |

#### 3D Components (`/3d/`)
| File | Description |
|------|-------------|
| `GlassEngine.jsx` | 3D model renderer (cube, pyramid, etc.) |

### 📦 Stores (`/src/stores/`)
| File | Description |
|------|-------------|
| `osStore.js` | **FIXED** - Window management (black screen fix) |

---

## Critical Fixes

### 1. 502 Bad Gateway (server.cjs)
```javascript
// OLD (broken in Express 5.x):
app.get('*', (req, res) => {...});

// NEW (fixed):
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  const idx = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Build not found');
});
```

### 2. Black Screen on Close/Minimize (osStore.js)
```javascript
// OLD closeApp - left isMaximized: true
closeApp: (appId) => {
  set((state) => ({
    windows: { ...state.windows, [appId]: { ...state.windows[appId], isOpen: false } }
  }));
},

// NEW closeApp - deletes entry entirely
closeApp: (appId) => {
  set((state) => {
    const newWindows = { ...state.windows };
    delete newWindows[appId];
    return { windows: newWindows, windowOrder: state.windowOrder.filter(id => id !== appId) };
  });
},
```

### 3. Maximize/Restore (osStore.js)
```javascript
// Now properly saves prevPosition/prevSize before maximizing
// and restores them on un-maximize
```

---

## Deployment

### One-Command Deploy
```bash
chmod +x DEPLOY.sh && ./DEPLOY.sh
```

### Manual Deploy
```bash
# 1. Upload server (FIXED)
scp server.cjs root@5.9.83.244:/var/www/kuro/ai-react/

# 2. Upload layers
scp layers/*.js root@5.9.83.244:/var/www/kuro/ai-react/

# 3. Upload shadow protocols
ssh root@5.9.83.244 "mkdir -p /var/www/kuro/ai-react/shadow"
scp shadow/*.js root@5.9.83.244:/var/www/kuro/ai-react/shadow/

# 4. Upload stores
scp src/stores/osStore.js root@5.9.83.244:/var/www/kuro/ai-react/src/stores/

# 5. Upload components
scp src/components/*.jsx root@5.9.83.244:/var/www/kuro/ai-react/src/components/
scp src/components/3d/*.jsx root@5.9.83.244:/var/www/kuro/ai-react/src/components/3d/
scp src/components/apps/* root@5.9.83.244:/var/www/kuro/ai-react/src/components/apps/
scp src/components/sovereign/* root@5.9.83.244:/var/www/kuro/ai-react/src/components/sovereign/

# 6. Build & Restart
ssh root@5.9.83.244 "cd /var/www/kuro/ai-react && npm run build && pm2 restart kuro-backend"
```

---

## API Endpoints

### Standard
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System status |
| `/api/validate` | POST | Token auth |
| `/api/stream` | POST | SSE chat stream |
| `/api/models` | GET | Model registry |
| `/api/files` | GET | File browser |
| `/api/memory/sessions` | GET | Session list |

### Network
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/network/vpn/status` | GET | WireGuard status |
| `/api/network/vpn/toggle` | POST | Connect/disconnect VPN |
| `/api/network/dns/stats` | GET | DNS query stats |
| `/api/network/protocols` | GET | Shadow protocol status |

### Shadow
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shadow/drop/deposit` | POST | Create dead drop |
| `/api/shadow/drop/retrieve` | POST | Retrieve dead drop |
| `/api/shadow/drops` | GET | List dead drops |
| `/api/shadow/encode` | POST | Babylon encode |
| `/api/shadow/decode` | POST | Babylon decode |
| `/api/shadow/cache/store` | POST | Mnemosyne store |
| `/api/shadow/cache/retrieve/:key` | GET | Mnemosyne retrieve |

### Sovereign
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sovereign/provenance/:runId` | GET | Run provenance |
| `/api/sovereign/session/:sessionId` | GET | Session metrics |

---

## Verification

```bash
# Health check
curl https://kuroglass.net/api/health

# Should return:
{
  "status": "ok",
  "version": "4.1.0-shadow",
  "modules": ["iron_dome", "iff_gate", "memory", ...],
  "shadow": ["nephilim_gate", "babylon_protocol", "mnemosyne_cache", "shadow_vpn"]
}

# Protocol status
curl https://kuroglass.net/api/network/protocols

# Test stream
curl -N -X POST https://kuroglass.net/api/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

---

## File Tree
```
KURO_COMPLETE/
├── server.cjs              # FIXED - Express 5.x compatible
├── DEPLOY.sh               # One-command deployment
├── README.md               # This file
│
├── layers/                 # 12 aerospace modules
│   ├── iron_dome.js
│   ├── iff_gate.js
│   ├── memory.js
│   ├── semantic_router.js
│   ├── fire_control.js
│   ├── smash_protocol.js
│   ├── edubba_archive.js
│   ├── maat_refiner.js
│   ├── output_enhancer.js
│   ├── thinking_stream.js
│   ├── bloodhound.js
│   └── harvester.js
│
├── shadow/                 # 5 shadow protocols
│   ├── config.js
│   ├── nephilimGate.js
│   ├── babylonProtocol.js
│   ├── mnemosyneCache.js
│   └── ShadowVPN.js
│
└── src/
    ├── stores/
    │   └── osStore.js      # FIXED - Window management
    │
    └── components/
        ├── AppWindow.jsx
        ├── GlassDock.jsx
        ├── GlassPanel.jsx
        ├── DesktopBackground.jsx
        ├── LoginScreen.jsx
        │
        ├── 3d/
        │   └── GlassEngine.jsx
        │
        ├── apps/
        │   ├── ExecutionerApp.jsx  # MEGA version
        │   ├── NetworkApp.jsx
        │   └── NetworkApp.css
        │
        └── sovereign/
            ├── index.js
            ├── TrustZoneRail.jsx
            ├── IntentCostRail.jsx
            ├── AttestationBadge.jsx
            └── ProvenanceOverlay.jsx
```

---

**Version:** 4.1.0-shadow  
**Date:** January 2025  
**Author:** Claude (Opus 4.5) + Henry (Operator)
