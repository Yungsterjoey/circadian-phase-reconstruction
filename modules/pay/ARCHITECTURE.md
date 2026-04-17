# KURO::PAY — Full Architecture Specification

> **Status:** Reference spec for LLM review and onboarding.
> **Module root:** `/mnt/kurodisk/kuro/core/modules/pay/`
> **Runtime:** Node.js CommonJS, Express Router, better-sqlite3
> **Date of snapshot:** 2026-04-17

KURO::PAY is a foreign-card → SE-Asia QR payment engine. Stripe funds the AUD leg; **x402** is the settlement protocol; KURO operates its own x402 facilitator which dispatches to rail operators (NAPAS247, PromptPay, BI-FAST, InstaPay, DuitNow).

---

## Table of Contents

1. [Module Topology](#1-module-topology)
2. [HTTP Surface](#2-http-surface)
3. [State Model](#3-state-model)
4. [The Settlement Pipeline](#4-the-settlement-pipeline)
5. [Rail Adapter Contract](#5-rail-adapter-contract)
6. [Connectors](#6-connectors)
7. [Commission, Daily Limits, Reserve](#7-commission-daily-limits-reserve)
8. [Audit Hash Chain](#8-audit-hash-chain)
9. [ATM Warm-Token Flow](#9-atm-warm-token-flow)
10. [Async Intelligence Pipeline](#10-async-intelligence-pipeline)
11. [Security Posture](#11-security-posture)
12. [Lifecycle](#12-lifecycle)
13. [Environment Variable Surface](#13-environment-variable-surface)
14. [Data Flow Examples](#14-data-flow-examples)

---

## 1. Module Topology

```
modules/pay/
├── index.cjs                    # Router composer + initPayModule lifecycle
├── pay_routes.cjs               # v2 HTTP surface (/api/pay/*)
├── shim_v1_routes.cjs           # v1 strangler-fig (/api/pay/x402/{quote,create,confirm})
├── pay_ledger.cjs               # Users-DB tables (payments, cards, atm, reserve)
├── x402_pay.cjs                 # x402 client → KURO facilitator
├── stripe_connector.cjs         # AUD charge + warm-token pre-auth
├── vietqr_parser.cjs            # EMVCo TLV + CRC16 + NAPAS BIN map + GPS bbox
│
├── core/
│   ├── ledger.cjs               # /opt/kuro/data/pay.db (second DB)
│   ├── audit.cjs                # SHA-256 hash chain
│   ├── commission_policy.cjs    # free/pro/sov tiers
│   ├── quote_engine.cjs         # fee calc + daily limit
│   ├── rail_registry.cjs        # adapter registration
│   └── rail_router.cjs          # detect → adapter dispatch
│
├── rails/                       # One adapter per QR standard
│   ├── vietqr.cjs               # LIVE (wraps x402_pay)
│   ├── promptpay.cjs            # UNTESTED → x402 preferred, Nium fallback
│   ├── qris.cjs                 # UNTESTED → idem
│   ├── qrph.cjs                 # UNTESTED → idem
│   └── duitnow.cjs              # UNTESTED → idem
│
├── connectors/
│   ├── x402_facilitator.cjs     # Public probe + fallback to internal
│   ├── nium_payout.cjs          # Non-VN fallback
│   ├── wise.cjs                 # User payouts
│   ├── wise_treasury.cjs        # Commission sweep (import-path-guarded)
│   ├── xmr.cjs
│   ├── basiq.cjs                # AU open-banking
│   ├── coingecko.cjs            # Rate-limited (25/min)
│   ├── frankfurter.cjs          # ECB FX
│   └── independent_reserve.cjs  # HMAC-signed
│
├── routes/
│   ├── webhooks.cjs             # Stripe + Wise webhooks
│   ├── accounts.cjs, vaults.cjs, ops.cjs (SSE)
│   ├── insights.cjs, intelligence.cjs
│   └── audit_routes.cjs, monitoring.cjs
│
├── intelligence/
│   ├── models.cjs               # Ollama (ORCHESTRATOR, BRAIN, pay_brain)
│   ├── worker.cjs               # intelligence_queue consumer
│   ├── pay_brain.cjs            # huihui-moe-abliterated:24b
│   ├── merchant_normalizer.cjs
│   ├── anomaly_detector.cjs
│   ├── ticket_triager.cjs
│   ├── fx_explainer.cjs
│   ├── receipt_search.cjs
│   ├── admin_assistant.cjs      # planner → executor → synthesiser
│   ├── prompt_safety.cjs        # <user_input> wrap + injection detect
│   └── addiction_mirror.cjs     # In-memory, never blocks
│
└── scheduler/
    └── commission_payout_hourly.cjs   # Wise-treasury hourly sweep
```

### Design patterns worth calling out

- **Strangler fig.** `shim_v1_routes.cjs` preserves the original `/api/pay/x402/{quote,create,confirm}` contract by HTTP-loopback-calling v2's `/api/pay/initiate` on `127.0.0.1:KURO_PORT`. Old clients keep working; real logic lives in exactly one place.
- **Side-effect registration.** `rails/*.cjs` and `intelligence/{merchant_normalizer,anomaly_detector,ticket_triager}.cjs` self-register with their registries on `require()`. `index.cjs` needs only one import line per module to wire the whole pipeline.
- **Two SQLite DBs.** Users/auth DB holds transactional rows (payments, cards, atm_sessions, reserve). `/opt/kuro/data/pay.db` holds pay-module-owned state (ledger, audit chain, insights cache, intelligence queue). Isolation means auth DB migrations can't break pay, and vice versa.

---

## 2. HTTP Surface

### 2.1 v2 Router — `pay_routes.cjs` (mounted at `/api/pay`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/parse` | Parse raw QR → `{standard, bankBin, accountNumber, amount, merchantName, gps, confidence, qrType}` |
| POST | `/card/setup` | Create SetupIntent, warm-token pre-auth |
| GET  | `/card/list` | List saved cards |
| POST | `/initiate` | **Full pipeline (see §4)** — QR → Stripe → x402 → receipt |
| POST | `/atm/initiate` | ATM variant, requires warm token + GPS + conf≥0.85 + qrType=`atm` |
| GET  | `/history` | Paginated payment history |
| GET  | `/receipt/:id` | Fetch full x402 receipt JSON |
| GET  | `/status/:id` | Poll settlement status |
| POST | `/camera/open` | Camera session hint (PWA) |
| POST | `/webhook/stripe` | Stripe webhook (raw body) |
| GET  | `/fx-rate` | Current AUD→target rate |
| POST | `/detect` | Rail-router dry run |
| POST | `/admin/sweep` | Admin commission sweep |
| GET  | `/policy` | Public tier policy + localized minima |

### 2.2 v1 Shim — `shim_v1_routes.cjs`

| Path | Behavior |
|---|---|
| `POST /api/pay/x402/quote` | Public preview using `INDICATIVE_LOCAL_PER_AUD` (no auth required) |
| `POST /api/pay/x402/create` | HTTP loopback to `/api/pay/initiate` |
| `POST /api/pay/x402/confirm` | Reads ledger; requires `row.status==='settled'` **AND** `receipt.settlement.success===true` to return `trulySettled` |

### 2.3 Other routers

- `routes/webhooks.cjs` — Stripe webhook signature verify; Wise webhook classifies via `payBrain`, auto-completes if conf≥0.85 and amount≤$500.
- `routes/ops.cjs` — SSE `/ops/execute`; `payBrain.parseNLP` → dispatch `withdraw_aud | convert_to_btc | send_xmr | convert_forex`.
- `routes/insights.cjs` — SSE `/insights/stream`, `/insights/refresh`.
- `routes/intelligence.cjs` — `/api/pay/intel/{search,fx-copy,anomalies,anomalies/:id/ack}`.

---

## 3. State Model

### 3.1 Users/Auth DB — `pay_ledger.cjs`

**`kuro_pay_payments`** (master txn row)

```
id, user_id, status,
qr_raw, merchant_account, merchant_name,
bank_bin, bank_code, bank_name,
amount_aud, amount_vnd,
stripe_payment_intent_id,
x402_receipt_json, x402_tx_signature, x402_network,
settlement_latency_ms,
warm_token_id, created_at, settled_at
```

**`kuro_pay_cards`** — saved Stripe PaymentMethods + `warm_token_id`, `warm_token_expires_at` (+300s).

**`kuro_pay_atm_sessions`** — `expires_at = +60s`. Gated by GPS ∈ country bbox + confidence≥0.85.

**`kuro_pay_reserve`** — `reserve_rate=0.03`. Negative rows for dispute chargebacks.

### 3.2 Pay DB — `/opt/kuro/data/pay.db` (`core/ledger.cjs`)

| Table | Purpose |
|---|---|
| `pay_ledger` | Flat mirror for analytics/export |
| `pay_audit` | Hash-chained append-only log (§8) |
| `pay_insights_cache` | Memoized LLM outputs |
| `pay_vaults`, `pay_round_ups` | Savings primitives |
| `pay_payees` | bsb / payid / xmr / btc destinations |
| `merchant_cache` | Normalized merchant tokens |
| `pay_anomalies` | Tier: info / notice / warn |
| `support_tickets` | Triaged customer issues |
| `intelligence_queue` | Async task queue (worker input) |

Migrations are **additive `ALTER TABLE`**, no destructive drops. WAL enabled.

---

## 4. The Settlement Pipeline

**Endpoint:** `POST /api/pay/initiate`

```
 ┌───────────────┐   ┌────────────┐   ┌───────────┐   ┌──────────────┐
 │ parseEMVQR    │ → │ rail_router│ → │ quote_eng │ → │ fxSpot or    │
 │ (vietqr_parser│   │ isRoutable │   │ calcFee+  │   │ facilitator. │
 │  .parse)      │   │            │   │ dailyLimit│   │ getRate()    │
 └───────────────┘   └────────────┘   └───────────┘   └──────────────┘
        │                                                      │
        ▼                                                      ▼
 ┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
 │ insertPayment() │───▶ │ stripe.create    │───▶ │ x402.buildPayment  │
 │ status=pending  │     │ PaymentIntent    │     │ Required() +       │
 │                 │     │ (AUD, card, cap) │     │ HMAC-sign payload  │
 └─────────────────┘     └──────────────────┘     └────────────────────┘
                                                           │
                                                           ▼
                                               ┌────────────────────┐
                                               │ x402.verifyPayment │
                                               │ POST facilitator/  │
                                               │     settle (20s)   │
                                               └────────────────────┘
                                                           │
          ┌────────────────────────────────────────────────┤
          ▼                                                ▼
 ┌──────────────────┐                        ┌──────────────────────┐
 │ generateReceipt  │                        │ updatePaymentSettled │
 │ + audit.append   │                        │ enqueue:             │
 │                  │                        │  merchant_normalize, │
 │                  │                        │  anomaly_detect      │
 └──────────────────┘                        └──────────────────────┘
```

### 4.1 Stripe amount math (`stripe_connector.calculateAmount`)

```
amountUSDraw = base × (1 + σ + R_stripe + R_kuro) + F_fixed

σ         = 0.0075     (KURO_PAY_VOLATILITY_BUFFER)
R_stripe  = 0.014
R_kuro    = 0.005
F_fixed   = 0.30
caps      = PAYG $200, NOMAD $500
```

### 4.2 x402 payload (`x402_pay.buildPaymentRequired`)

- Scheme map: `vietqr→fiat-napas247`, `promptpay→fiat-promptpay`, `qris→fiat-bifast`, `qrph→fiat-instapay`, `duitnow→fiat-duitnow`.
- Canonical JSON (keys sorted, `signature` excluded) → HMAC-SHA256 with `KURO_FACILITATOR_RAIL_SECRET_<SCHEME>`.
- Nonce = 16 random bytes hex, reused as `Idempotency-Key`.
- POST `${FACILITATOR_URL}/settle`, `X-x402-Version: 2`, `X-KURO-Svc-Key`, 20 s timeout, `validateStatus: null` (we inspect every status).

### 4.3 Critical design notes

- **Stripe funds, x402 settles.** Stripe is the AUD card acquirer; x402 is the cross-rail protocol carrying the settlement instruction to whichever fiat rail (NAPAS247, etc.) pays the merchant in local currency. They never mix — Stripe webhooks only confirm funding; x402 confirms payout.
- **Nonce = Idempotency-Key.** The same random 16-byte hex secures the signature *and* deduplicates the settlement request. A retried `POST /settle` with the same body is safe — the facilitator claims the nonce once.
- **`validateStatus: null`** means axios never throws on non-2xx. x402 error responses are structured JSON and we want to capture them into `facilitatorResponse`, not drop them into a generic exception handler.

---

## 5. Rail Adapter Contract

All adapters implement:

```js
{ name, aid, country, currency,
  detect(qr), parse(qr), quote(ctx),
  initiate(ctx), status(ctx) }
```

and call `rail_registry.register(adapter)` on require.

| Rail | AID | Currency | Live? | Connector path |
|---|---|---|---|---|
| vietqr    | A000000775010111 | VND | **LIVE** | direct `x402_pay` |
| promptpay | A000000677010111 | THB | UNTESTED | `_connector_dispatch('x402','nium',…)` |
| qris      | A000000775015545 | IDR | UNTESTED | idem |
| qrph      | A000000677010113 | PHP | UNTESTED | idem |
| duitnow   | A000000615020215 | MYR | UNTESTED | idem |

**Rail router** (`core/rail_router.cjs`) runs all `detect()` in parallel with constants:

- `MINIMUM_CONFIDENCE = 0.6`
- `AMBIGUITY_THRESHOLD = 0.1` (top-2 gap)
- `fallback = 'usdc_wallet'`

**`_connector_dispatch(preferred, fallback, …)`** — tries preferred (x402) with 10 s timeout; on any error or timeout, tries fallback (Nium). Both attempts are logged.

---

## 6. Connectors

| Connector | Role | Notes |
|---|---|---|
| `x402_facilitator.cjs` | Probe public x402 foundation endpoint, fallback to internal KURO facilitator | Never relitigate; use internal on public fail |
| `nium_payout.cjs` | Non-VN rail fallback | Mock mode supported |
| `wise.cjs` | User AUD withdrawals | |
| `wise_treasury.cjs` | Hourly commission sweep only | **Import-path guard**: throws if required from `modules/pay/rails/`, `core/rail_router`, or `core/quote_engine` |
| `xmr.cjs` | Monero payouts | |
| `basiq.cjs` | AU open-banking (income/expense) | |
| `coingecko.cjs` | BTC/ETH quotes | **Token-bucket rate limiter** — 25 req/min |
| `frankfurter.cjs` | ECB FX (free, daily) | |
| `independent_reserve.cjs` | AU crypto exchange | HMAC-SHA256 signed requests |

### Defense-in-depth notes

- **`wise_treasury`'s import guard** inspects the stack trace on import and throws a fatal error if the caller is inside a user-payment path. Even if a future dev accidentally wires the commission treasury into a user rail adapter, the process won't start.
- **CoinGecko's token-bucket** guards against burst traffic during insight refresh — a single page load can fan out many quote requests; the bucket smooths this below CoinGecko's free-tier rate limit without dropping requests.

---

## 7. Commission, Daily Limits, Reserve

### 7.1 Tiers (`core/commission_policy.cjs`)

| Tier | min fee AUD | rate | cap AUD | daily limit AUD |
|---|---|---|---|---|
| free | 0.19 | 3.0% | 5.00 | 500 |
| pro | 0 | 1.5% | 3.00 | 2 000 |
| sov | 0 | 0.75% | none | 10 000 |

- `calcFee`: `min ≤ gross × rate ≤ cap`, then `ceilCents` (never undercharge at display precision).
- `localizedMinimum(minAUD, cur, fx)`: rounds up to `LOCAL_ROUND_UNIT[cur]` (VND=500, IDR=1000, others=1).

### 7.2 Daily limit (`core/quote_engine.checkDailyLimit`)

Reads `pay_daily_usage(user_id, date)` — throws `DAILY_LIMIT_EXCEEDED` with `{limitAUD, usedAUD, requestedAUD}` if `used + requested > limit`.

### 7.3 Reserve

- `reserve_rate = 0.03` of each settled AUD.
- Dispute chargebacks post a **negative** reserve row — chain-preserving, no row mutation.

### 7.4 Commission payout (`scheduler/commission_payout_hourly.cjs`)

- Default **OFF** (`KURO_PAY_PAYOUT_ENABLED`).
- Min $5, max $500 per run. Sweeps accumulated commissions via `wise_treasury` (required at call-time, never at module load, to respect the import-path guard).

---

## 8. Audit Hash Chain

File: `core/audit.cjs`

```
row.hash = sha256(prev_hash | timestamp | event_type | ledger_id | actor)
first prev_hash = '0'
```

`verifyChain()` walks `rowid` ascending, recomputing. Any mismatch = tamper signal.

**Events emitted:**
`payment.initiated`, `payment.settled`, `payment.failed`, `reserve.posted`, `reserve.negative`, `commission.swept`, `admin.sweep`, `card.setup`.

---

## 9. ATM Warm-Token Flow

```
/card/setup          →  Stripe SetupIntent
                    ↓
                    warmPreAuth: $0 manual-capture PaymentIntent
                                 valid 300 s, saved as warm_token
                    ↓
/atm/initiate        →  gates: warm_token fresh? GPS ∈ country bbox?
                                confidence ≥ 0.85? qrType === 'atm'?
                    ↓
                    Capture warm intent → <1 RTT to first byte of settle
                    ↓
                    Create atm_session (expires +60 s)
                    ↓
                    Record reserve, enqueue intelligence tasks
```

### Why this shape

- **Warm-token = pre-flight of the card.** The $0 manual-capture intent has already done 3-D Secure, AVS, funding check. When the user actually taps "Pay" at the ATM, Stripe only needs a capture call — <1 RTT first-byte. Critical when the user is standing in front of an ATM in a foreign country on roaming data.
- **Four-gate ATM defense**: warm + GPS + confidence + qrType. Missing any one fails closed. Even if an attacker steals a session cookie, they can't drain cash without also spoofing GPS *and* presenting a QR the parser tagged `qrType='atm'`.

---

## 10. Async Intelligence Pipeline

### 10.1 Models (`intelligence/models.cjs`)

| Profile | Ollama model | Used by |
|---|---|---|
| ORCHESTRATOR | `qwen3.5-abliterated:0.8B` | Fast triage / routing |
| BRAIN | `gemma-4-abliterated:e4b` | Admin NL, ticket triage |
| pay_brain | `huihui-moe-abliterated:24b` (instant / deep / sovereign profiles) | NLP ops dispatch, Wise classification |

### 10.2 Queue / Worker (`core/ledger.cjs` + `intelligence/worker.cjs`)

- Table: `intelligence_queue(id, type, payload, attempts, next_run_at)`.
- `MAX_ATTEMPTS = 3`.
- `worker.register(type, handler)` — self-registration on require.
- `processOne` → `handler(payload)` → on error, increment attempts + backoff; on max, mark failed.

### 10.3 Modules

- **`merchant_normalizer.cjs`** — canonical merchant token; `MIN_CONFIDENCE=0.5`; writes `merchant_cache`.
- **`anomaly_detector.cjs`** — tiers: `info | notice | warn`; writes `pay_anomalies`.
- **`ticket_triager.cjs`** — BRAIN, categorizes support tickets, writes `support_tickets`.
- **`fx_explainer.cjs`** — 500 ms budget (hard cap); renders "why did I pay this rate" explanation.
- **`receipt_search.cjs`** — RAG over receipts/merchants.
- **`admin_assistant.cjs`** — two-turn: `PLANNER_SYSTEM` emits `{tool, args}` (JSON only, schema-constrained) → `admin_tools.invoke()` → `SYNTH_SYSTEM` produces `{answer}` (≤4 bullets). Fails closed to `FAIL = {answer:'Query failed — try rephrasing.'}`.
- **`prompt_safety.cjs`** — `wrap(userInput)` wraps `<user_input>…</user_input>` and strips known injection patterns. Echo detector rejects LLM output that contains system-prompt fragments.
- **`addiction_mirror.cjs`** — in-memory only, never blocks a payment; tracks compulsive behavior signals for user self-reflection.

### Design notes

- **Pull-based queue, not push.** `updatePaymentSettled` simply writes a row to `intelligence_queue`. If the worker is down, Ollama is down, or the V100 VM is stopped, payments still settle — intelligence work accumulates and drains on restart. User-facing settlement never depends on LLM availability.
- **JSON-schema-constrained LLM output** (admin_assistant): `PLANNER_SYSTEM` says "JSON only, schema: `{tool, args}`". `safeParse` returns `null` on malformed JSON → `FAIL`. The LLM is treated as an unreliable parser, not a trusted agent.
- **`prompt_safety.wrap`** is the critical injection defense. Any time user text is concatenated into an LLM prompt (ticket body, QR merchant name, search query), it's wrapped in `<user_input>` delimiters and screened. Synth/planner prompts explicitly ignore content inside those tags for instruction-following purposes.

---

## 11. Security Posture

| Surface | Control |
|---|---|
| x402 payload integrity | HMAC-SHA256 canonical-JSON signature, per-scheme secret |
| Replay | 16-byte nonce = Idempotency-Key (facilitator claims once) |
| Stripe webhooks | Raw-body signature verify |
| LLM prompt injection | `prompt_safety.wrap` + echo detector |
| Commission treasury isolation | `wise_treasury` import-path guard |
| Audit tamper | SHA-256 hash chain, `verifyChain()` |
| ATM geo-spoof | GPS bbox + confidence gate + qrType tag |
| Rate limiting | CoinGecko token-bucket (25/min) |
| Daily exposure | Per-tier daily AUD cap, DB-backed |
| PII in receipts | No raw card PAN; only Stripe intent IDs |

---

## 12. Lifecycle

`initPayModule()`:

```
1. ledger.initSchema()                (creates pay.db tables, WAL on)
2. insightEngine.start()              (periodic cache warm)
3. worker.start()                     (intelligence_queue consumer)
4. xmr.selfCheck()                    (optional XMR node probe)
5. commissionCron.start()             (hourly, if enabled)

Side-effect imports (top of index.cjs):
   rails/*, intelligence/{merchant_normalizer,anomaly_detector,ticket_triager}
```

**Shutdown:** `worker.stop()`, `commissionCron.stop()`, close DB handles (better-sqlite3 is synchronous).

---

## 13. Environment Variable Surface

```
# x402 / facilitator
X402_FACILITATOR_URL              (default http://127.0.0.1:3000/api/facilitator)
KURO_FACILITATOR_SECRET           (X-KURO-Svc-Key header)
KURO_FACILITATOR_RAIL_SECRET_FIAT_NAPAS247
KURO_FACILITATOR_RAIL_SECRET_FIAT_PROMPTPAY
KURO_FACILITATOR_RAIL_SECRET_FIAT_BIFAST
KURO_FACILITATOR_RAIL_SECRET_FIAT_INSTAPAY
KURO_FACILITATOR_RAIL_SECRET_FIAT_DUITNOW

# Stripe
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
KURO_PAY_VOLATILITY_BUFFER        (default 0.0075)

# Pricing
KURO_PAY_COMMISSION               (legacy flat; tiers override)

# Loopback (v1 shim)
KURO_PORT

# Scheduler
KURO_PAY_PAYOUT_ENABLED           (default false)

# Ollama
OLLAMA_BASE_URL                   (proxy http://127.0.0.1:11434)

# Fallback connectors
NIUM_API_KEY, WISE_API_KEY, WISE_TREASURY_API_KEY
IR_API_KEY, IR_API_SECRET
BASIQ_API_KEY, COINGECKO_API_KEY
```

---

## 14. Data Flow Examples

### 14.1 Happy-path VietQR payment

```
Client QR image
  → POST /api/pay/initiate {qr, cardId}
    → vietqr_parser.parse → standard=vietqr, bankBin=970436, acct=…
    → rail_router.detect → vietqr.adapter
    → quote_engine.quote → fee 1.5%, net AUD, daily-limit OK
    → frankfurter/ir fxSpot → AUD→VND
    → pay_ledger.insertPayment status=pending
    → stripe_connector.createPaymentIntent(AUD, card) → pi_…
    → x402_pay.buildPaymentRequired(parsedQR, AUD, VND, pi_…, ref)
      → scheme=fiat-napas247, canonical-JSON HMAC signed
    → x402_pay.verifyPayment → POST facilitator/settle
      → 200 {success:true, txSignature:…, network:napas247}
    → x402_pay.generateReceipt
    → pay_ledger.updatePaymentSettled (+ enqueue merchant_normalize, anomaly_detect)
    → audit.append('payment.settled', …)
  → 200 {receiptId, txSignature, settlementLatencyMs, …}
```

### 14.2 Non-VN rail (e.g. PromptPay) with x402 outage

```
  _connector_dispatch('x402','nium', …)
    → x402 attempt times out after 10 s
    → nium_payout.send(…) succeeds
    → receipt.network='nium', receipt.fallback_used=true
    → anomaly_detector enqueued (notice: x402 outage)
```

### 14.3 ATM cash withdrawal

```
Prereq: /card/setup ran ≤ 300 s ago → warm_token live
  → POST /api/pay/atm/initiate {qr, gps}
    → vietqr_parser.parse → qrType='atm', confidence 0.92
    → gate: warm_token fresh ✓, GPS ∈ VN bbox ✓, conf ≥ 0.85 ✓, qrType=atm ✓
    → stripe capture warm intent → <1 RTT
    → x402_pay.verifyPayment → fiat-napas247 ATM scheme
    → atm_session row, expires +60 s
    → audit.append('payment.settled' + atm flag)
  → 200 {sessionId, receiptId}
```

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **x402** | Settlement protocol run by the x402 Foundation (Linux Foundation, April 2026). Supports fiat + local currency rails. KURO operates its own x402 facilitator. |
| **Facilitator** | HTTP service that verifies HMAC-signed x402 payloads, claims the nonce, and dispatches to the underlying rail operator. |
| **Rail operator** | The real-time national payment scheme (NAPAS247, PromptPay, BI-FAST, InstaPay, DuitNow) that moves money to the recipient bank. |
| **Warm token** | A $0 manual-capture Stripe PaymentIntent held for ≤ 300 s so the user's next charge is a single capture call. |
| **Strangler fig** | Migration pattern where old routes are wrapped to delegate to new ones, letting the old surface decay without breaking callers. |
| **Side-effect registration** | Module `require()` has the side effect of registering the module with a central registry (rails, worker handlers). |

## Appendix B — Files referenced

Primary:
`index.cjs`, `pay_routes.cjs`, `shim_v1_routes.cjs`, `pay_ledger.cjs`, `x402_pay.cjs`, `stripe_connector.cjs`, `vietqr_parser.cjs`.

Core: `core/{ledger,audit,commission_policy,quote_engine,rail_registry,rail_router}.cjs`.

Rails: `rails/{vietqr,promptpay,qris,qrph,duitnow}.cjs`.

Connectors: `connectors/{x402_facilitator,nium_payout,wise,wise_treasury,xmr,basiq,coingecko,frankfurter,independent_reserve}.cjs`.

Routes: `routes/{webhooks,accounts,vaults,ops,insights,intelligence,audit_routes,monitoring}.cjs`.

Intelligence: `intelligence/{models,worker,pay_brain,merchant_normalizer,anomaly_detector,ticket_triager,fx_explainer,receipt_search,admin_assistant,prompt_safety,addiction_mirror}.cjs`.

Scheduler: `scheduler/commission_payout_hourly.cjs`.
