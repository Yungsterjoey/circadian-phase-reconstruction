# KURO Sandbox

## Overview

Isolated Python code execution sidecar. Listens on `127.0.0.1:3101`. **Never expose to internet.**

## HTTP Interface

```
POST /run    { workspacePath, entrypoint, budgets, runDir }  →  { runId, status }
GET  /run/:id                                                →  { status, exitCode, stdout, stderr, artifacts }
GET  /health                                                 →  { status, docker, active, maxConcurrent }
```

## Isolation Layers

**Docker (primary):**
`--network=none --read-only --memory {N}m --memory-swap {N}m --cpus 1 --pids-limit 64`
`--ulimit nofile=256:256 --security-opt no-new-privileges`

**Firejail (fallback):**
`--net=none --noroot --rlimit-as={bytes} --timeout=HH:MM:SS --read-only={workspace}`

## Resource Budgets (defaults)

| Budget | Default |
|--------|---------|
| `max_runtime_seconds` | 30 |
| `max_memory_mb` | 256 |
| `max_output_bytes` | 1 048 576 (1 MB) |
| `max_workspace_bytes` | 52 428 800 (50 MB) |

Hard cap: `KURO_SANDBOX_TIMEOUT_SECONDS` (env, default 60 s). Node.js `setTimeout` + `SIGKILL` enforces it independently of the runner. Logs `SANDBOX_TIMEOUT_KILL` security event.

## Artifact Allowlist

`.txt .md .html .htm .csv .json .xml .py .js .ts .css .svg .png .jpg .jpeg .gif .webp .bmp .pdf .log`
