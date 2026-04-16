'use strict';

const fs = require('fs');
const path = require('path');

const GRAB_DIR = __dirname;
const CONFIG_PATH = path.join(GRAB_DIR, 'grab_config.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function findHarFile() {
  const arg = process.argv[2];
  if (arg) {
    const resolved = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(resolved)) throw new Error('HAR file not found: ' + resolved);
    return resolved;
  }
  const files = fs.readdirSync(GRAB_DIR).filter(f => f.endsWith('.har'));
  if (files.length === 0) throw new Error('No .har file found in ' + GRAB_DIR + ' — drop one there or pass path as argument');
  if (files.length > 1) console.warn('[HAR_IMPORT] Multiple .har files found, using first:', files[0]);
  return path.join(GRAB_DIR, files[0]);
}

function normalisePathPattern(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
      .replace(/\/\d{4,}/g, '/:id');
  } catch {
    return rawUrl;
  }
}

function headerValue(headers, name) {
  const lc = name.toLowerCase();
  const found = (headers || []).find(h => h.name.toLowerCase() === lc);
  return found ? found.value : null;
}

function inferEndpointKey(pattern) {
  const p = pattern.toLowerCase();
  if (p.includes('token') || p.includes('refresh') || p.includes('oauth')) return 'token_refresh';
  if (p.includes('tracking') || p.includes('realtime') || p.includes('live')) return 'tracking_ws';
  if (p.includes('wallet') || p.includes('balance') || p.includes('payment')) return 'wallet';
  if (p.includes('food') || p.includes('meal') || p.includes('restaurant') || p.includes('merchant')) return 'food_orders';
  if (p.includes('ride') || p.includes('booking') || p.includes('trip') || p.includes('driver')) return 'rides';
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function run() {
  const harPath = findHarFile();
  console.log('[HAR_IMPORT] Reading:', harPath);

  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const allEntries = (har.log || har).entries || [];

  const grabEntries = allEntries.filter(
    e => e.request && e.request.url && e.request.url.includes('api.grab.com')
  );

  console.log(`[HAR_IMPORT] Total HAR entries: ${allEntries.length} | Grab entries: ${grabEntries.length}`);

  if (grabEntries.length === 0) {
    console.error('[HAR_IMPORT] FAIL: No entries matching api.grab.com found in HAR file');
    process.exit(1);
  }

  // Group by normalised path pattern, deduplicate
  const patternMap = {};
  for (const entry of grabEntries) {
    const pattern = normalisePathPattern(entry.request.url);
    if (!patternMap[pattern]) {
      patternMap[pattern] = { url: entry.request.url, count: 0, entry };
    }
    patternMap[pattern].count++;
  }

  // Extract auth.access_token from first entry with Authorization header
  let accessToken = '';
  for (const entry of grabEntries) {
    const authHeader = headerValue(entry.request.headers, 'authorization');
    if (authHeader) {
      accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      break;
    }
  }

  // Extract x-grab-* headers (union across all entries)
  const grabHeaders = {};
  for (const entry of grabEntries) {
    for (const h of (entry.request.headers || [])) {
      if (h.name.toLowerCase().startsWith('x-grab-')) {
        grabHeaders[h.name] = h.value;
      }
    }
  }

  // Extract User-Agent
  let userAgent = '';
  for (const entry of grabEntries) {
    const ua = headerValue(entry.request.headers, 'user-agent');
    if (ua) { userAgent = ua; break; }
  }

  // Extract refresh token from token endpoint response body
  let refreshToken = '';
  for (const entry of grabEntries) {
    const url = entry.request.url.toLowerCase();
    if (url.includes('token') || url.includes('refresh') || url.includes('oauth')) {
      try {
        const text = (entry.response.content || {}).text;
        if (text) {
          const body = JSON.parse(text);
          refreshToken = body.refresh_token || body.refreshToken
            || (body.token && body.token.refresh_token) || '';
          if (refreshToken) break;
        }
      } catch { /* skip unparseable response */ }
    }
  }

  // Auto-populate endpoint registry (first match per key wins)
  const endpoints = {};
  for (const [pattern, info] of Object.entries(patternMap)) {
    const key = inferEndpointKey(pattern);
    if (key && !endpoints[key]) {
      endpoints[key] = info.url;
    }
  }

  // Load and update config
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.endpoints = Object.assign({ rides: '', food_orders: '', wallet: '', tracking_ws: '', token_refresh: '' }, config.endpoints, endpoints);
  config.auth.access_token  = accessToken  || config.auth.access_token;
  config.auth.refresh_token = refreshToken || config.auth.refresh_token;
  config.auth.user_agent    = userAgent    || config.auth.user_agent;
  config.headers = Object.assign({}, config.headers, grabHeaders);

  // ── Summary table ─────────────────────────────────────────────────────────
  const W = 62;
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const row = (label, val) => `║ ${pad(label, 22)} ${pad(val, W - 26)} ║`;

  console.log('\n╔' + '═'.repeat(W) + '╗');
  console.log('║' + ' KURO::GRAB  HAR Import Summary'.padEnd(W) + '║');
  console.log('╠' + '═'.repeat(W) + '╣');
  console.log(row('Total HAR entries', allEntries.length));
  console.log(row('Grab entries',       grabEntries.length));
  console.log(row('Unique path patterns', Object.keys(patternMap).length));
  console.log(row('access_token',  accessToken  ? 'FOUND' : 'NOT FOUND'));
  console.log(row('refresh_token', refreshToken ? 'FOUND' : 'NOT FOUND'));
  console.log(row('x-grab-* headers', Object.keys(grabHeaders).length + ' keys'));
  console.log('╠' + '═'.repeat(W) + '╣');
  console.log('║' + ' Discovered Endpoints:'.padEnd(W) + '║');
  for (const [pattern, info] of Object.entries(patternMap)) {
    const key = inferEndpointKey(pattern) || '(unmapped)';
    const line = `  [${key}]  ${pattern}`;
    console.log('║ ' + pad(line, W - 2) + ' ║');
  }
  console.log('╚' + '═'.repeat(W) + '╝\n');

  // Write config atomically
  const tmp = CONFIG_PATH + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  console.log('[HAR_IMPORT] Config written to', CONFIG_PATH);

  // ── PASS / FAIL gate ──────────────────────────────────────────────────────
  const missing = [];
  if (!config.auth.access_token)  missing.push('auth.access_token');
  if (!config.auth.refresh_token) missing.push('auth.refresh_token');

  if (missing.length > 0) {
    console.error('[HAR_IMPORT] FAIL: missing required fields: ' + missing.join(', '));
    console.error('[HAR_IMPORT] Re-run after ensuring the HAR file contains authenticated Grab API calls with Authorization headers.');
    process.exit(1);
  }

  console.log('[HAR_IMPORT] PASS: access_token populated, config ready.');
}

run();
