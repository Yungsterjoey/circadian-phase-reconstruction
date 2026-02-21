#!/usr/bin/env node
/**
 * KURO Context Pack Generator
 * Produces docs/generated/{TREE,ROUTES,TOOLS,LAYERS,SANDBOX,DB}.md
 *
 * Usage:
 *   node scripts/gen_context_pack.cjs            # writes to docs/generated/
 *   node scripts/gen_context_pack.cjs ./out       # custom output dir
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'docs', 'generated'));

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function write(name, content) {
  fs.writeFileSync(path.join(OUT_DIR, name), content);
  console.log(`[gen] ${name} (${content.length} bytes)`);
}

// ─── TREE.md ────────────────────────────────────────────────────────────────

function genTree() {
  const IGNORE = new Set([
    '.git', 'node_modules', 'dist', '_legacy_import',
    'kuro-v9-sandbox-patch', 'oldkuro', '.claude',
  ]);
  const lines = ['# KURO Directory Tree', '', '> Auto-generated. Run: `node scripts/gen_context_pack.cjs`', ''];

  function walk(dir, prefix, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    entries = entries
      .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (let i = 0; i < entries.length; i++) {
      const e    = entries[i];
      const last = i === entries.length - 1;
      lines.push(prefix + (last ? '└── ' : '├── ') + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + (last ? '    ' : '│   '), depth + 1);
    }
  }

  walk(ROOT, '', 0);
  return lines.join('\n');
}

// ─── ROUTES.md ──────────────────────────────────────────────────────────────

function genRoutes() {
  const serverPath = path.join(ROOT, 'server.cjs');
  const src = fs.readFileSync(serverPath, 'utf8');
  const lines = ['# KURO API Routes', '', '> Auto-generated from server.cjs.', ''];

  const routeRe = /app\.(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`\n]+)['"`]/gi;
  let m;
  const routes = [];
  while ((m = routeRe.exec(src)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }

  const groups = {};
  for (const r of routes) {
    const prefix = r.path.split('/').slice(0, 3).join('/') || '/';
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(r);
  }

  for (const [prefix, rs] of Object.entries(groups).sort()) {
    lines.push(`## ${prefix}`, '');
    for (const r of rs) lines.push(`- \`${r.method} ${r.path}\``);
    lines.push('');
  }

  lines.push('## /api/vfs (VFS — Phase 1)', '');
  lines.push('- `GET    /api/vfs/list?path=`           — list directory');
  lines.push('- `GET    /api/vfs/read?path=`           — read file (raw bytes)');
  lines.push('- `POST   /api/vfs/write`                — write file `{path, content, encoding?, mimeType?}`');
  lines.push('- `POST   /api/vfs/mkdir`                — create directory `{path}`');
  lines.push('- `DELETE /api/vfs/rm?path=&recursive=`  — remove');
  lines.push('- `POST   /api/vfs/mv`                   — move/rename `{src, dst}`');
  lines.push('- `GET    /api/vfs/stat?path=`           — stat');
  lines.push('- `GET    /api/vfs/quota`                — quota usage');
  lines.push('');

  return lines.join('\n');
}

// ─── TOOLS.md ───────────────────────────────────────────────────────────────

function genTools() {
  const lines = ['# KURO Tool Bindings', ''];

  lines.push('## Connector Tools (`layers/mcp_connectors.js`)', '');
  lines.push('| Tool | Description | Min Scope |');
  lines.push('|------|-------------|-----------|');
  lines.push('| `read`   | Read file content (secrets redacted) | `insights` |');
  lines.push('| `write`  | Stage file write to `$KURO_DATA/patches/` | `actions` |');
  lines.push('| `exec`   | Execute whitelisted binary with audited args | `actions` |');
  lines.push('| `search` | Full-text search in allowed directories | `analysis` |');
  lines.push('');

  lines.push('## VFS Tools (`layers/tools/vfs_tools.cjs`)', '');
  lines.push('| Tool | Description |');
  lines.push('|------|-------------|');
  lines.push('| `vfs_list`  | List directory in user VFS |');
  lines.push('| `vfs_read`  | Read file from user VFS |');
  lines.push('| `vfs_write` | Write file to user VFS |');
  lines.push('| `vfs_mkdir` | Create directory |');
  lines.push('| `vfs_rm`    | Remove file or directory |');
  lines.push('');

  lines.push('## Read Scope Ladder', '');
  lines.push('| Scope | Allowed Paths |');
  lines.push('|-------|--------------|');
  lines.push('| `insights` | `docs/`, `uploads/`, `vectors/` |');
  lines.push('| `analysis` | above + `sessions/` |');
  lines.push('| `actions`  | entire `$KURO_DATA/`, `$KURO_CODE/` |');
  lines.push('');
  lines.push('Denied always: `/etc/kuro`, `audit/`, `/root`, `/home`, `/etc/shadow`');
  lines.push('');

  return lines.join('\n');
}

// ─── LAYERS.md ──────────────────────────────────────────────────────────────

function genLayers() {
  const lines = ['# KURO Layer Pipeline', '', '`POST /api/stream` executes L0–L11 in sequence.', ''];

  const LAYERS = [
    ['L0',  'iron_dome.js',           'Rate limiting, IP banning, abuse detection'],
    ['L1',  'guest_gate.js',          'Anonymous session provisioning'],
    ['L2',  '(inline RAG)',           'Per-user vector retrieval (edubba / mnemosyne namespace)'],
    ['L3',  'context_reactor.js',     'Dynamic context injection (time, user profile, tools)'],
    ['L4',  'bloodhound.js',          'Debug / trace mode for dev clients'],
    ['L5',  'iff_gate.js',            'Identity / intent / flag classification'],
    ['L6',  'voter_layer.js',         'Multi-model consensus voting (optional)'],
    ['L7',  'thinking_stream.js',     'Extended reasoning (Claude extended thinking)'],
    ['L8',  'frontier_assist.js',     'Anthropic API fallback when Ollama unavailable'],
    ['L9',  'output_enhancer.js',     'Artifact extraction, table rendering, code blocks'],
    ['L10', 'audit_chain.js',         'Tamper-evident event log append'],
    ['L11', 'shadow/mnemosyneCache.js','Per-user conversation memory persistence'],
  ];

  lines.push('| Layer | File | Purpose |');
  lines.push('|-------|------|---------|');
  for (const [l, f, p] of LAYERS) lines.push(`| ${l} | \`layers/${f}\` | ${p} |`);
  lines.push('');

  lines.push('## Context Router (`layers/tools/context_router.cjs`)', '');
  lines.push('Maps Gemma-classified intent → relevant context pack sections:');
  lines.push('');
  lines.push('| Intent | Context Sections |');
  lines.push('|--------|-----------------|');
  lines.push('| `auth`      | ARCHITECTURE, INTERFACES#auth-endpoints |');
  lines.push('| `vfs`       | INTERFACES#vfs-endpoints, PHASES#phase-1, generated/DB.md |');
  lines.push('| `sandbox`   | generated/SANDBOX.md, ARCHITECTURE#layer-pipeline |');
  lines.push('| `security`  | SECURITY.md |');
  lines.push('| `agent`     | generated/TOOLS.md, generated/LAYERS.md |');
  lines.push('| `database`  | generated/DB.md |');
  lines.push('| `routes`    | generated/ROUTES.md, INTERFACES.md |');
  lines.push('| `general`   | ARCHITECTURE.md |');
  lines.push('');

  return lines.join('\n');
}

// ─── SANDBOX.md ─────────────────────────────────────────────────────────────

function genSandbox() {
  const lines = ['# KURO Sandbox', ''];

  lines.push('## Overview', '');
  lines.push('Isolated Python code execution sidecar. Listens on `127.0.0.1:3101`. **Never expose to internet.**', '');

  lines.push('## HTTP Interface', '');
  lines.push('```');
  lines.push('POST /run    { workspacePath, entrypoint, budgets, runDir }  →  { runId, status }');
  lines.push('GET  /run/:id                                                →  { status, exitCode, stdout, stderr, artifacts }');
  lines.push('GET  /health                                                 →  { status, docker, active, maxConcurrent }');
  lines.push('```', '');

  lines.push('## Isolation Layers', '');
  lines.push('**Docker (primary):**');
  lines.push('`--network=none --read-only --memory {N}m --memory-swap {N}m --cpus 1 --pids-limit 64`');
  lines.push('`--ulimit nofile=256:256 --security-opt no-new-privileges`', '');
  lines.push('**Firejail (fallback):**');
  lines.push('`--net=none --noroot --rlimit-as={bytes} --timeout=HH:MM:SS --read-only={workspace}`', '');

  lines.push('## Resource Budgets (defaults)', '');
  lines.push('| Budget | Default |');
  lines.push('|--------|---------|');
  lines.push('| `max_runtime_seconds` | 30 |');
  lines.push('| `max_memory_mb` | 256 |');
  lines.push('| `max_output_bytes` | 1 048 576 (1 MB) |');
  lines.push('| `max_workspace_bytes` | 52 428 800 (50 MB) |');
  lines.push('');
  lines.push('Hard cap: `KURO_SANDBOX_TIMEOUT_SECONDS` (env, default 60 s). Node.js `setTimeout` + `SIGKILL` enforces it independently of the runner. Logs `SANDBOX_TIMEOUT_KILL` security event.', '');

  lines.push('## Artifact Allowlist', '');
  lines.push('`.txt .md .html .htm .csv .json .xml .py .js .ts .css .svg .png .jpg .jpeg .gif .webp .bmp .pdf .log`', '');

  return lines.join('\n');
}

// ─── DB.md ──────────────────────────────────────────────────────────────────

function genDB() {
  const lines = ['# KURO Database Schema', '', 'SQLite via better-sqlite3. WAL mode. Path: `$KURO_DATA/kuro.db`.', ''];

  const tables = [
    { name: 'users',         ver: 1, desc: 'User accounts. Cols: id, email, name, password_hash, tier (free/pro/sovereign), is_admin (v3)' },
    { name: 'sessions',      ver: 1, desc: 'Active sessions. Cols: id, user_id, expires_at, ip, user_agent' },
    { name: 'oauth_accounts',ver: 1, desc: 'OAuth links. Cols: user_id, provider, provider_id, display_name (v2), avatar_url (v2)' },
    { name: 'passkeys',      ver: 1, desc: 'WebAuthn credentials. Cols: id, user_id, public_key BLOB, counter' },
    { name: 'email_otps',    ver: 1, desc: 'Email OTP codes. Cols: user_id, code, expires_at, used, attempts' },
    { name: 'subscriptions', ver: 1, desc: 'Stripe subscriptions. Cols: id, user_id, stripe_customer_id, status, tier' },
    { name: 'kuro_tokens',   ver: 1, desc: 'Legacy bearer tokens (gated by KURO_ENABLE_LEGACY_TOKEN)' },
    { name: 'usage',         ver: 1, desc: 'Weekly usage counters. Cols: user_id, action, week_num, count' },
    { name: 'stripe_events', ver: 1, desc: 'Idempotency log for Stripe webhook events' },
    { name: 'vfs_files',     ver: 4, desc: 'VFS file metadata. Cols: id, user_id, path, size, mime_type, backend, s3_key, is_dir. UNIQUE(user_id, path)' },
    { name: 'vfs_quotas',    ver: 4, desc: 'Per-user storage quotas. Cols: user_id PK, limit_bytes, used_bytes' },
    { name: 'projects',      ver: 4, desc: 'Project containers. Cols: id, user_id, name, vfs_path, meta (JSON)' },
  ];

  lines.push('## Tables', '');
  lines.push('| Table | Since | Description |');
  lines.push('|-------|-------|-------------|');
  for (const t of tables) lines.push(`| \`${t.name}\` | v${t.ver} | ${t.desc} |`);
  lines.push('');

  lines.push('## Migration Pattern', '');
  lines.push('- `SCHEMA_VERSION` constant in `layers/auth/db.cjs`');
  lines.push('- `if (current < N) { ... CREATE TABLE IF NOT EXISTS ... ALTER TABLE ... }` blocks');
  lines.push('- Idempotent: wrapped in try/catch for ALTER statements');
  lines.push('- Version committed with `db.pragma(\'user_version = N\')`');
  lines.push('');
  lines.push('**Current version: 4**');

  return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const tasks = [
  ['TREE.md',    genTree],
  ['ROUTES.md',  genRoutes],
  ['TOOLS.md',   genTools],
  ['LAYERS.md',  genLayers],
  ['SANDBOX.md', genSandbox],
  ['DB.md',      genDB],
];

let errors = 0;
for (const [name, gen] of tasks) {
  try {
    write(name, gen());
  } catch (e) {
    console.error(`[gen] ERROR generating ${name}: ${e.message}`);
    errors++;
  }
}

console.log(`\n[gen] Context pack written to: ${OUT_DIR}`);
if (errors > 0) { console.error(`[gen] ${errors} error(s) occurred`); process.exit(1); }
