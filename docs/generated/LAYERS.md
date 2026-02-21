# KURO Layer Pipeline

`POST /api/stream` executes L0–L11 in sequence.

| Layer | File | Purpose |
|-------|------|---------|
| L0 | `layers/iron_dome.js` | Rate limiting, IP banning, abuse detection |
| L1 | `layers/guest_gate.js` | Anonymous session provisioning |
| L2 | `layers/(inline RAG)` | Per-user vector retrieval (edubba / mnemosyne namespace) |
| L3 | `layers/context_reactor.js` | Dynamic context injection (time, user profile, tools) |
| L4 | `layers/bloodhound.js` | Debug / trace mode for dev clients |
| L5 | `layers/iff_gate.js` | Identity / intent / flag classification |
| L6 | `layers/voter_layer.js` | Multi-model consensus voting (optional) |
| L7 | `layers/thinking_stream.js` | Extended reasoning (Claude extended thinking) |
| L8 | `layers/frontier_assist.js` | Anthropic API fallback when Ollama unavailable |
| L9 | `layers/output_enhancer.js` | Artifact extraction, table rendering, code blocks |
| L10 | `layers/audit_chain.js` | Tamper-evident event log append |
| L11 | `layers/shadow/mnemosyneCache.js` | Per-user conversation memory persistence |

## Context Router (`layers/tools/context_router.cjs`)

Maps Gemma-classified intent → relevant context pack sections:

| Intent | Context Sections |
|--------|-----------------|
| `auth`      | ARCHITECTURE, INTERFACES#auth-endpoints |
| `vfs`       | INTERFACES#vfs-endpoints, PHASES#phase-1, generated/DB.md |
| `sandbox`   | generated/SANDBOX.md, ARCHITECTURE#layer-pipeline |
| `security`  | SECURITY.md |
| `agent`     | generated/TOOLS.md, generated/LAYERS.md |
| `database`  | generated/DB.md |
| `routes`    | generated/ROUTES.md, INTERFACES.md |
| `general`   | ARCHITECTURE.md |
