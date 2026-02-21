# KURO API Interfaces

## Auth Endpoints (`/api/auth/*`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/auth/register` | none | `{email, password, name}` | `{token, user}` |
| POST | `/api/auth/login` | none | `{email, password}` | `{token, user}` |
| POST | `/api/auth/logout` | session | — | `{ok}` |
| GET | `/api/auth/me` | session | — | `{user}` |
| POST | `/api/auth/google` | none | `{credential}` | `{token, user}` |
| POST | `/api/auth/passkey/register` | session | — | WebAuthn challenge |
| POST | `/api/auth/passkey/verify` | none | WebAuthn credential | `{token, user}` |
| POST | `/api/auth/otp/send` | none | `{email}` | `{ok}` |
| POST | `/api/auth/otp/verify` | none | `{email, code}` | `{token, user}` |

## Stream Endpoint

`POST /api/stream` — Server-Sent Events (SSE) stream

Request body (schema: `stream`, max 5 MB):

```json
{
  "messages":    [{"role": "user", "content": "..."}],
  "mode":        "main|dev|bloodhound|war_room",
  "skill":       "string",
  "temperature": 0.7,
  "sessionId":   "string",
  "images":      ["base64..."],
  "thinking":    false,
  "reasoning":   false,
  "incubation":  false,
  "useRAG":      false,
  "ragNamespace":"edubba",
  "ragTopK":     5
}
```

SSE event types: `layer` | `text` | `thinking` | `artifact` | `done` | `error`

Layer event: `{ type: "layer", layer: N, name: "IronDome", status: "ok"|"skip"|"error" }`

## VFS Endpoints (`/api/vfs/*`) — Phase 1

All routes require session auth. Guests (anon) receive `401`.

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/api/vfs/list` | `?path=/` | `{ entries: [{name, type, size, modified}], path }` |
| GET | `/api/vfs/read` | `?path=/file.txt` | File content (raw bytes, Content-Type set) |
| POST | `/api/vfs/write` | `{path, content, encoding?, mimeType?}` | `{ok, size, etag?}` |
| POST | `/api/vfs/mkdir` | `{path}` | `{ok}` |
| DELETE | `/api/vfs/rm` | `?path=/f&recursive=false` | `{ok}` |
| POST | `/api/vfs/mv` | `{src, dst}` | `{ok}` |
| GET | `/api/vfs/stat` | `?path=/file.txt` | `{name, type, size, modified, etag?, mimeType?}` |
| GET | `/api/vfs/quota` | — | `{used, limit, tier}` |

### VFS Error Codes

| HTTP | code | Meaning |
|------|------|---------|
| 404 | `NOT_FOUND` | Path does not exist |
| 403 | `PERMISSION_DENIED` | Auth / namespace violation |
| 413 | `QUOTA_EXCEEDED` | User quota exhausted |
| 409 | `CONFLICT` | Path already exists |
| 501 | `NOT_IMPLEMENTED` | Backend not yet implemented |

## Tool Protocol (Agent Tool Calls)

Connector layer (`layers/mcp_connectors.js`) exposes tools to the agent pipeline:

```json
{
  "tool":      "read|write|exec|search|vfs_list|vfs_read|vfs_write|vfs_mkdir|vfs_rm",
  "args":      { "filePath": "...", "content": "..." },
  "sessionId": "...",
  "userId":    "..."
}
```

Scope enforcement:

| Scope | Allowed Paths |
|-------|--------------|
| `insights` | docs/, uploads/, vectors/ |
| `analysis` | docs/, uploads/, vectors/, sessions/ |
| `actions` | `$KURO_DATA/`, `$KURO_CODE/` |

- Write fence: runtime writes to `$KURO_DATA/patches/` staging only
- Exec allowlist: exact binary + arg pattern match required
- Redaction: secrets stripped before content reaches model
- All tool calls logged via `audit_chain.js`

## Canonical Request Schemas (`layers/request_validator.js`)

| Schema | Required Fields | Max Body Size |
|--------|-----------------|--------------|
| `stream` | none | 5 MB |
| `devExec` | `command` | 64 KB |
| `devWrite` | `filePath` | 10 MB |
| `devRead` | `filePath` | 4 KB |
| `ingest` | none | 10 MB |
| `embed` | none | 1 MB |
| `ragQuery` | `query` | 64 KB |

## Admin Endpoints (`/api/admin/*`)

Requires `is_admin = 1` in users table.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/admin/whoami` | `{admin, userId, email, tier}` |
| GET | `/api/admin/users` | `{users: [...], count}` |
