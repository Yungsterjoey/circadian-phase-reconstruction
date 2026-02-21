# KURO API Routes

> Auto-generated from server.cjs.

## /

- `GET /`

## /api/admin

- `GET /api/admin/whoami`
- `GET /api/admin/users`

## /api/audit

- `GET /api/audit/verify`
- `GET /api/audit/recent`
- `GET /api/audit/stats`
- `POST /api/audit/seal`

## /api/auth

- `USE /api/auth`

## /api/capability

- `POST /api/capability/negotiate`
- `GET /api/capability/profiles`

## /api/dev

- `POST /api/dev/exec`
- `POST /api/dev/write`
- `POST /api/dev/stage`
- `POST /api/dev/read`

## /api/embed

- `POST /api/embed`

## /api/files

- `POST /api/files/upload`
- `GET /api/files`
- `POST /api/files/ingest`

## /api/frontier

- `GET /api/frontier/status`

## /api/guest

- `GET /api/guest/quota`

## /api/health

- `GET /api/health`

## /api/ingest

- `POST /api/ingest`

## /api/models

- `GET /api/models`

## /api/patches

- `GET /api/patches`

## /api/profile

- `GET /api/profile`

## /api/rag

- `POST /api/rag/query`
- `GET /api/rag/stats`
- `POST /api/rag/clear`

## /api/sandbox

- `USE /api/sandbox`

## /api/sessions

- `GET /api/sessions`

## /api/shadow

- `GET /api/shadow/status`
- `POST /api/shadow/toggle`

## /api/stream

- `POST /api/stream`

## /api/stripe

- `POST /api/stripe/webhook`
- `USE /api/stripe`

## /api/tools

- `POST /api/tools/web/search`

## /api/upload

- `POST /api/upload`

## /landing

- `GET /landing`

## /api/vfs (VFS — Phase 1)

- `GET    /api/vfs/list?path=`           — list directory
- `GET    /api/vfs/read?path=`           — read file (raw bytes)
- `POST   /api/vfs/write`                — write file `{path, content, encoding?, mimeType?}`
- `POST   /api/vfs/mkdir`                — create directory `{path}`
- `DELETE /api/vfs/rm?path=&recursive=`  — remove
- `POST   /api/vfs/mv`                   — move/rename `{src, dst}`
- `GET    /api/vfs/stat?path=`           — stat
- `GET    /api/vfs/quota`                — quota usage
