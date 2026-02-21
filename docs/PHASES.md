# KURO Phase Plan

## Phase 0 — Security Hardening ✅

**Status:** Complete (commit `42ef8ef`)

### Acceptance Criteria

- [x] Auth fail-hard: `process.exit(1)` in prod, 503 blocker in dev if auth layer fails
- [x] Per-user upload isolation: `uploads/{userId}/{filename}`
- [x] Vector store namespace isolation: factory pattern, per-user `vectors/{userId}/{ns}.json`
- [x] Legacy bearer token gated behind `KURO_ENABLE_LEGACY_TOKEN` env var
- [x] Sandbox timeout fixed: `secsToHMS()` for firejail, Node.js SIGKILL timer on both paths
- [x] Iframe sandbox hardened: `sandbox="allow-scripts"` only (removed `allow-same-origin`)
- [x] CSP: removed `unsafe-inline` from `script-src`, added `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`
- [x] `securityLog()` utility for structured security events
- [x] `scripts/migrate_uploads.cjs`: dry-run + live migration for legacy flat uploads

---

## Phase 1 — Virtual Filesystem (VFS) 🚧

**Status:** In progress

### Goals

- S3-backed per-user virtual filesystem replacing ad-hoc upload endpoints
- Quota enforcement per tier (free: 100 MB, pro: 10 GB, sovereign: 100 GB)
- Agent tool access to VFS via `layers/tools/vfs_tools.cjs`
- FileExplorerApp as the desktop UI entry point

### Acceptance Criteria

- [ ] VFS adapter interface defined (`layers/vfs/vfs_adapter.interface.cjs`)
- [ ] S3 primary adapter implemented with per-user namespace (`users/{userId}/`)
- [ ] Nextcloud stub exists with `NOT_IMPLEMENTED` responses
- [ ] DB schema v4: `vfs_files`, `vfs_quotas`, `projects` tables
- [ ] API routes: list, read, write, mkdir, rm, mv, stat, quota
- [ ] Quota soft/hard limits enforced on write
- [ ] Path traversal (`..`) rejected in adapter `sanitizePath()`
- [ ] Cross-user access rejected (proven by test script)
- [ ] `scripts/test_vfs.cjs` passes all assertions
- [ ] `FileExplorerApp` renders list, supports mkdir, upload, delete
- [ ] VFS tools callable from agent pipeline
- [ ] Context pack generated (`node scripts/gen_context_pack.cjs`)

---

## Phase 2 — Agent Capabilities 📋

**Status:** Planned

### Goals

- Multi-step agentic tasks via `agent_orchestrator.js`
- Tool registry with auto-discovery endpoint
- Persistent per-user agent task history in DB
- Background task queue with progress SSE
- Approval gates for destructive operations (delete, deploy)

### Acceptance Criteria

- [ ] Agent can read/write/list VFS via tool calls
- [ ] Agent task history persisted in new `agent_tasks` DB table
- [ ] Approval UI in OS desktop (modal or notification)
- [ ] No tool calls bypass auth/scope checks
- [ ] Tool registry endpoint: `GET /api/tools`

---

## Phase 3 — Collaboration 📋

**Status:** Planned

### Goals

- Shared projects (multi-user VFS paths under `projects/{projectId}/`)
- Real-time presence (SSE or WebSocket)
- Comment threads on artifacts
- Project invitation / permission model

---

## Phase 4 — Deployment & Scale 📋

**Status:** Planned

### Goals

- Multi-instance with Redis session store (replace SQLite sessions)
- CDN for static assets
- Prometheus metrics at `/metrics`
- Automated backup for SQLite + vector stores
- Zero-downtime deploy via PM2 cluster mode
