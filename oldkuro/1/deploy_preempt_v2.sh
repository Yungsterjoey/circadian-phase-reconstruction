#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KURO::PREEMPT v2 — Hardened Deployment
# All 8 RT issues addressed
#
# SFTP the v2/ folder to /tmp/kuro-preempt/ on 206.168.83.200
# Then: bash /tmp/kuro-preempt/deploy_preempt_v2.sh
# ═══════════════════════════════════════════════════════════════

set -e
KURO_ROOT="/var/www/kuro/ai-react"
LAYERS="$KURO_ROOT/layers"
APPS="$KURO_ROOT/src/components/apps"
STAGE="/tmp/kuro-preempt"

echo "═══ KURO::PREEMPT v2 Deploy ═══"
echo ""

# 1. Backup
echo "[1/6] Backup..."
cp "$KURO_ROOT/server.cjs" "$KURO_ROOT/server.cjs.bak.$(date +%s)"

# 2. Deploy backend
mkdir -p "$LAYERS"
cp "$STAGE/preempt_engine.cjs" "$LAYERS/"
cp "$STAGE/preempt_routes.cjs" "$LAYERS/"
cp "$STAGE/preempt_stream.cjs" "$LAYERS/"
echo "[2/6] Backend layers deployed"

# 3. Deploy frontend hook
cp "$STAGE/usePreempt.js" "$APPS/"
echo "[3/6] Frontend hook deployed"

# 4. Wire requires into server.cjs (idempotent)
cd "$KURO_ROOT"
if ! grep -q 'preempt_engine' server.cjs; then

cat > /tmp/preempt_require_patch.js << 'PATCH'

// ═══ KURO::PREEMPT v2 ═══
let mountPreemptRoutes, preemptStream;
try { mountPreemptRoutes = require('./layers/preempt_routes.cjs'); } catch(e) { mountPreemptRoutes = () => console.warn('[PREEMPT] Routes not loaded:', e.message); }
try { preemptStream = require('./layers/preempt_stream.cjs'); } catch(e) { preemptStream = { streamWithPreempt: null }; }
PATCH

  # Insert after first require block (find 'const express' line)
  sed -i '/^const express/r /tmp/preempt_require_patch.js' server.cjs
  rm /tmp/preempt_require_patch.js
  echo "[4/6] Requires wired into server.cjs"
else
  echo "[4/6] Requires already present — skipping"
fi

# 5. Mount routes (idempotent)
if ! grep -q 'mountPreemptRoutes' server.cjs | grep -q 'validateToken'; then

cat > /tmp/preempt_mount_patch.js << 'PATCH'

// PREEMPT v2 routes (auth enforced)
try {
  // RT-03: Pass validateToken + RT-06: Pass getSessionContext
  // Adapt these function names to match your server.cjs
  const _validateToken = typeof validateToken === 'function' ? validateToken : (t) => {
    const tokens = require('./data/tokens.json').tokens || {};
    return tokens[t] ? { valid: true, user: tokens[t] } : { valid: false };
  };
  const _getSessionContext = async (sid) => {
    const fs = require('fs');
    const p = require('path').join(__dirname, 'data', 'sessions', sid + '.json');
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      return (d.messages || []).slice(-6);
    }
    return [];
  };
  mountPreemptRoutes(app, logEvent, MODELS, _validateToken, _getSessionContext);
} catch(e) { console.warn('[PREEMPT] Mount failed:', e.message); }
PATCH

  # Insert before static file serving
  sed -i '/app\.use(express\.static/r /tmp/preempt_mount_patch.js' server.cjs
  rm /tmp/preempt_mount_patch.js
  echo "[5/6] Routes mounted with auth + session context"
else
  echo "[5/6] Routes already mounted — skipping"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  MANUAL STEP: Wire preempt into /api/stream handler      ║"
echo "║                                                          ║"
echo "║  In your /api/stream POST handler, AFTER layers but      ║"
echo "║  BEFORE the Ollama POST, replace the Ollama call with:   ║"
echo "║                                                          ║"
echo "║  if (preemptStream.streamWithPreempt) {                  ║"
echo "║    await preemptStream.streamWithPreempt({               ║"
echo "║      req, res, sessionId, userMessage,                   ║"
echo "║      chatMessages, model: MODELS[mode],                  ║"
echo "║      ollamaUrl: OLLAMA_URL, ollamaOptions                ║"
echo "║    });                                                   ║"
echo "║    return;                                               ║"
echo "║  }                                                       ║"
echo "║                                                          ║"
echo "║  Then in KuroChat.jsx add 3 lines (see patch file).      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# 6. Build + restart
echo "[6/6] Building frontend..."
npm run build 2>&1 | tail -3
pm2 restart kuro-backend 2>/dev/null || pm2 start server.cjs --name kuro-backend
echo ""
pm2 logs kuro-backend --lines 10 --nostream

echo ""
echo "═══ KURO::PREEMPT v2 LIVE ═══"
echo ""
echo "RT-01 ✓ Max 3 concurrent speculations, 2s cooldown"
echo "RT-02 ✓ 0.75 threshold, superset-only claiming"  
echo "RT-03 ✓ X-KURO-Token required on all endpoints"
echo "RT-04 ✓ Fresh inference + dedup (no continuation prompt)"
echo "RT-05 ✓ Buffer snapshot before abort"
echo "RT-06 ✓ Server-side session lookup (no client messages)"
echo "RT-07 ✓ SIGINT/SIGTERM graceful shutdown"
echo "RT-08 ✓ Safari-safe fetch, sendBeacon for abort"
echo ""
echo "Endpoints:"
echo "  POST /api/preempt/speculate (auth required)"
echo "  POST /api/preempt/abort     (auth required)"
