# KURO OS — Claude Code Intelligence Layer

> This file is loaded at the start of every Claude Code session.
> Read it fully before touching any file. It is your memory,
> your architecture map, and your operating contract.

---

## 1. OPERATOR

Henry George Lowe-Sevilla
Founder, KURO Technologies
ORCID: 0009-0006-4864-9740 · ABN: 45 340 322 909
Based: Da Nang, Vietnam

Communication style: Direct. No preamble. No summaries of what
you just did unless asked. Print PASS/FAIL per stage. Explain
failures in one sentence. Never auto-restart PM2 — print the
command for Henry to run manually.

---

## 2. SYSTEM OVERVIEW

KURO OS is a sovereign AI operating system. It runs locally on
GPU-accelerated hardware with no cloud inference dependencies.

Primary instance: TensorDock server
  Path: /mnt/kurodisk/kuro/core
  Model: huihui-ai/qwen3.5-abliterated:9b via Ollama (gollama)
  NOTE: .env still reads gemma-4-abliterated:e4b — needs manual update:
        sed -i 's/gemma-4-abliterated:e4b/huihui-ai\/qwen3.5-abliterated:9b/' .env
  Port: 3000
  Process: PM2 → kuro-core  (currently NOT running — pm2 list is empty)
  DB: SQLite via better-sqlite3 at $KURO_DATA/kuro.db (WAL mode)
  Frontend: React 18 + Vite, built to /dist
  Server version: v7.0.3 (1-GPU commercial build, RTX 5090 32GB)

Secondary system: NeuroKURO
  Path: /mnt/kurodisk/kuro/core/neuro/
  API: /api/neuro/* — mounted via mountNeuroRoutes()
  Model version: v1.0
  Validated: SANDD N=368 MAE=0.31h · MMASH N=20 MAE=0.29h
  Patent: IP Australia provisional, filed 2 April 2026
  Preprint: zenodo.org/records/18869320
  Manuscript: JSR-03-26-0011 (under review)

---

## 3. ARCHITECTURE LAWS — NEVER VIOLATE THESE

1. CJS THROUGHOUT
   Every file uses require() and module.exports
   No import/export. No .mjs. No ESM.
   File extensions: .cjs for new backend files

2. AUTH PATTERN
   req.user.userId — always this, never req.user.id
   requireAuth middleware gates all private routes
   Guest sessions: ephemeral, no write access

3. NO NEW NPM PACKAGES without explicit approval
   Check if a native Node.js solution exists first
   If a package is needed: state the reason before installing

4. NEVER AUTO-RESTART PM2
   Print: pm2 restart kuro-core
   Let Henry run it manually

5. BACKUP BEFORE MODIFY
   For any file over 100 lines:
   cp [file] [file].bak.[timestamp] before editing

6. AXIOS FOR STREAMING
   Never use Node.js Web Streams API for SSE
   Use axios with responseType: 'stream'

7. DB MIGRATIONS ARE ADDITIVE
   Never DROP TABLE or ALTER in a breaking way
   Always use CREATE TABLE IF NOT EXISTS
   Always use try/catch on ALTER TABLE

8. SQLITE WAL MODE
   db.pragma('journal_mode = WAL') on every connection

---

## 4. DIRECTORY MAP

/mnt/kurodisk/kuro/core/
├── server.cjs              — Express HTTP server v7.0.3, all routes
├── .env                    — Environment variables (KURO_MODEL stale — see §2)
├── package.json            — v9.0.0 dependencies
├── vite.config.js          — Frontend build
├── index.html              — SPA entry
├── public/                 — Static files served by Express
│   └── index.html          — kuroglass.net site
├── dist/                   — Built React SPA
├── layers/                 — Cognitive pipeline + support layers
│   ├── auth/               — Auth, DB schema, OTP, OAuth
│   ├── liveedit/           — Stream controller
│   ├── shadow/             — Mnemosyne, Babylon, ShadowVPN
│   │   └── mnemosyneCache.js — L11: Memory persistence
│   ├── vision/             — GPU mutex, orchestrator, routes
│   ├── tools/              — Context router, VFS tools
│   ├── vfs/                — Virtual filesystem
│   ├── search/             — Search layer
│   ├── web/                — Web layer
│   ├── git/                — Git integration
│   ├── runner/             — Code execution runner
│   ├── preempt/            — Preemption control
│   ├── observability/      — Metrics + tracing
│   ├── security/           — Security hardening
│   ├── stripe/             — Stripe billing
│   ├── iron_dome.js        — L0: Rate limiting, IP banning
│   ├── guest_gate.js       — L1: Anonymous sessions
│   ├── memory.js           — L2: Session memory (getSession/addToHistory)
│   ├── context_reactor.js  — L3: Dynamic context injection
│   ├── bloodhound.js       — L4: Debug/trace mode
│   ├── iff_gate.js         — L5: Intent classification
│   ├── semantic_router.js  — Intent routing + temperature control
│   ├── voter_layer.js      — L6: Multi-model consensus
│   ├── thinking_stream.js  — L7: Extended reasoning + think-block filter
│   ├── synthesis_layer.js  — Model synthesis pipeline
│   ├── frontier_assist.js  — L8: Anthropic API fallback
│   ├── output_enhancer.js  — L9: Artifact extraction
│   ├── maat_refiner.js     — Output purification (purify())
│   ├── audit_chain.js      — L10: Tamper-evident log
│   ├── agent_orchestrator.js — Agent routing + skill gates
│   ├── fire_control.js     — Safety circuit breaker
│   ├── edubba_archive.js   — recall() / inscribe() semantic memory
│   ├── mcp_connectors.js   — MCP file/terminal/session connectors
│   ├── sms_forward.cjs     — SMS: +61415138341 → +84832385150
│   ├── sandbox_routes.cjs  — Code execution sidecar routes
│   ├── capability_router.cjs — Capability-based routing
│   ├── sovereignty_dashboard.js — System health dashboard
│   ├── self_heal.js        — Auto-recovery watchdog
│   ├── model_warmer.js     — Model warmup on start
│   ├── flight_computer.js  — Mission control logic
│   ├── smash_protocol.js   — SMASH safety protocol
│   ├── kuro_drive.js       — Drive integration
│   ├── kuro_lab.js         — Lab environment
│   ├── harvester.js        — Data harvesting
│   ├── artifact_renderer.js — Artifact rendering
│   ├── reactor_telemetry.js — Telemetry
│   ├── request_validator.js — Input validation
│   └── web_search.js       — Web search integration
├── neuro/                  — NeuroKURO circadian engine
│   ├── circadian_model.js  — Core phase reconstruction
│   ├── circadian_model.test.js — Test suite
│   ├── circadian_model_math.md — Mathematical derivation
│   ├── circadian_validation.js — Validation harness
│   ├── neuro_routes.cjs    — API routes (/api/neuro/*)
│   ├── msf.js              — Mid-sleep function computation
│   ├── sandd_validation.js — SANDD dataset (N=368, MAE=0.31h)
│   ├── mmash_validation.js — MMASH dataset (N=20, MAE=0.29h)
│   ├── VALIDATION_SUMMARY.md — Ground truth results (NEVER EDIT)
│   ├── RESEARCH_BRIEF.md   — Research context
│   ├── paper_draft.md      — Manuscript draft
│   └── README.md
├── modules/                — Feature modules
│   ├── pay/                — KURO::PAY (x402 + EMVCo QR + Solana)
│   │   ├── index.cjs       — Router assembly + x402 route mounting
│   │   ├── x402_card_bridge.cjs — EMVCo QR parser + Solana USDC bridge
│   │   ├── connectors/
│   │   │   ├── wise.cjs        — Wise API (mock if WISE_API_TOKEN absent)
│   │   │   ├── basiq.cjs       — Basiq open banking (AUS)
│   │   │   ├── coingecko.cjs   — FX rates via CoinGecko
│   │   │   ├── frankfurter.cjs — ECB FX fallback
│   │   │   ├── independent_reserve.cjs — AUS crypto exchange
│   │   │   └── xmr.cjs         — Monero connector
│   │   ├── core/
│   │   │   ├── ledger.cjs  — Transaction ledger
│   │   │   ├── audit.cjs   — Pay audit log
│   │   │   ├── cache.cjs   — Rate/quote cache
│   │   │   └── events.cjs  — EventEmitter bus
│   │   ├── intelligence/
│   │   │   ├── pay_brain.cjs       — Payment AI router
│   │   │   ├── insight_engine.cjs  — Spending analytics
│   │   │   ├── oracle.cjs          — Predictive pricing
│   │   │   └── addiction_mirror.cjs — Behavioural spend analysis
│   │   └── routes/
│   │       ├── accounts.cjs    — /api/pay/accounts
│   │       ├── ops.cjs         — /api/pay/ops
│   │       ├── insights.cjs    — /api/pay/insights
│   │       ├── vaults.cjs      — /api/pay/vaults
│   │       ├── webhooks.cjs    — /api/pay/webhook (raw body, no JSON parse)
│   │       └── audit_routes.cjs — /api/pay/audit
│   ├── grab/               — KURO::GRAB (Grab API + WebSocket)
│   │   ├── grab_auth.cjs, grab_client.cjs, grab_config.json
│   │   ├── grab_routes.cjs, grab_ws.cjs, har_import.cjs
│   └── wager/              — KURO::WAGER (trading engine)
│       ├── db.cjs, engine.cjs, fusion.cjs, index.cjs
│       ├── quantum.cjs, router.cjs, tesla.cjs
└── src/                    — React frontend
    ├── App.jsx             — OS root
    ├── components/
    │   ├── apps/           — App windows
    │   └── os/             — OS chrome
    └── stores/             — Zustand state

---

## 5. LAYER PIPELINE — POST /api/stream

L0  iron_dome.js         — Rate limit, IP ban, abuse detect
L1  guest_gate.js        — Anon session provisioning
L2  memory.js            — Session memory retrieval
L3  context_reactor.js   — Time, profile, tools injection
L4  bloodhound.js        — Debug/trace mode
L5  iff_gate.js + semantic_router.js — Intent classification + routing
L6  voter_layer.js       — Multi-model consensus (optional)
L7  thinking_stream.js   — Extended reasoning + think-block filter
L8  frontier_assist.js   — Anthropic fallback
L9  output_enhancer.js + maat_refiner.js — Artifact extraction + purify
L10 audit_chain.js       — Tamper-evident log
L11 mnemosyneCache.js    — Memory persistence

Each layer loaded via try/catch. Silent failure = degraded mode.
Never remove try/catch from layer loading.

---

## 6. KURO::PAY — x402 / EMVCo QR REFERENCE

Module: modules/pay/
Routes: /api/pay/* (mounted in server.cjs)

QR Standards (x402_card_bridge.cjs):
  VietQR    — EMVCo AID A000000775  (VND, Vietnam)
  PromptPay — EMVCo AID A000000677  (THB, Thailand)
  DuitNow   — EMVCo AID A000000680  (MYR, Malaysia)
  QRIS      — EMVCo ID.CO.QRIS      (IDR, Indonesia)
  QR Ph     — EMVCo AID A000000632  (PHP, Philippines interbank)
  GCash     — URL deep-link         (PHP, Philippines)
  Maya      — URL deep-link         (PHP, Philippines)

Settlement:
  Primary:  Solana SPL USDC
            Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
            Wallet: KURO_SOLANA_WALLET env var (required for live)
            Commission: 1.2% (KURO_COMMISSION_RATE in bridge file)
  FX rail:  Wise API → CoinGecko → Frankfurter (fallback chain)
            Wise runs in mock mode if WISE_API_TOKEN is absent

Key routes:
  POST /api/pay/x402/parse-qr       — Parse EMVCo QR, no auth required
  POST /api/pay/x402/initiate       — Start payment, requireAuth
  POST /api/pay/webhook             — Wise/Stripe (raw body, no JSON parse)
  GET  /api/pay/accounts            — requireAuth
  POST /api/pay/ops                 — requireAuth
  GET  /api/pay/insights            — requireAuth
  GET  /api/pay/audit               — requireAuth

Invariants:
  - Static QR (no embedded amount) → reject before Stripe charge
  - CRC16-CCITT (poly 0x1021, init 0xFFFF) validated on every QR
  - Webhook route must use express.raw() — never express.json()

---

## 7. NEUROKURO API REFERENCE

Base: /api/neuro/

POST /api/neuro/phase
  Auth: requireAuth
  Body: { sleepOnset, wakeTime, timezone, source? }
  Returns: full phase object + curve + metadata

POST /api/neuro/phase/simulate
  Auth: none (public demo)
  Returns: simulation result with X-Simulation-Mode: true

GET  /api/neuro/history
  Auth: requireAuth
  Query: ?limit=7

GET  /api/neuro/compounds
  Auth: none
  Returns: compound library with evidence levels

POST /api/neuro/protocol
  Auth: requireAuth
  Body: { sleepOnset, wakeTime, timezone, compoundIds[] }

POST /api/neuro/v1/phase
  Auth: API key (Authorization: Bearer)
  B2B endpoint — key-gated, logged, versioned

Phase output shape:
{
  phase: {
    ct: 6.3,
    ct_label: "CT6-8 — Cortisol peak window",
    local_time_anchor: "14:20",
    confidence: 0.81,
    confidence_breakdown: {
      consistency_score: 0.85,
      data_density: "high|medium|manual",
      variance_score: 0.42
    },
    source: "oura|apple_health|manual"
  },
  next_transition: { ct, description, local_time },
  curve: [{ hour, ct, alertness_index, label }],
  metadata: { timezone, model_version, computed_at }
}

---

## 8. ENVIRONMENT VARIABLES

KURO_PORT=3000
KURO_DATA=/mnt/kurodisk/kuro/data
KURO_MODEL=huihui-ai/qwen3.5-abliterated:9b   ← UPDATE .env (currently stale)
OLLAMA_HOST=http://localhost:11434
NODE_ENV=production
KURO_PROFILE=enterprise                        — gov|enterprise|lab

# KURO::PAY
WISE_API_TOKEN=           — Wise FX rail (absent = mock mode)
WISE_SANDBOX=             — true for Wise sandbox
KURO_PAY_SECRET=          — x402 HMAC signing
SOLANA_RPC=               — defaults to mainnet-beta RPC
KURO_SOLANA_WALLET=       — settlement wallet pubkey (required for live)
STRIPE_SECRET_KEY=        — Stripe card capture

# SMS Forward
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
SMS_FORWARD_TO=+84832385150
SMS_WEBHOOK_URL=https://kuroglass.net/sms/incoming

---

## 9. ACTIVE PRODUCTS

KURO::PAY
  x402-native multi-QR foreign card bridge (7 EMVCo standards)
  AUD debit card → Stripe → USDC (Solana) → local QR payout
  Wise connector in mock mode — needs WISE_API_TOKEN for live FX
  Status: fully scaffolded, needs KURO_SOLANA_WALLET + live keys

KURO::GRAB
  Grab API integration + WebSocket session replay
  Module: modules/grab/
  Status: scaffolded

KURO::WAGER
  Trading/wagering engine (quantum + tesla + fusion engines)
  Module: modules/wager/
  Status: scaffolded

KURO::FLUX / KURO::HUNT
  Volatility event confirmation trading system
  OFI signals + funding rate arb + fractional Kelly 0.25x
  NeuroKURO phase as master circuit breaker
  Status: spec complete, not deployed

SMS_FORWARD
  Layer: layers/sms_forward.cjs
  Routes: POST /sms/incoming
  Forwards +61415138341 → +84832385150

---

## 10. REASONING PROTOCOLS

When given a task, before writing any code:
1. Read all relevant files — never assume structure
2. State what you found
3. State what you will change and why
4. State what you will NOT touch
5. Then execute

When debugging:
1. Read the error in full
2. Trace the call stack
3. Check the layer that failed
4. Fix root cause — never mask errors with try/catch

When adding a new route:
1. Check requireAuth pattern in server.cjs
2. Match exact middleware order
3. Use req.user.userId always
4. Log with securityLog() for any auth event

When modifying neuro/:
1. Never change validation results (MAE values are ground truth)
2. Never change MODEL_VERSION without explicit instruction
3. Evidence levels: literature / inferred / experimental only
4. No medical claims — timing and modelling language only

When modifying modules/pay/:
1. x402_card_bridge.cjs — never break CRC16 validation
2. Wise connector falls back to mock — do not remove MOCK guard
3. Static QR (no amount) must be rejected before Stripe charge
4. Webhook route requires express.raw() — never JSON middleware

---

## 11. DISK MANAGEMENT

Primary disk: /mnt/kurodisk
Monitor with: df -h /mnt/kurodisk
If >85% full:
  sudo rm -rf /mnt/kurodisk/flux/hf_cache/*
  HF_HOME=/mnt/kurodisk/.cache
  AUDIOCRAFT_CACHE_DIR=/mnt/kurodisk/.cache

Never write model downloads to system disk.
Always verify free space before large operations.

---

## 12. PM2 PROCESS MAP

kuro-core     — main server (port 3000)  ← currently NOT running
kuro-sandbox  — code execution sidecar (port 3101, 127.0.0.1 only)

Commands:
  pm2 list
  pm2 logs kuro-core --lines 50
  pm2 restart kuro-core    ← print this, never auto-run
  pm2 save

---

## 13. CURRENT PRIORITIES (April 2026)

1. kuroglass.net — public showcase site + live simulator
2. NeuroKURO v1 frontend — phase dashboard, actigraphy curve
3. KURO::AFFECT deployment — affect_store.cjs pipeline
4. KURO::PAY — WISE_API_TOKEN + KURO_SOLANA_WALLET + live VietQR test
5. KURO::FLUX — TensorDock Singapore, paper trading first
6. Manolo Beelke call — CNS clinical development (WhatsApp +491736189707)

---

## 14. WHAT MAKES OPUS-LEVEL REASONING HERE

You are working on genuinely novel research:
- First x402-native Southeast Asian QR payment layer (7 rail standards)
- First circadian phase API validated at MAE 0.31h without wearables
- First trading system with biological state as risk circuit breaker

When you encounter ambiguity:
- Default to the most conservative option that preserves existing
  functionality
- Never assume a field name — grep for it
- Never assume an import exists — check package.json
- When in doubt: read, don't write

The codebase is a living system with a patent-pending research
layer embedded in it. Treat it accordingly.

---

## 15. PERFORMANCE & TOKEN ECONOMY

Optimising an AI agent like Claude Code involves a mix of
**algorithmic constraints** and **contextual pruning**. These
rules force the model into lower-resource, higher-velocity
patterns — cheaper bills, faster apps.

### 15.1 Algorithmic Efficiency & Complexity

- **Prioritise Time Complexity:** When writing logic for data
  processing, always favour O(n log n) or O(n) solutions over
  O(n²). If a nested loop is proposed, provide a brief
  justification or a hash-map alternative.
- **Vectorisation over Iteration:** In Python or JS environments,
  use vectorised operations (e.g., NumPy, Map/Reduce) instead of
  explicit `for` loops. Reduces execution time and keeps logic
  concise.
- **Space-Time Trade-offs:** Use **memoisation** or **dynamic
  programming** for recursive functions where sub-problems
  overlap (e.g., `F(n) = F(n-1) + F(n-2)`). Don't wait for a
  performance bottleneck to implement caching.

### 15.2 Mathematical Optimisation

Treat maths as a precision tool, not a text-generation task.

- **Numerical Stability:** When implementing complex formulas,
  prioritise numerically stable forms. Use **log-sum-exp** for
  probabilities to avoid underflow/overflow.
- **Bitwise Operations:** For low-level flags, permissions, or
  power-of-two calculations, use bitwise operators (e.g.,
  `x & (x - 1)` to check for power of two) rather than standard
  arithmetic.
- **Precision Management:** Unless high precision is required,
  default to `float32` or `int16` for large arrays to save
  memory and compute cycles.

### 15.3 Token Usage & Context Pruning

Every character costs tokens.

**Strict output formatting:**

| Rule | Instruction |
|---|---|
| **No Yapping** | Avoid conversational filler (e.g., "Sure, I can help with that"). Go straight to the code or the answer. |
| **Concise Diffs** | When suggesting changes, only show the relevant lines and immediate context. Do not rewrite entire files unless necessary. |
| **Minimalist Docs** | Write JSDoc/Docstrings only for public APIs. Use concise, one-line comments for internal logic. |

**Context control:**

- **Dependency Pruning:** When adding imports, do not import
  entire libraries. Use named imports (e.g.,
  `import { debounce } from 'lodash'`) to keep bundle and
  mental map small.
- **Atomic Responses:** If a task can be split into smaller,
  independent functions, do so. Easier debugging, prevents
  context window filling with monolithic blocks.

### 15.4 Think-Step Constraints

If hallucinating math or over-complicating logic, use a
verification constraint:

> Before outputting code involving complex algorithms (graph
> traversals, matrix decompositions), perform a silent
> **Internal Verification** step. Verify that the chosen
> algorithm A is the most efficient for dataset size N and M
> constraints.

### 15.5 Quick-Reference Rules

- **Computational Efficiency:** Default to O(n) or O(n log n).
  Avoid O(n²) unless n < 100.
- **Mathematical Precision:** Use bitwise ops for flag checks
  and pre-calculated constants for frequently used values.
- **Token Economy:** No conversational fluff. Provide code-only
  responses for small fixes. Use `diff` format for file edits.
- **Memory:** Use generator functions (e.g., `yield`) for
  processing large datasets to maintain a low memory
  footprint.
