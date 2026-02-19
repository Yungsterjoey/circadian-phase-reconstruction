# KURO v9 — Sandbox Shipwright Deliverable

## A) Plan (12 bullets)

1. **New sidecar service** `kuro-sandbox/index.js` — HTTP on `127.0.0.1:3101`, executes user code inside Docker containers (fallback: firejail). Returns `runId` + polls for status/logs/artifacts.
2. **Docker runner image** `kuro-sandbox/Dockerfile.runner` — `python:3.12-slim` with numpy/pandas/matplotlib/pillow, non-root user, no package manager. Container runs with `--network=none --read-only --memory=Xm --pids-limit=64`.
3. **New backend routes** `layers/sandbox_routes.cjs` — Mounts at `/api/sandbox/*` with 9 endpoints (workspaces CRUD, file write/upload/tree, run submit/status, artifact serve, health). All require `auth.required` + tier gate.
4. **Tier gating**: Free → 403. Pro → 15s runtime, 128MB, 3 runs/min, 1 concurrent. Sovereign → 60s, 512MB, 10 runs/min, 2 concurrent.
5. **DB tables** added via `CREATE TABLE IF NOT EXISTS` in `sandbox_routes.cjs` init: `sandbox_workspaces`, `sandbox_runs`, `sandbox_artifacts`. No schema version bump needed (idempotent).
6. **Storage layout**: `/var/lib/kuro/sandboxes/<userId>/<workspaceId>/files/`, `runs/<runId>/`, `artifacts/`. Path traversal blocked by `enforceBase()`.
7. **Artifact serving** with MIME allowlist (16 safe extensions), `X-Content-Type-Options: nosniff`, `CSP: default-src 'none'; sandbox`, `X-Frame-Options: DENY`. HTML artifacts get extra `script-src 'none'`.
8. **No reuse of `/api/dev/*`** — sandbox routes use completely separate code path. Dev endpoints remain gated by `auth.dev` + `devGate` (Sovereign-only).
9. **Frontend `SandboxPanel.jsx`** — workspace selector, file tree, code editor (textarea), run button, output console, artifact preview (image/HTML iframe/text), "Attach to chat" button.
10. **KuroChatApp integration** — new `sandbox` skill pill in SKILLS. When active, renders `SandboxPanel` instead of messages. Attach inserts `[sandbox:runId] summary` into chat input.
11. **server.cjs changes** (3 safe additions): loader for `sandbox_routes.cjs`, mount at `/api/sandbox`, `sandboxes` dir creation, boot banner line.
12. **Rollback** — remove `kuro-sandbox/`, `layers/sandbox_routes.cjs`, `src/components/apps/SandboxPanel.jsx`, revert 3 hunks in `server.cjs` + 2 in `KuroChatApp.jsx`.

---

## B) Patch — New Files

### B.1 `kuro-sandbox/index.js` (Sidecar Runner)
Full file at: `kuro-sandbox/index.js` (321 lines)

Key design:
- Listens `127.0.0.1:3101` only (never exposed)
- `POST /run` accepts `{workspacePath, entrypoint, budgets, runDir}` → returns `{runId}`
- `GET /run/:id` → `{status, stdout, stderr, artifacts, exitCode}`
- Docker args: `--network=none --read-only --tmpfs=/tmp:64m --memory=Xm --cpus=1 --pids-limit=64 --security-opt=no-new-privileges`
- Workspace mounted `:ro`, artifacts dir mounted `:rw`
- Firejail fallback with `--net=none --noroot --rlimit-as=X`
- In-memory job map, cleanup every 10 min

### B.2 `kuro-sandbox/Dockerfile.runner`
```dockerfile
FROM python:3.12-slim AS runner
RUN apt-get purge -y --auto-remove && \
    rm -rf /var/lib/apt /var/cache/apt /usr/bin/apt* /usr/bin/dpkg* && \
    pip install --no-cache-dir matplotlib numpy pandas pillow && \
    pip cache purge && rm -rf /root/.cache
RUN useradd -m -s /bin/false sandbox
USER sandbox
WORKDIR /workspace
```

### B.3 `kuro-sandbox/docker-compose.yml`
- Builds runner image (`kuro-sandbox-runner:latest`)
- Runs sidecar on `127.0.0.1:3101` with Docker socket mount

### B.4 `kuro-sandbox/kuro-sandbox.service` (systemd alternative)
- Type=simple, ExecStart=node index.js, Restart=on-failure

### B.5 `layers/sandbox_routes.cjs` (525 lines)
Routes:
```
POST /api/sandbox/workspaces           → create workspace (Pro+)
GET  /api/sandbox/workspaces           → list user workspaces
GET  /api/sandbox/workspaces/:id       → workspace metadata
POST /api/sandbox/files/write          → write file content
POST /api/sandbox/files/upload         → binary upload (X-Workspace-Id header)
GET  /api/sandbox/files/tree           → list files (?workspaceId=)
POST /api/sandbox/run                  → submit execution job
GET  /api/sandbox/run/:runId           → status + logs + artifacts
GET  /api/sandbox/artifacts/:runId/*   → serve artifact file (MIME allowlist)
GET  /api/sandbox/health               → sidecar health check
```

Security controls:
- `requireSandboxTier` middleware → 403 for free tier
- `checkRunRate()` → per-user rate + concurrency limits
- `enforceBase()` → path traversal prevention
- `safeName()` → filename sanitization
- `MIME_MAP` → 16-extension allowlist
- CSP headers on all artifact responses

### B.6 `src/components/apps/SandboxPanel.jsx` (588 lines)
Components: WorkspaceSelector, FileTree, OutputConsole, ArtifactPreview, ArtifactTextPreview, SandboxPanel (main).

---

## B) Patch — Diffs to Existing Files

### B.7 `server.cjs` — 4 hunks

**Hunk 1** (line ~115): Add sandbox route loader
```diff
 try { createAuthRoutes = require('./layers/auth/auth_routes.cjs'); } catch(e) { createAuthRoutes = null; console.warn('[WARN] Auth routes not loaded:', e.message); }
+
+// Sandbox routes (isolated code execution — does NOT reuse /api/dev/*)
+let createSandboxRoutes = null;
+try { createSandboxRoutes = require('./layers/sandbox_routes.cjs'); } catch(e) { console.warn('[WARN] Sandbox routes not loaded:', e.message); }
```

**Hunk 2** (line ~238): Add sandboxes dir
```diff
-[DATA_DIR, VECTOR_DIR, path.join(DATA_DIR, 'sessions'), path.join(DATA_DIR, 'uploads'), path.join(DATA_DIR, 'docs'), path.join(DATA_DIR, 'patches')].forEach(d => {
+[DATA_DIR, VECTOR_DIR, path.join(DATA_DIR, 'sessions'), path.join(DATA_DIR, 'uploads'), path.join(DATA_DIR, 'docs'), path.join(DATA_DIR, 'patches'), path.join(DATA_DIR, 'sandboxes')].forEach(d => {
```

**Hunk 3** (line ~348): Mount sandbox routes
```diff
 if (createStripeRoutes) {
   app.use('/api/stripe', createStripeRoutes(auth));
   console.log('[STRIPE] Checkout + portal routes mounted');
 }
+
+// Sandbox routes (isolated code execution for Pro/Sovereign)
+if (createSandboxRoutes) {
+  try {
+    const { db: sandboxDb } = require('./layers/auth/db.cjs');
+    app.use('/api/sandbox', createSandboxRoutes(auth, { db: sandboxDb }));
+    console.log('[SANDBOX] Routes mounted at /api/sandbox/*');
+  } catch (e) {
+    console.warn('[SANDBOX] Failed to mount:', e.message);
+  }
+}
```

**Hunk 4** (line ~905): Boot banner
```diff
   console.log(`  Preempt:   ${typeof mountPreemptRoutes === 'function' ? 'wired' : 'fallback'}`);
+  console.log(`  Sandbox:   ${createSandboxRoutes ? 'wired (Pro+Sovereign, Docker isolation)' : 'not loaded'}`);
   console.log(`  Frontier:  ${getActiveProvider().configured ? getActiveProvider().provider : 'not configured'}`);
```

### B.8 `src/components/apps/KuroChatApp.jsx` — 3 hunks

**Hunk 1** (line ~45): Import
```diff
 } from 'lucide-react';
+
+import SandboxPanel from './SandboxPanel';
```

**Hunk 2** (line ~131): Add sandbox skill
```diff
   create: { id: 'create', name: 'Create', icon: Wand2, color: '#ff375f' },
+  sandbox: { id: 'sandbox', name: 'Sandbox', icon: Terminal, color: '#30d158' },
 };
```

**Hunk 3** (line ~1099): Conditional panel render
```diff
-          {/* Messages */}
-          <div className="messages-scroll">
+          {/* Messages or Sandbox Panel */}
+          {activeSkill === 'sandbox' ? (
+            <div className="messages-scroll" style={{padding: 0}}>
+              <SandboxPanel
+                visible={activeSkill === 'sandbox'}
+                onAttachArtifact={(artRef) => {
+                  setInput(prev => prev + `\n[sandbox:${artRef.runId.slice(0,8)}] ${artRef.summary}`);
+                  setActiveSkill('chat');
+                }}
+              />
+            </div>
+          ) : (
+          <div className="messages-scroll">
             ...existing messages...
           </div>
+          )}
```

---

## C) Deploy

### Step 1: Build the sandbox runner Docker image
```bash
cd /opt/kuro/kuro-sandbox
docker build -t kuro-sandbox-runner:latest -f Dockerfile.runner .
```

### Step 2: Start the sandbox sidecar

**Option A — systemd (recommended for production):**
```bash
cp /opt/kuro/kuro-sandbox/kuro-sandbox.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable kuro-sandbox
systemctl start kuro-sandbox
systemctl status kuro-sandbox   # verify active
```

**Option B — Docker Compose:**
```bash
cd /opt/kuro/kuro-sandbox
docker compose up -d sandbox
```

### Step 3: Ensure sandboxes directory exists
```bash
mkdir -p /var/lib/kuro/sandboxes
chown -R $(whoami):$(whoami) /var/lib/kuro/sandboxes
```

### Step 4: Rebuild frontend
```bash
cd /opt/kuro
npm run build
```

### Step 5: Restart KURO core
```bash
systemctl restart kuro-core
```

### Step 6: Verify sidecar health
```bash
curl -s http://127.0.0.1:3101/health
# Expected: {"status":"ok","docker":true,"active":0,"maxConcurrent":4}
```

---

## D) Verify (curl checklist)

### D.1 Unauthenticated → 401
```bash
curl -i http://localhost:3100/api/sandbox/workspaces
# Expected: HTTP/1.1 401
# Body: {"error":"Authentication required",...}

curl -i -X POST http://localhost:3100/api/sandbox/run
# Expected: HTTP/1.1 401
```

### D.2 Authed Free user → 403
```bash
FREE_TOKEN="<free-user-token>"

curl -i http://localhost:3100/api/sandbox/workspaces \
  -H "X-KURO-Token: $FREE_TOKEN"
# Expected: HTTP/1.1 403
# Body: {"error":"sandbox_disabled","message":"Sandbox requires Pro or Sovereign tier",...}
```

### D.3 Authed Pro user → full workflow
```bash
PRO_TOKEN="<pro-user-token>"

# Create workspace
curl -s -X POST http://localhost:3100/api/sandbox/workspaces \
  -H "X-KURO-Token: $PRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-ws"}' | jq .
# Expected: {"id":"<hex>","name":"test-ws","created":true}

WS_ID="<id-from-above>"

# Write a file
curl -s -X POST http://localhost:3100/api/sandbox/files/write \
  -H "X-KURO-Token: $PRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WS_ID\",\"filePath\":\"main.py\",\"content\":\"import os\\nprint('hello sandbox')\\nwith open('/artifacts/output.txt','w') as f: f.write('artifact!')\"}" | jq .
# Expected: {"success":true,"path":"main.py","size":...}

# List files
curl -s "http://localhost:3100/api/sandbox/files/tree?workspaceId=$WS_ID" \
  -H "X-KURO-Token: $PRO_TOKEN" | jq .
# Expected: {"files":[{"path":"main.py","size":...}]}

# Submit run
RUN_RESP=$(curl -s -X POST http://localhost:3100/api/sandbox/run \
  -H "X-KURO-Token: $PRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WS_ID\",\"entrypoint\":\"main.py\"}")
echo "$RUN_RESP" | jq .
RUN_ID=$(echo "$RUN_RESP" | jq -r .runId)
# Expected: {"runId":"<hex>","status":"queued"} or {"sidecarRunId":"..."}

# Poll status (wait 3–5s, then check)
sleep 5
curl -s "http://localhost:3100/api/sandbox/run/$RUN_ID" \
  -H "X-KURO-Token: $PRO_TOKEN" | jq .
# Expected: {"runId":"...","status":"done","exitCode":0,"stdout":"hello sandbox\n",...}

# Fetch artifact
curl -i "http://localhost:3100/api/sandbox/artifacts/$RUN_ID/output.txt" \
  -H "X-KURO-Token: $PRO_TOKEN"
# Expected: HTTP/1.1 200, Content-Type: text/plain, Body: "artifact!"
# Headers: X-Content-Type-Options: nosniff, Content-Security-Policy: ...
```

### D.4 `/api/dev/*` still Sovereign-only
```bash
curl -i -X POST http://localhost:3100/api/dev/exec \
  -H "X-KURO-Token: $PRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"id"}'
# Expected: HTTP/1.1 403
# Body: {"error":"Dev access required"}
```

### D.5 Sandbox health
```bash
curl -s http://localhost:3100/api/sandbox/health \
  -H "X-KURO-Token: $PRO_TOKEN" | jq .
# Expected: {"sandbox":"ok","runner":{"status":"ok","docker":true,...}}
```

---

## E) Rollback

### Step 1: Stop sandbox sidecar
```bash
# If systemd:
systemctl stop kuro-sandbox
systemctl disable kuro-sandbox
rm /etc/systemd/system/kuro-sandbox.service
systemctl daemon-reload

# If Docker Compose:
cd /opt/kuro/kuro-sandbox && docker compose down
```

### Step 2: Remove new files
```bash
rm -rf /opt/kuro/kuro-sandbox
rm -f  /opt/kuro/layers/sandbox_routes.cjs
rm -f  /opt/kuro/src/components/apps/SandboxPanel.jsx
```

### Step 3: Revert server.cjs (4 hunks)
```bash
cd /opt/kuro

# Remove sandbox loader (lines ~117-119)
sed -i '/Sandbox routes (isolated code execution — does NOT reuse/,/console.warn.*Sandbox routes not loaded/d' server.cjs
sed -i '/^let createSandboxRoutes = null;$/d' server.cjs

# Remove sandboxes from dir creation
sed -i "s|, path.join(DATA_DIR, 'sandboxes')||" server.cjs

# Remove sandbox mount block
sed -i '/Sandbox routes (isolated code execution for Pro/,/^}/d' server.cjs

# Remove boot banner line
sed -i '/Sandbox:.*wired.*Docker isolation/d' server.cjs
```

### Step 4: Revert KuroChatApp.jsx
```bash
# Remove SandboxPanel import
sed -i "/import SandboxPanel from '.\/SandboxPanel';/d" src/components/apps/KuroChatApp.jsx

# Remove sandbox skill entry
sed -i "/sandbox:.*Sandbox.*Terminal.*30d158/d" src/components/apps/KuroChatApp.jsx
```
> **Note**: The conditional render hunk (sandbox panel vs messages) requires manual revert — restore the original `{/* Messages */}` block from git or backup.

### Step 5: Rebuild + restart
```bash
npm run build
systemctl restart kuro-core
```

### Step 6: Verify rollback
```bash
curl -s http://localhost:3100/api/sandbox/workspaces
# Expected: 404 (route no longer exists)

curl -s http://localhost:3100/api/health | jq .status
# Expected: "ok"
```

### Step 7: (Optional) Drop sandbox tables
```bash
sqlite3 /var/lib/kuro/kuro.db "DROP TABLE IF EXISTS sandbox_artifacts; DROP TABLE IF EXISTS sandbox_runs; DROP TABLE IF EXISTS sandbox_workspaces;"
```

### Step 8: (Optional) Remove sandbox data
```bash
rm -rf /var/lib/kuro/sandboxes
```
