#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# KURO OS v4.1 COMPLETE DEPLOYMENT
# Sovereign Intelligence Platform
# ═══════════════════════════════════════════════════════════════════════════

set -e

SERVER="root@5.9.83.244"
REMOTE_PATH="/var/www/kuro/ai-react"

echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║  KURO OS v4.1 - COMPLETE DEPLOYMENT                                           ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"

# Create all directories
echo "[1/8] Creating directory structure..."
ssh $SERVER "mkdir -p $REMOTE_PATH/shadow $REMOTE_PATH/src/components/apps $REMOTE_PATH/src/components/sovereign $REMOTE_PATH/src/components/3d $REMOTE_PATH/src/stores /var/www/kuro/data/shadow/drops /var/www/kuro/data/shadow/cache /var/www/kuro/data/sessions"

# Upload server (FIXED - Express 5.x compatible)
echo "[2/8] Uploading server.cjs (fixed wildcard route)..."
scp server.cjs $SERVER:$REMOTE_PATH/

# Upload ALL layer modules (aerospace)
echo "[3/8] Uploading layer modules (12 files)..."
scp layers/*.js $SERVER:$REMOTE_PATH/

# Upload shadow protocols
echo "[4/8] Uploading shadow protocols (5 files)..."
scp shadow/*.js $SERVER:$REMOTE_PATH/shadow/

# Upload stores (FIXED osStore)
echo "[5/8] Uploading stores (fixed window management)..."
scp src/stores/*.js $SERVER:$REMOTE_PATH/src/stores/

# Upload components
echo "[6/8] Uploading components..."
scp src/components/*.jsx $SERVER:$REMOTE_PATH/src/components/
scp src/components/3d/*.jsx $SERVER:$REMOTE_PATH/src/components/3d/
scp src/components/apps/*.jsx src/components/apps/*.css $SERVER:$REMOTE_PATH/src/components/apps/
scp src/components/sovereign/*.jsx src/components/sovereign/*.js $SERVER:$REMOTE_PATH/src/components/sovereign/

# Rebuild
echo "[7/8] Building frontend..."
ssh $SERVER "cd $REMOTE_PATH && npm run build"

# Restart
echo "[8/8] Restarting backend..."
ssh $SERVER "pm2 restart kuro-backend"

echo ""
echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║  DEPLOYMENT COMPLETE                                                          ║"
echo "╠═══════════════════════════════════════════════════════════════════════════════╣"
echo "║  Layers:  12 modules (iron_dome → feedback_loop)                              ║"
echo "║  Shadow:   5 protocols (nephilim, babylon, mnemosyne, vpn, config)            ║"
echo "║  UI:      14 components (including ExecutionerApp MEGA)                       ║"
echo "║  Fixes:   server.cjs (502), osStore.js (black screen)                         ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Verify: curl https://kuroglass.net/api/health"
echo "Logs:   ssh $SERVER 'pm2 logs kuro-backend --lines 50'"
