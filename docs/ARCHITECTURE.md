# KURO Architecture

## Runtime Topology

- **server.cjs** — Express HTTP server (port from `KURO_PORT`, default 3000), single-process
- **kuro-v9-sandbox-patch/kuro-sandbox/index.js** — Code execution sidecar (port 3101, `127.0.0.1` only)
- **dist/** — Vite-compiled React SPA served as static files
- **SQLite** via better-sqlite3 at `$KURO_DATA/kuro.db`
- **Ollama** — local LLM inference at `$OLLAMA_HOST` (default `http://localhost:11434`)
- **VFS** — S3-backed per-user filesystem at `s3://$VFS_S3_BUCKET/users/{userId}/` (Phase 1)

## Key Entrypoints

| File | Role |
|------|------|
| `server.cjs` | HTTP router, auth middleware, all API routes (L0–L11 pipeline) |
| `src/App.jsx` | OS root: AppWindow, GlassDock, AuthGate, app component registry |
| `layers/auth/db.cjs` | SQLite schema (v4), prepared statements, migration runner |
| `layers/auth/auth_routes.cjs` | Session / OAuth / passkey / email-OTP endpoints |
| `layers/mcp_connectors.js` | Agent file read/exec/write with scope gating + audit trail |
| `layers/vfs/vfs_routes.cjs` | Phase 1 VFS API (`/api/vfs/*`) |
| `scripts/gen_context_pack.cjs` | Generates `docs/generated/` context pack |

## Layer Pipeline (L0–L11) — `POST /api/stream`

| Layer | File | Purpose |
|-------|------|---------|
| L0 | `iron_dome.js` | Rate limiting, IP banning, abuse detection |
| L1 | `guest_gate.js` | Anonymous session provisioning |
| L2 | RAG | Per-user vector retrieval (`edubba` / `mnemosyne` namespace) |
| L3 | `context_reactor.js` | Dynamic context injection (time, profile, tools) |
| L4 | `bloodhound.js` | Debug / trace mode for dev clients |
| L5 | `iff_gate.js` | Identity / intent / flag classification |
| L6 | `voter_layer.js` | Multi-model consensus voting (optional) |
| L7 | `thinking_stream.js` | Extended reasoning (Claude extended thinking) |
| L8 | `frontier_assist.js` | Anthropic API fallback when Ollama unavailable |
| L9 | `output_enhancer.js` | Artifact extraction, table rendering, code blocks |
| L10 | `audit_chain.js` | Tamper-evident event log append |
| L11 | `shadow/mnemosyneCache.js` | Per-user conversation memory persistence |

## Data Layout (`$KURO_DATA` = `/var/lib/kuro`)

```
$KURO_DATA/
  kuro.db           # SQLite (auth, sessions, subscriptions, VFS metadata)
  uploads/          # Legacy per-user flat uploads (Phase 0; VFS supersedes)
    {userId}/
  vectors/          # Per-user RAG vector stores
    {userId}/
      edubba.json
      mnemosyne.json
  patches/          # Agent write staging area (mcp_connectors write fence)
  audit/            # Tamper-evident audit log (append-only)
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `KURO_DATA` | `/var/lib/kuro` | Data root |
| `KURO_PORT` | `3000` | HTTP listen port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API base URL |
| `KURO_SANDBOX_TIMEOUT_SECONDS` | `60` | Hard sandbox kill timeout |
| `KURO_ENABLE_LEGACY_TOKEN` | — | Gate for legacy bearer token auth |
| `VFS_BACKEND` | `s3` | VFS backend (`s3` \| `nextcloud`) |
| `VFS_S3_BUCKET` | — | S3 bucket name (required for VFS) |
| `VFS_S3_REGION` | `us-east-1` | S3 region |
| `VFS_S3_ENDPOINT` | — | Custom endpoint (MinIO, Cloudflare R2) |
| `VFS_S3_ACCESS_KEY_ID` | — | S3 credentials (uses IAM if absent) |
| `VFS_S3_SECRET_ACCESS_KEY` | — | S3 credentials |
| `KURO_ADMIN_EMAIL` | — | Auto-promote this email to admin on first login |
