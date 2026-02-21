# KURO Tool Bindings

## Connector Tools (`layers/mcp_connectors.js`)

| Tool | Description | Min Scope |
|------|-------------|-----------|
| `read`   | Read file content (secrets redacted) | `insights` |
| `write`  | Stage file write to `$KURO_DATA/patches/` | `actions` |
| `exec`   | Execute whitelisted binary with audited args | `actions` |
| `search` | Full-text search in allowed directories | `analysis` |

## VFS Tools (`layers/tools/vfs_tools.cjs`)

| Tool | Description |
|------|-------------|
| `vfs_list`  | List directory in user VFS |
| `vfs_read`  | Read file from user VFS |
| `vfs_write` | Write file to user VFS |
| `vfs_mkdir` | Create directory |
| `vfs_rm`    | Remove file or directory |

## Read Scope Ladder

| Scope | Allowed Paths |
|-------|--------------|
| `insights` | `docs/`, `uploads/`, `vectors/` |
| `analysis` | above + `sessions/` |
| `actions`  | entire `$KURO_DATA/`, `$KURO_CODE/` |

Denied always: `/etc/kuro`, `audit/`, `/root`, `/home`, `/etc/shadow`
