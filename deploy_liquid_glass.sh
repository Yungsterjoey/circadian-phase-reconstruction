#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# KURO :: LIQUID GLASS ENGINE v2 — Deploy
# SFTP files to /tmp/lg/ on server first, then run this.
# ═══════════════════════════════════════════════════════════════════════
set -e
KURO="/var/www/kuro/ai-react"
STAMP=$(date +%Y%m%d-%H%M%S)

echo "╔═══════════════════════════════════════════════╗"
echo "║  KURO :: LIQUID GLASS v2 — Deploying...       ║"
echo "╚═══════════════════════════════════════════════╝"

# 1) Backup
echo "[1/6] Backup..."
mkdir -p "$KURO/src/backup-lg-$STAMP"
for f in liquid-glass.css; do
  [ -f "$KURO/src/$f" ] && cp "$KURO/src/$f" "$KURO/src/backup-lg-$STAMP/" 2>/dev/null || true
done
for f in LiquidGlassEngine.jsx ThemeProvider.jsx; do
  [ -f "$KURO/src/components/$f" ] && cp "$KURO/src/components/$f" "$KURO/src/backup-lg-$STAMP/" 2>/dev/null || true
done
echo "    ✓ Backups → src/backup-lg-$STAMP/"

# 2) CSS
echo "[2/6] Installing liquid-glass.css..."
cp /tmp/lg/liquid-glass.css "$KURO/src/liquid-glass.css"
echo "    ✓ src/liquid-glass.css"

# 3) React provider
echo "[3/6] Installing LiquidGlassEngine.jsx..."
cp /tmp/lg/LiquidGlassEngine.jsx "$KURO/src/components/LiquidGlassEngine.jsx"
echo "    ✓ src/components/LiquidGlassEngine.jsx"

# 4) Wire CSS import into main.jsx
echo "[4/6] Wiring CSS import..."
if ! grep -q "liquid-glass.css" "$KURO/src/main.jsx" 2>/dev/null; then
  # Insert after the last existing import line
  sed -i '/^import /!b;:a;n;/^import /ba;i\import "./liquid-glass.css";' "$KURO/src/main.jsx" 2>/dev/null || \
  sed -i '1i import "./liquid-glass.css";' "$KURO/src/main.jsx"
  echo "    ✓ Added CSS import to main.jsx"
else
  echo "    ○ CSS import already present"
fi

# 5) Wire LiquidGlassProvider into App.jsx if not present
echo "[5/6] Checking App.jsx wiring..."
if ! grep -q "LiquidGlassProvider" "$KURO/src/App.jsx" 2>/dev/null; then
  echo "    ⚠ LiquidGlassProvider NOT wired into App.jsx yet"
  echo "    Add manually:"
  echo '    import { LiquidGlassProvider } from "./components/LiquidGlassEngine";'
  echo '    Wrap root: <LiquidGlassProvider><KuroDesktop /></LiquidGlassProvider>'
else
  echo "    ✓ LiquidGlassProvider already in App.jsx"
fi

# 6) Build
echo "[6/6] Building..."
cd "$KURO"
npm run build 2>&1 | tail -5
pm2 restart kuro-backend 2>/dev/null && echo "    ✓ PM2 restarted" || echo "    ○ PM2 not running"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║  ✓ LIQUID GLASS v2 DEPLOYED                   ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "VERIFICATION:"
echo "  1. Open https://kuroglass.net in Chrome → check glass blur"
echo "  2. Open on iPhone Safari → confirm no jank on scroll"
echo "  3. DevTools → toggle prefers-reduced-motion → animations stop"
echo "  4. DevTools → toggle prefers-reduced-transparency → opaque fallback"
echo "  5. Check <html data-lg-perf='balanced'> is present"
echo ""
echo "USAGE:"
echo '  import { Glass, GlassToolbar, GlassWindow, GlassDock } from "./components/LiquidGlassEngine";'
echo ""
echo '  <Glass variant="regular" shape="panel" animate>'
echo '    <p>Content stays crisp</p>'
echo '  </Glass>'
echo ""
echo '  <Glass variant="tinted" tint="#ef4444" shape="pill">'
echo '    <span>Red tinted pill</span>'
echo '  </Glass>'
echo ""
echo "VARIANTS: regular | clear | tinted | frosted"
echo "SHAPES:   panel | pill | toolbar | dock | window | notification"
