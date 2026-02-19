#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# KURO OS v4.0 FINAL - DEPLOYMENT SCRIPT
# ═══════════════════════════════════════════════════════════════════════════════

set -e

PROJECT="/var/www/kuro/ai-react"
BACKUP="/var/www/kuro/backups/$(date +%Y%m%d_%H%M%S)"
DOWNLOAD="$HOME/Downloads/FINAL"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  KURO OS v4.0 FINAL DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# BACKUP
# ═══════════════════════════════════════════════════════════════════════════════
echo "[1/5] Creating backup..."
mkdir -p "$BACKUP"
cd "$PROJECT"

[ -f server.cjs ] && cp server.cjs "$BACKUP/"
for f in iron_dome.js iff_gate.js memory.js semantic_router.js fire_control.js \
         smash_protocol.js edubba_archive.js maat_refiner.js output_enhancer.js \
         thinking_stream.js bloodhound.js harvester.js; do
  [ -f "$f" ] && cp "$f" "$BACKUP/"
done

mkdir -p "$BACKUP/src"
[ -d src/components ] && cp -r src/components "$BACKUP/src/"
[ -d src/stores ] && cp -r src/stores "$BACKUP/src/"

echo "  ✓ Backup: $BACKUP"

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY SERVER MODULES
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "[2/5] Deploying server modules..."

cp "$DOWNLOAD/server.cjs" "$PROJECT/"
echo "  ✓ server.cjs"

for f in iron_dome.js iff_gate.js memory.js semantic_router.js fire_control.js \
         smash_protocol.js edubba_archive.js maat_refiner.js output_enhancer.js \
         thinking_stream.js bloodhound.js harvester.js; do
  [ -f "$DOWNLOAD/$f" ] && cp "$DOWNLOAD/$f" "$PROJECT/" && echo "  ✓ $f"
done

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY FRONTEND
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "[3/5] Deploying frontend..."

mkdir -p "$PROJECT/src/components/apps"
mkdir -p "$PROJECT/src/components/3d"
mkdir -p "$PROJECT/src/stores"

[ -f "$DOWNLOAD/src/components/apps/ExecutionerApp.jsx" ] && \
  cp "$DOWNLOAD/src/components/apps/ExecutionerApp.jsx" "$PROJECT/src/components/apps/" && \
  echo "  ✓ ExecutionerApp.jsx"

[ -f "$DOWNLOAD/src/components/GlassDock.jsx" ] && \
  cp "$DOWNLOAD/src/components/GlassDock.jsx" "$PROJECT/src/components/" && \
  echo "  ✓ GlassDock.jsx"

[ -f "$DOWNLOAD/src/components/GlassPanel.jsx" ] && \
  cp "$DOWNLOAD/src/components/GlassPanel.jsx" "$PROJECT/src/components/" && \
  echo "  ✓ GlassPanel.jsx"

[ -f "$DOWNLOAD/src/components/DesktopBackground.jsx" ] && \
  cp "$DOWNLOAD/src/components/DesktopBackground.jsx" "$PROJECT/src/components/" && \
  echo "  ✓ DesktopBackground.jsx"

[ -f "$DOWNLOAD/src/components/AppWindow.jsx" ] && \
  cp "$DOWNLOAD/src/components/AppWindow.jsx" "$PROJECT/src/components/" && \
  echo "  ✓ AppWindow.jsx"

[ -f "$DOWNLOAD/src/components/3d/GlassEngine.jsx" ] && \
  cp "$DOWNLOAD/src/components/3d/GlassEngine.jsx" "$PROJECT/src/components/3d/" && \
  echo "  ✓ 3d/GlassEngine.jsx"

[ -f "$DOWNLOAD/src/stores/osStore.js" ] && \
  cp "$DOWNLOAD/src/stores/osStore.js" "$PROJECT/src/stores/" && \
  echo "  ✓ osStore.js"

# ═══════════════════════════════════════════════════════════════════════════════
# BUILD
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "[4/5] Building..."
cd "$PROJECT"
npx vite build
echo "  ✓ Build complete"

# ═══════════════════════════════════════════════════════════════════════════════
# RESTART
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "[5/5] Restarting..."
pm2 restart kuro-backend
echo "  ✓ Backend restarted"

# ═══════════════════════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Backup: $BACKUP"
echo ""
echo "  Restore: cp $BACKUP/* $PROJECT/ && cp -r $BACKUP/src/* $PROJECT/src/"
echo ""
echo "  Verify: curl https://kuroglass.net/api/health"
echo ""

# Quick test
sleep 2
echo "  Testing..."
curl -s https://kuroglass.net/api/health 2>/dev/null || echo "  (API not responding yet - wait a moment)"
echo ""
