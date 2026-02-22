#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KURO::PREEMPT Deployment
# Speculative Pre-Inference Engine
# 
# SFTP these files to /tmp/kuro-preempt/ on 206.168.83.200:
#   - preempt_engine.cjs
#   - preempt_routes.cjs
#   - preempt_stream_patch.cjs
#   - usePreempt.js
#   - KUROCHAT_PREEMPT_PATCH.js  (reference only)
#
# Then run this script.
# ═══════════════════════════════════════════════════════════════

set -e
KURO_ROOT="/var/www/kuro/ai-react"
LAYERS_DIR="$KURO_ROOT/layers"
SRC_DIR="$KURO_ROOT/src/components/apps"
STAGE="/tmp/kuro-preempt"

echo "═══ KURO::PREEMPT Deploy ═══"

# 1. Ensure layers dir exists
mkdir -p "$LAYERS_DIR"

# 2. Copy backend modules
cp "$STAGE/preempt_engine.cjs" "$LAYERS_DIR/preempt_engine.cjs"
cp "$STAGE/preempt_routes.cjs" "$LAYERS_DIR/preempt_routes.cjs"
echo "[✓] Backend: preempt_engine + routes → $LAYERS_DIR"

# 3. Copy frontend hook
cp "$STAGE/usePreempt.js" "$SRC_DIR/usePreempt.js"
echo "[✓] Frontend: usePreempt.js → $SRC_DIR"

# 4. Wire preempt routes into server.cjs (idempotent)
cd "$KURO_ROOT"
if ! grep -q 'preempt_routes' server.cjs; then
  # Add require near top (after existing layer requires)
  sed -i '/^const express/a\
\n// PREEMPT: Speculative Pre-Inference\nlet mountPreemptRoutes;\ntry { mountPreemptRoutes = require("./layers/preempt_routes.cjs"); } catch(e) { mountPreemptRoutes = () => console.warn("[PREEMPT] Routes not loaded:", e.message); }' server.cjs

  # Mount routes (before SPA fallback / catch-all)
  # Find the last app.get or app.post before the static/SPA handler
  sed -i '/app\.use(express\.static/i\
// PREEMPT routes\ntry { mountPreemptRoutes(app, logEvent, MODELS); } catch(e) { console.warn("[PREEMPT] Mount failed:", e.message); }\n' server.cjs

  echo "[✓] server.cjs: preempt routes wired"
else
  echo "[○] server.cjs: preempt routes already present"
fi

# 5. Wire preempt claim into /api/stream handler
if ! grep -q 'preempt_engine' server.cjs; then
  # Add preempt engine require
  sed -i '/mountPreemptRoutes/a\
const preemptEngine = require("./layers/preempt_engine.cjs");' server.cjs

  echo "[✓] server.cjs: preempt engine required"
  echo ""
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║  MANUAL STEP: Wire claim into /api/stream handler        ║"
  echo "║                                                          ║"
  echo "║  See preempt_stream_patch.cjs for the exact code block   ║"
  echo "║  to insert after your layer pipeline, before Ollama POST ║"
  echo "║                                                          ║"
  echo "║  Also wire usePreempt into KuroChat.jsx per              ║"
  echo "║  KUROCHAT_PREEMPT_PATCH.js (3 small changes)             ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
else
  echo "[○] server.cjs: preempt engine already required"
fi

# 6. Build frontend
echo ""
echo "Building frontend..."
npm run build 2>&1 | tail -3

# 7. Restart backend
pm2 restart kuro-backend 2>/dev/null || pm2 start server.cjs --name kuro-backend
echo ""
pm2 logs kuro-backend --lines 8 --nostream

echo ""
echo "═══ KURO::PREEMPT Deployed ═══"
echo "Endpoints live:"
echo "  POST /api/preempt/speculate"
echo "  POST /api/preempt/abort"
echo "  POST /api/preempt/status"
echo ""
echo "Next: Wire the 3 KuroChat changes (see KUROCHAT_PREEMPT_PATCH.js)"
