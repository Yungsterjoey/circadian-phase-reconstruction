# KURO Security Model

## Phase 0 Invariants (Must-Not-Break)

### Auth

- Server calls `process.exit(1)` in production if auth module fails to load; returns 503 in dev
- All `/api/*` routes (except `/api/auth/*` and `/api/health`) require a valid session cookie
- Guest sessions are ephemeral anon IDs — no write access to user-owned data
- Legacy bearer tokens gated behind `KURO_ENABLE_LEGACY_TOKEN` env var

### Input Validation (`layers/request_validator.js`)

- Session IDs: only `[a-zA-Z0-9\-_]{1,64}`; stripped otherwise
- Filenames: path separators (`/ \ : * ? " < > |`) and `..` replaced with `_`; max 128 chars
- Paths: `path.resolve()` + sandbox allowlist check before any file operation
- Null bytes rejected in all path inputs
- All request bodies validated against named schemas (stream, devExec, devWrite, devRead, ingest, embed, ragQuery)

### File Isolation

- **Uploads:** `$KURO_DATA/uploads/{userId}/{filename}` — userId enforced at route level
- **VFS:** `s3://{bucket}/users/{userId}/` — namespace enforced inside S3 adapter (`makeKey`)
- **Vector stores:** `vectors/{userId}/{ns}.json` — factory prevents cross-user contamination; guests blocked entirely

### Code Execution (Sandbox)

- **Docker (primary):** `--network=none`, `--read-only`, `--memory`, `--memory-swap`, `--pids-limit 64`, `--security-opt no-new-privileges`, `--ulimit nofile=256:256`
- **Firejail (fallback):** `--net=none`, `--noroot`, `--timeout=HH:MM:SS` (proper format via `secsToHMS()`), `--read-only={workspace}`
- Node.js `setTimeout` + `SIGKILL` enforces `KURO_SANDBOX_TIMEOUT_SECONDS` hard cap on both paths
- Sidecar listens exclusively on `127.0.0.1:3101` — never exposed to internet

### Content Security Policy (all HTML responses)

```
default-src 'self'
script-src 'self'                        ← no unsafe-inline
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
connect-src 'self' wss: blob:
worker-src blob:
frame-src blob: data:                    ← artifact previews only
frame-ancestors 'none'                   ← clickjacking prevention
base-uri 'self'
form-action 'self'
```

### Iframe Hardening

- Artifact preview iframes: `sandbox="allow-scripts"` — no cookie or localStorage access (`allow-same-origin` removed)

## Security Log Events

All structured events emitted via `securityLog(event, meta)` in `server.cjs`:

| Event | Trigger |
|-------|---------|
| `AUTH_MODULE_FAILURE` | Auth layer failed to load at startup |
| `SANDBOX_TIMEOUT_KILL` | Sandbox process killed by Node.js hard-cap timer |
| `VECTOR_NAMESPACE_VIOLATION` | Anonymous or missing userId in RAG path |
| `PATH_TRAVERSAL_ATTEMPT` | Resolved path escapes allowed sandbox |
| `UPLOAD_USER_MISMATCH` | Upload userId inconsistency detected |

## Must-Not-Break Checklist

Run after every schema migration or route change:

- [ ] Auth fail-hard still triggers when `layers/auth/auth_routes.cjs` missing
- [ ] Per-user upload paths (`uploads/{userId}/`) unchanged
- [ ] Vector namespace factory NOT replaced by global singleton
- [ ] Sandbox sidecar still binds to `127.0.0.1` only
- [ ] CSP headers present on all non-API GET responses
- [ ] `frame-ancestors 'none'` present in CSP
- [ ] VFS adapter rejects paths with `..` traversal sequences
- [ ] VFS routes reject unauthenticated (anon) requests
