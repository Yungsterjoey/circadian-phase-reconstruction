# KURO Database Schema

SQLite via better-sqlite3. WAL mode. Path: `$KURO_DATA/kuro.db`.

## Tables

| Table | Since | Description |
|-------|-------|-------------|
| `users` | v1 | User accounts. Cols: id, email, name, password_hash, tier (free/pro/sovereign), is_admin (v3) |
| `sessions` | v1 | Active sessions. Cols: id, user_id, expires_at, ip, user_agent |
| `oauth_accounts` | v1 | OAuth links. Cols: user_id, provider, provider_id, display_name (v2), avatar_url (v2) |
| `passkeys` | v1 | WebAuthn credentials. Cols: id, user_id, public_key BLOB, counter |
| `email_otps` | v1 | Email OTP codes. Cols: user_id, code, expires_at, used, attempts |
| `subscriptions` | v1 | Stripe subscriptions. Cols: id, user_id, stripe_customer_id, status, tier |
| `kuro_tokens` | v1 | Legacy bearer tokens (gated by KURO_ENABLE_LEGACY_TOKEN) |
| `usage` | v1 | Weekly usage counters. Cols: user_id, action, week_num, count |
| `stripe_events` | v1 | Idempotency log for Stripe webhook events |
| `vfs_files` | v4 | VFS file metadata. Cols: id, user_id, path, size, mime_type, backend, s3_key, is_dir. UNIQUE(user_id, path) |
| `vfs_quotas` | v4 | Per-user storage quotas. Cols: user_id PK, limit_bytes, used_bytes |
| `projects` | v4 | Project containers. Cols: id, user_id, name, vfs_path, meta (JSON) |

## Migration Pattern

- `SCHEMA_VERSION` constant in `layers/auth/db.cjs`
- `if (current < N) { ... CREATE TABLE IF NOT EXISTS ... ALTER TABLE ... }` blocks
- Idempotent: wrapped in try/catch for ALTER statements
- Version committed with `db.pragma('user_version = N')`

**Current version: 4**