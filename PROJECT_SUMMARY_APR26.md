# KURO OS — Project Summary (2026-04-16)

> Hand-off doc for incoming LLM context. Captures architecture, infrastructure, GitHub state, and conventions as of mid-April 2026.

---

## 1. What KURO Is

**KURO OS** is a sovereign-AI operating system / platform built around a local Ollama inference stack with a 12-layer cognitive pipeline, multi-tenant auth, and several first-party modules (PAY, GRAB, WAGER, NEURO). The owning developer is **Henry (`Yungsterjoey` on GitHub)**, building from Australia.

Core design principles:
- **Local-first inference.** Every tier (free / pro / sovereign) routes to Ollama on owned hardware. No frontier-API dependency in the request path.
- **Abliterated models.** Free + Pro tier currently both run `huihui_ai/huihui-moe-abliterated:24b-a8b-Q4_K_M`. Sovereign tier and dev mode can swap to larger models (qwen3.5-abliterated:27b on the V100 VM).
- **Audit-chained.** Every action passes through `audit_chain.js` with day-sealed integrity verification.
- **Tier-aware.** Guest → free → pro → sovereign capability gates throughout. Devs additionally get `/api/dev/*` exec/write/read/stage primitives.

---

## 2. Repository Topology

| Repo | Visibility | Purpose | Remote |
|---|---|---|---|
| `kuro-os-neuro` | **private** | Full KURO OS codebase, source of truth | `git@github.com:Yungsterjoey/kuro-os-neuro.git` |
| `circadian-phase-reconstruction` | **public** | Neuro-only spinout (circadian phase engine + validation), zero KURO references | `git@github.com:Yungsterjoey/circadian-phase-reconstruction.git` |

Local working copy at `/mnt/kurodisk/kuro/core` has both as remotes:
- `origin` → public neuro repo
- `kuro-os-neuro` → private full repo

**Public repo state (as of 2026-04-16):**
- Branches: `main` only (master removed during cleanup)
- Commits: 3, all clean messages, no `Co-Authored-By: Claude` trailers
- Code-search audit: 0 hits for `kuro`, 0 hits for `claude`
- Tree: `.gitignore`, `README.md`, `neuro/` directory only

**Other GitHub repos** (under Yungsterjoey) were deleted during 2026-04-16 cleanup: k3d-engine, citrios, pokeplatinum, KuroOS, kuro-ios, platinum-projekt.

---

## 3. Codebase Layout (`/mnt/kurodisk/kuro/core/`)

```
server.cjs                      Main Express app, ~1800 lines, all routes
ecosystem.config.cjs            PM2 config (process: kuro-core, port 3000)
package.json                    v9.0.0, Node ≥20, express + axios + stripe + x402 + better-sqlite3
.env                            Stripe live keys, env-only (never commit)

layers/                         The 12-layer cognitive pipeline + supporting subsystems
  preempt/                      KURO::PREEMPT v2 (engine, routes, stream)
  auth/                         Token + tier validation
  kuro_engine/                  Inference orchestration
  vfs/                          Virtual file connectors
  vision/                       Multimodal handling
  search/                       Web search bridges
  shadow/                       Shadow-mode toggling
  liveedit/                     Inline edit primitives
  tools/                        Tool-call bus
  observability/                Telemetry + audit
  memory.js                     Mnemosyne / Edubba RAG namespaces
  audit_chain.js                Day-sealed action log
  iron_dome.js / iff_gate.js    Defensive layers
  semantic_router.js            Skill → model routing
  thinking_stream.js            <think>...</think> filter
  ...

modules/
  pay/                          KURO::PAY — x402 + VietQR + Stripe foreign-card bridge (CJS)
    core/ledger.cjs               Double-entry ledger
    routes/                       webhooks, accounts, ops, insights, audit, vaults
    connectors/                   xmr, stripe
    intelligence/insight_engine.cjs
    x402_card_bridge.cjs
    vietqr_parser.cjs
  grab/                         KURO::GRAB module
  wager/                        KURO::WAGER module

neuro/                          Circadian Phase Engine (publicly mirrored)
  circadian_model.js              τ=24.2h oscillator + gain-weighted phase correction
  circadian_model.test.js         15 unit/integration tests
  mmash_validation.js             MAE 0.29h on N=20 adults
  sandd_validation.js             MAE 0.31h on N=368 adolescent sessions
  msf.js                          MSF computation
  paper_draft.md                  Manuscript
  RESEARCH_BRIEF.md / VALIDATION_SUMMARY.md

public/
  index.html                    Live landing page (~1830 lines), KURO/NEUROKURO branding
  kuro-logo.jpg                 Iconic glasscube logo (favicon + OG image)
  manifest.json, sw.js          PWA
  kuroglass-{desktop,mobile,simulator}.png   Marketing assets

dist/                           Vite build output
docs/                           Internal docs
scripts/                        Deploy + maintenance scripts
```

---

## 4. The 12-Layer Cognitive Pipeline

Inside `/api/stream` (server.cjs:908), the request passes through layered processing before Ollama is hit:

1. **Auth + tier resolution** (`guestOrAuth`, `resolveUser`)
2. **Capability negotiation** (profile-aware)
3. **Semantic router** — picks model based on skill + intent + tier
4. **Vision triage** (if attachments)
5. **RAG retrieval** (Mnemosyne / Edubba namespaces)
6. **Context reactor** — file ingest + chunk fusion
7. **Tool-call bus** (web search, file ops, etc.)
8. **PREEMPT claim** — see §5
9. **Ollama inference** (streaming, with `thinkFilter` for `<think>` blocks)
10. **Stream controller** — `appendPartial` for correction-abort support
11. **Synthesis layer** — output enhancement / artifact rendering
12. **Audit + telemetry** — `logEvent` + day-sealed chain

`sendSSE(res, ...)` is the unified writer; `sendLayer(...)` emits layer-progress events.

---

## 5. KURO::PREEMPT v2 — Speculative Pre-Inference

Lives at `layers/preempt/`. Three files:

- **`preempt_engine.cjs`** — speculation lifecycle. As user types, client calls `/api/preempt/speculate`, which fires an Ollama inference whose tokens are buffered (not sent to client). On final submit, `claim()` returns the buffer if input is a superset of the speculated input.

- **`preempt_routes.cjs`** — `POST /api/preempt/speculate` and `/api/preempt/abort`. Both require `X-KURO-Token` (RT-03). Server-side session lookup; no message history from client (RT-06).

- **`preempt_stream.cjs`** — drop-in `streamWithPreempt()` helper (kept for reference, NOT used in production — see below).

**Wiring in `server.cjs:~1175`** (chosen approach: inline claim, NOT drop-in helper):
```js
if (!full) {
  const preempt = require('./layers/preempt/preempt_engine.cjs');
  const claimed = preempt.claim(sid, lastMsg);
  if (claimed && claimed.status === 'done' && claimed.tokenCount > 0) {
    // Flush buffer through thinkFilter + sendSSE + appendPartial
    // Sets `full` so the next `if (!full)` block skips Ollama
  }
}
```
**Why inline, not drop-in:** preserves the 12-layer pipeline, reuses `sendSSE`/`thinkFilter`/`streamController.appendPartial`, no event-shape divergence. **Why `status === 'done'` only:** conservative consume — partial speculations get discarded rather than risk context-mismatch artifacts in the seam.

**Hardening fixes RT-01 through RT-08** (all applied):
- RT-01: Global concurrency cap (3) + per-session cooldown (2s) + Ollama abort
- RT-02: Superset-only claiming, weighted similarity (last 3 words 2×), 0.75 threshold
- RT-03: Auth required on all preempt routes
- RT-04: No "continue from where you left off" prompt — fresh inference + buffer head-start
- RT-05: Buffer snapshot on claim (no mutation during flush)
- RT-06: No client-supplied messages — server-side session context
- RT-07: SIGINT/SIGTERM graceful abort of in-flight speculations
- RT-08: Client-side fetch fixes (usePreempt v2 hook)

---

## 6. Model Tiers

Defined in `MODEL_REGISTRY` in `server.cjs:~424`:

| ID | Name | Ollama tag | Ctx | Thinking | Tier | VRAM |
|---|---|---|---|---|---|---|
| `kuro-free` | KURO::FREE | `huihui_ai/huihui-moe-abliterated:24b-a8b-Q4_K_M` | 16384 | no | free | 14 GB |
| `kuro-pro` | KURO::PRO | same model | 16384 | **yes** | pro | 14 GB |
| `kuro-sov` | KURO::SOV | (sovereign-tier model) | larger | yes | sovereign | — |
| `kuro-vision` | vision | (multimodal) | — | — | pro | — |
| `kuro-embed` | embeddings | (embedder) | — | — | free | — |

Tier map: `guest → kuro-free`, `free → kuro-free`, `pro → kuro-pro`, `sovereign → kuro-sov`. Thermal watchdog can downgrade to `kuro-free` under VRAM/temp pressure.

---

## 7. KURO::PAY (module/pay)

Sovereign payment engine targeting **SE-Asia foreign-card use cases**. Architecture: Stripe accepts card → x402 facilitator settles → VietQR rail to local merchants. Important context flags from durable memory:

- Module is **CommonJS** (`.cjs` throughout). Do not assume ESM.
- Lives at `/mnt/kurodisk/kuro/core/modules/pay/` — **not** at `kuroglass/pay` (which is a separate TS side-project).
- Mounted via `modules/pay/index.cjs` exporting an Express router.
- Webhook routes use `express.raw()` for signature verification — must mount before any JSON parser.
- Stripe live keys in `/mnt/kurodisk/kuro/core/.env` (`STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_PUBLISHABLE_KEY=pk_live_...`).

---

## 8. NEURO Module → Public Spinout

`/mnt/kurodisk/kuro/core/neuro/` is the **circadian phase reconstruction engine**. It is the *only* directory mirrored to the public GitHub repo. Key facts:

- Single-file Node.js implementation, no dependencies
- τ = 24.2 h free-running period, gain-weighted phase correction (sleep > light > caffeine)
- MMASH validation: MAE **0.29 h** (N=20)
- SANDD validation: MAE **0.31 h** (N=368) — replicates within 0.02 h on 17× larger sample
- Blume 2024 ablation confirms sleep-onset correction is load-bearing
- Branded as "Circadian Phase Engine" in public repo (NEURO-KURO references stripped via sed during 2026-04-16 cleanup)

When updating the public repo, **never push from a worktree that contains KURO files**. Use the `/tmp/circ-clean/neuro/` worktree pattern (rebuild if missing) and push to `origin/main` as fast-forward.

---

## 9. Infrastructure

**Local workstation:** `/mnt/kurodisk/kuro/core/` — all dev + staging happens here. PM2 keeps `kuro-core` running on port 3000.

**Remote inference VM:** TensorDock V100-32GB, controlled by `~/.local/bin/gollama`. Runs `qwen3.5-abliterated:27b` via Ollama. Auto-stop watchdog idle-shuts to save credits. TensorDock API token in `~/kuro-secrets.txt`.

**Ollama-Anthropic proxy:** `~/ollama-anthropic-proxy.py` — exposes the V100 Ollama as Anthropic-compatible API for tooling that expects Claude-shaped endpoints.

---

## 10. Recent Commits (current branch: `feat/kuro-pay-v3`)

```
4deb1d2 preempt: wire claim() inline in /api/stream, conservative consume on done
0618416 v25: landing B-merge, KURO::ENGINE, PAY v2, GRAB module, training pipeline
5e2f0b6 feat: KURO::PAY x402/VietQR backend — Stripe card charge → facilitator settlement
21c7da0 feat: SANDD validation complete — MAE 0.31h N=368, paper draft added
38d36ae KURO::MEDIA app + PAY vault/payee system + phi4-mini router
e437052 KURO::PAY sovereign financial module + Up Bank-style UI
695d596 KURO v9.1: WAGER module + iOS chat UX + emoji engine + model swap
```

---

## 11. Conventions & Preferences

- **Commit messages:** No `Co-Authored-By: Claude` trailers anywhere. Ever. (Committed style: short imperative subject, scoped prefix like `feat:`/`preempt:`/`docs:`).
- **CommonJS for backend.** All `.cjs`. Modules use `require()`, not `import`.
- **No Bayesian/Kalman framing in neuro docs** — use "gain-weighted phase correction" (commit `62b0dd9` enforced this).
- **Public repo hygiene:** zero KURO/KURO OS references, zero AI-author giveaways, zero credentials. Always run a `gh api search/code?q=...` check before considering cleanup done.
- **Secrets vault:** `~/kuro-secrets.txt` (chmod 600) consolidates GitHub PAT, TensorDock token, Stripe live keys. Sources of truth remain in their respective files (`.env`, `gollama`); the vault is the lookup index.

---

## 12. Quick Reference

| Need | Location |
|---|---|
| Start dev server | `pm2 reload kuro-core` (or `npm start`) |
| Logs | `pm2 logs kuro-core` |
| Health check | `curl http://localhost:3000/api/health` |
| Stream endpoint | `POST /api/stream` (server.cjs:908) |
| Preempt endpoint | `POST /api/preempt/speculate` |
| Models endpoint | `GET /api/models` |
| Audit | `GET /api/audit/{verify,recent,stats}` |
| Dev primitives | `POST /api/dev/{exec,write,read,stage}` (gated) |
| Public landing | `/` → `public/index.html` |
| Spin up V100 | `gollama up` |
| Stop V100 | `gollama down` |

---

*Generated 2026-04-16 from live codebase + git state + GitHub API audit.*
