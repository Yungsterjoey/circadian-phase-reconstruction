/**
 * KURO OS — SERVER v7.0.3 [1-GPU COMMERCIAL BUILD]
 *
 * v7.0.3 FIXES:
 *   RT-PATH-01..04: All require paths corrected (auth/stripe/tier were pointing to wrong dirs)
 *   RT-QUOTA-01: checkQuota signature fixed (userId, tier, action — was missing tier param)
 *   RT-GPU-01: MODEL_REGISTRY consolidated for 1x RTX 5090 (32GB) — 2 models + embed
 *   RT-GPU-02: kuro-core context pushed to 65536 tokens (commercial quality)
 *   RT-GPU-03: Thermal downgrade + synthesis layer updated for new model set
 *   RT-VISION-01: Free tier vision quota changed to 1/week
 *
 * v7.0: Auth v2 (OAuth + sessions), Stripe (webhook body fix), SPA routing
 * Guest: 5 messages/24hr, no token needed
 * Paid: tier-gated access per subscription
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cookieParser = require('cookie-parser');

// ═══════════════════════════════════════════════════════════════════════════
// DEPLOYMENT PROFILE
// ═══════════════════════════════════════════════════════════════════════════
const PROFILES = {
  gov: { name:'Government', safety:true, execAllowed:false, writeScope:'data', auditLevel:'full', maxAgentTier:1, redaction:true, retention:'7y', blockNSFW:true, corsOrigin:'same' },
  enterprise: { name:'Enterprise', safety:true, execAllowed:true, writeScope:'data', auditLevel:'full', maxAgentTier:3, redaction:true, retention:'3y', blockNSFW:false, corsOrigin:'whitelist' },
  lab: { name:'Laboratory', safety:false, execAllowed:true, writeScope:'all', auditLevel:'standard', maxAgentTier:3, redaction:false, retention:'90d', blockNSFW:false, corsOrigin:'localhost' }
};
const ACTIVE_PROFILE = process.env.KURO_PROFILE || 'enterprise';
const PROFILE = PROFILES[ACTIVE_PROFILE] || PROFILES.enterprise;
const ALLOWED_ORIGINS = (process.env.KURO_CORS_ORIGINS || '').split(',').filter(Boolean);

// ═══════════════════════════════════════════════════════════════════════════
// LAYER MODULES (try/catch fallbacks — every layer is optional)
// ═══════════════════════════════════════════════════════════════════════════
let ironDomeCheck, iffCheck, getSession, addToHistory, getContext, clearSession;
let semanticRoute, fireControlCheck, recall, inscribe, purify, enhanceOutput;
let stripThinkBlocks, createThinkStreamEmitter;

try { ({ ironDomeCheck } = require('./layers/iron_dome.js')); } catch(e) { ironDomeCheck = () => ({ status:'CLEAR', safe:true, score:0 }); }
try { ({ iffCheck } = require('./layers/iff_gate.js')); } catch(e) { iffCheck = () => ({ clientId:'anon', rateLimited:false }); }
try { ({ getSession, addToHistory, getContext, clearSession } = require('./layers/memory.js')); } catch(e) { getContext=()=>[]; addToHistory=()=>{}; clearSession=()=>{}; getSession=()=>({}); }
try { ({ semanticRoute } = require('./layers/semantic_router.js')); } catch(e) { semanticRoute = () => ({ intent:'chat', mode:'main', temperature:0.7 }); }
try { ({ fireControlCheck } = require('./layers/fire_control.js')); } catch(e) { fireControlCheck = () => ({ safe:true, message:'Clear' }); }
try { ({ recall, inscribe } = require('./layers/edubba_archive.js')); } catch(e) { recall = () => ({ found:false }); inscribe = () => {}; }
try { ({ purify } = require('./layers/maat_refiner.js')); } catch(e) { purify = (x) => x; }
try { ({ enhanceOutput } = require('./layers/output_enhancer.js')); } catch(e) { enhanceOutput = (x) => x; }
try { ({ stripThinkBlocks, createThinkStreamEmitter } = require('./layers/thinking_stream.js')); } catch(e) { stripThinkBlocks = (x) => x; createThinkStreamEmitter = () => ({ emit:()=>{}, flush:()=>null }); }

let routeToAgent, buildSkillGates, AGENTS;
try { ({ routeToAgent, buildSkillGates, AGENTS } = require('./layers/agent_orchestrator.js')); }
catch(e) { AGENTS={}; routeToAgent=(i,m)=>({agentId:'insights',agent:{name:'Agent:Insights',skills:['read','compute']},mode:m||'main',downgraded:false,skillGates:{canRead:true,canWrite:false,canExec:false,canCompute:true,canAggregate:false}}); buildSkillGates=()=>({canRead:true,canWrite:false,canExec:false,canCompute:true,canAggregate:false}); }

let logEvent, verifyChain, verifyAll, recentEntries, auditStats, sealDay;
try { ({ logEvent, verifyChain, verifyAll, recentEntries, auditStats, sealDay } = require('./layers/audit_chain.js')); }
catch(e) { logEvent=()=>({}); verifyChain=()=>({valid:true,entries:0}); verifyAll=()=>({allValid:true}); recentEntries=()=>[]; auditStats=()=>({total:0}); sealDay=()=>({}); }

let createGatedConnectors, fileConn, terminalConn, sessionConn;
try { const mcp=require('./layers/mcp_connectors.js'); createGatedConnectors=mcp.createGatedConnectors; fileConn=mcp.file; terminalConn=mcp.terminal; sessionConn=mcp.session; }
catch(e) { createGatedConnectors=()=>({file:{},terminal:{},session:{}}); fileConn={}; terminalConn={}; sessionConn={}; }

// Auth — v2: session cookie + legacy token waterfall
let auth, resolveUser, fingerprint;
try { const am=require('./layers/auth/auth_middleware.cjs'); auth=am.auth; resolveUser=am.resolveUser; fingerprint=am.fingerprint; }
catch(e) {
  // Fallback: try flat layers/ path (backwards compat)
  try { const am=require('./layers/auth_middleware.js'); auth=am.auth; resolveUser=am.resolveUser; fingerprint=am.fingerprint; }
  catch(e2) {
    console.warn('[WARN] auth_middleware not loaded — open auth (LAB ONLY)');
    const ou={userId:'operator',name:'Operator',role:'operator',devAllowed:true,level:3,skills:['read','write','exec','compute','aggregate'],canAdmin:true,canSealAudit:true,canClearRAG:true,maxAgentTier:3};
    resolveUser=()=>ou; fingerprint=()=>'no-auth';
    const pt=(q,s,n)=>{q.user=ou;n();}; auth={required:pt,optional:pt,operator:pt,analyst:pt,dev:pt,admin:pt};
  }
}

// Validator
let sanitizeSessionId, sanitizeFilename, validatePath, validateMode, validateNamespace, validateBody, securityHeaders, requestIdMw;
try {
  const rv=require('./layers/request_validator.js');
  sanitizeSessionId=rv.sanitizeSessionId; sanitizeFilename=rv.sanitizeFilename; validatePath=rv.validatePath;
  validateMode=rv.validateMode; validateNamespace=rv.validateNamespace; validateBody=rv.validateBody;
  securityHeaders=rv.securityHeaders; requestIdMw=rv.requestId;
} catch(e) {
  sanitizeSessionId=(s)=>s?.replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,64)||null;
  sanitizeFilename=(f)=>f?.replace(/[\/\\:*?"<>|\.\.]/g,'_').slice(0,128)||`upload_${Date.now()}`;
  validatePath=()=>({safe:true}); validateMode=(m)=>m||'main'; validateNamespace=(n)=>n||'edubba';
  validateBody=()=>({valid:true,errors:[]});
  securityHeaders=(q,s,n)=>{s.setHeader('X-Content-Type-Options','nosniff');s.setHeader('X-Frame-Options','DENY');s.setHeader('X-XSS-Protection','1; mode=block');s.setHeader('Referrer-Policy','strict-origin-when-cross-origin');s.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');n();};
  requestIdMw=(q,s,n)=>{q.requestId=crypto.randomBytes(8).toString('hex');n();};
}

// Guest Gate
let checkGuestQuota, consumeGuestMessage, guestOrAuth, guestStats, DEMO_LIMIT;
try {
  const gg=require('./layers/guest_gate.js');
  checkGuestQuota=gg.checkGuestQuota; consumeGuestMessage=gg.consumeGuestMessage;
  guestOrAuth=gg.guestOrAuth; guestStats=gg.guestStats; DEMO_LIMIT=gg.DEMO_LIMIT;
} catch(e) {
  checkGuestQuota=()=>({allowed:true,remaining:5,used:0,limit:5}); consumeGuestMessage=()=>{};
  guestOrAuth=(ru)=>(q,s,n)=>{q.user=ru(q)||{userId:'guest',name:'Guest',role:'guest',level:0,isGuest:true};q.isGuest=!ru(q);n();};
  guestStats=()=>({activeGuests:0}); DEMO_LIMIT=5;
}

// LiveEdit + Vision + Preempt (additive route mounting)
let streamController, mountLiveEditRoutes, mountVisionRoutes, mountPreemptRoutes;
try { streamController = require('./layers/liveedit/stream_controller.cjs'); } catch(e) { try { streamController = require('./layers/stream_controller.cjs'); } catch(e2) { streamController = { registerStream:()=>{}, unregisterStream:()=>{}, checkCorrection:()=>null, appendPartial:()=>{}, getPartial:()=>'' }; } }
try { mountLiveEditRoutes = require('./layers/liveedit/liveedit_routes.cjs'); } catch(e) { try { mountLiveEditRoutes = require('./layers/liveedit_routes.cjs'); } catch(e2) { mountLiveEditRoutes = () => {}; } }
try { mountVisionRoutes = require('./layers/vision/vision_routes.cjs'); } catch(e) { try { mountVisionRoutes = require('./layers/vision_routes.cjs'); } catch(e2) { mountVisionRoutes = () => {}; } }
try { mountPreemptRoutes = require('./layers/preempt/preempt_routes.cjs'); } catch(e) { mountPreemptRoutes = () => {}; }

// Auth routes + Stripe routes
let createAuthRoutes, createStripeRoutes, stripeWebhookHandler;
try { createAuthRoutes = require('./layers/auth/auth_routes.cjs'); } catch(e) { createAuthRoutes = null; console.warn('[WARN] Auth routes not loaded:', e.message); }

// Sandbox routes (isolated code execution — does NOT reuse /api/dev/*)
let createSandboxRoutes = null;
try { createSandboxRoutes = require('./layers/sandbox_routes.cjs'); } catch(e) { console.warn('[WARN] Sandbox routes not loaded:', e.message); }
try { ({ createStripeRoutes, stripeWebhookHandler } = require('./layers/stripe/stripe_routes.cjs')); } catch(e) { createStripeRoutes = null; stripeWebhookHandler = null; console.warn('[WARN] Stripe routes not loaded:', e.message); }

// Tier gate
let tierGate;
try { tierGate = require('./layers/auth/tier_gate.cjs'); } catch(e) { tierGate = null; }

// A3+A5: Synthesis layer (v7.0.3)
let synthesize, SYNTHESIS_CONFIG;
try { ({ synthesize, SYNTHESIS_CONFIG } = require('./layers/synthesis_layer.js')); }
catch(e) { synthesize = null; SYNTHESIS_CONFIG = null; console.warn('[WARN] Synthesis layer not loaded:', e.message); }

// ═══ v7.0.3 ADDITIONS ═══
// B1: Reactor Telemetry
let mountTelemetryRoutes, recommendModel, thermalAdvisory, fullSnapshot;
try { ({ mountTelemetryRoutes, recommendModel, thermalAdvisory, fullSnapshot } = require('./layers/reactor_telemetry.js')); }
catch(e) { mountTelemetryRoutes = () => {}; recommendModel = () => ({ model: null }); thermalAdvisory = () => ({ status: 'unknown' }); fullSnapshot = async () => ({}); console.warn('[WARN] Reactor telemetry not loaded:', e.message); }

// B2: Self-Healing Remediation
let selfHeal;
try { selfHeal = require('./layers/self_heal.js'); }
catch(e) { selfHeal = null; console.warn('[WARN] Self-heal not loaded:', e.message); }

// B3: Sovereignty Dashboard
let mountSovereigntyRoutes, recordLocal, recordFrontier;
try { ({ mountSovereigntyRoutes, recordLocal, recordFrontier } = require('./layers/sovereignty_dashboard.js')); }
catch(e) { mountSovereigntyRoutes = () => {}; recordLocal = () => {}; recordFrontier = () => {}; }

// B4: Cognitive Snapshots
let mountSnapshotRoutes;
try { ({ mountSnapshotRoutes } = require('./layers/cognitive_snapshots.js')); }
catch(e) { mountSnapshotRoutes = () => {}; }

// B5: Predictive Model Warming
let predictiveWarm, setStreaming, warmStats;
try { ({ predictiveWarm, setStreaming, warmStats } = require('./layers/model_warmer.js')); }
catch(e) { predictiveWarm = async () => ({}); setStreaming = () => {}; warmStats = () => ({}); }

// ═══ FUSION MODULES (Phase 1-3) ═══
let shouldUseFrontier, streamFrontier, consumeFrontierQuota, getActiveProvider;
try { ({ shouldUseFrontier, streamFrontier, consumeFrontierQuota, getActiveProvider } = require('./layers/frontier_assist.js')); }
catch(e) { shouldUseFrontier = () => ({ useFrontier: false, reason: 'module_not_loaded' }); streamFrontier = null; consumeFrontierQuota = () => {}; getActiveProvider = () => ({ configured: false }); }

let ingestFile, retrieveChunks, buildContextInjection, compactSession, handleUpload;
try { ({ ingestFile, retrieveChunks, buildContextInjection, compactSession, handleUpload } = require('./layers/context_reactor.js')); }
catch(e) { ingestFile = async () => ({ success: false }); retrieveChunks = async () => []; buildContextInjection = () => ''; compactSession = async () => ({ compacted: false }); handleUpload = () => ({}); }

let webSearch, formatSearchForContext;
try { const ws = require('./layers/web_search.js'); webSearch = ws.search; formatSearchForContext = ws.formatForContext; }
catch(e) { webSearch = async () => ({ error: true, reason: 'module_not_loaded' }); formatSearchForContext = () => ''; }

let mountLabRoutes;
try { ({ mountLabRoutes } = require('./layers/kuro_lab.js')); }
catch(e) { mountLabRoutes = () => {}; }

let mountArtifactRoutes;
try { ({ mountArtifactRoutes } = require('./layers/artifact_renderer.js')); }
catch(e) { mountArtifactRoutes = () => {}; }

// ═══════════════════════════════════════════════════════════════════════════

// Intent Router (Gemma 4B — fast classification for L4)
let routeIntent;
try { ({ routeIntent } = require('./layers/router/intent_router.cjs')); }
catch(e) { routeIntent = async () => ({ route: 'BRAIN', tools: [], priority: 'normal', confidence: 0.5, notes: 'Router not loaded' }); }

// Capability Router (Adaptive Scaling — same model, different configs)
let capRouter;
try {
  capRouter = require('./layers/capability_router.cjs');
  // Wire infra signals so capability router can check GPU state
  capRouter.setInfraSignals(thermalAdvisory, () => ollamaHealth.healthy);
  console.log('[CAP] Capability router loaded');
} catch(e) {
  capRouter = {
    POWER_PROFILES: { instant: { label: '⚡ Instant', ctx: 4096, temperature: 0.7, thinking: false, reasoning: false, tools: ['read'], streaming: 'fast', maxHistory: 4, ragTopK: 1 } },
    TIER_CEILING: { free: 'instant', pro: 'instant', sovereign: 'instant' },
    PROFILE_ORDER: ['instant'],
    parseDeviceCaps: () => ({}),
    resolvePolicy: () => ({ profile: 'instant', config: { ctx: 4096, temperature: 0.7, thinking: false, reasoning: false, tools: ['read'], maxHistory: 4, ragTopK: 1 }, downgraded: false }),
    applyPolicy: () => ({}),
    storePolicy: () => {},
    getPolicy: () => null,
    clearPolicy: () => {}
  };
  console.warn('[WARN] Capability router not loaded:', e.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════════════════
const app = express();
const corsOpts = { origin: PROFILE.corsOrigin==='*'?true:PROFILE.corsOrigin==='same'?false:ALLOWED_ORIGINS.length?ALLOWED_ORIGINS:true, credentials:true, maxAge:86400 };
app.use(cors(corsOpts));
app.use(securityHeaders);
app.use(requestIdMw);
app.use(cookieParser());

// ┌──────────────────────────────────────────────────────────────────────────
// │ RT-04: Stripe webhook MUST be registered BEFORE express.json()
// │ Stripe needs the raw body to verify webhook signature.
// └──────────────────────────────────────────────────────────────────────────
if (stripeWebhookHandler) {
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  console.log('[STRIPE] Webhook route mounted (raw body)');
}

// NOW mount JSON body parser for everything else
app.use(express.json({ limit: '10mb' }));

// Serve built frontend assets
app.use(express.static(path.join(__dirname, 'dist'), { index: false }));

const PORT = parseInt(process.env.KURO_PORT || process.env.PORT || '3100', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DATA_DIR = process.env.KURO_DATA || '/var/lib/kuro';
const CODE_DIR = process.env.KURO_CODE || '/opt/kuro';
const VECTOR_DIR = path.join(DATA_DIR, 'vectors');

[DATA_DIR, VECTOR_DIR, path.join(DATA_DIR, 'sessions'), path.join(DATA_DIR, 'uploads'), path.join(DATA_DIR, 'docs'), path.join(DATA_DIR, 'patches'), path.join(DATA_DIR, 'sandboxes')].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const MODEL_REGISTRY = {
  // ═══ GCP NVIDIA L4 (24GB VRAM) — Router + Brain Architecture ═══
  // Router: fast intent classification (Gemma3 4B, ~3GB VRAM)
  // Brain: heavy reasoning (Qwen3-30B-A3B VL abliterated, ~10GB active VRAM)
  // Budget: 3 + 10 + 4 (KV cache) = 17GB used, 7GB headroom

  'kuro-router':   { name: 'KURO::ROUTER',  ollama: 'gemma3:4b',                                                      ctx: 4096,  thinking: false, tier: 'system',     desc: 'Intent classifier (Gemma3 4B)', vram: 3 },
  'kuro-core':     { name: 'KURO::CORE',     ollama: 'huihui_ai/qwen3-vl-abliterated:30b-a3b-instruct-q4_K_M',        ctx: 16384, thinking: false, tier: 'brain',      desc: 'Sovereign base intelligence (Qwen3-30B-A3B VL Abliterated)', vram: 10 },
  'kuro-embed':    { name: 'KURO::EMBED',     ollama: 'nomic-embed-text',                                              ctx: 2048,  embedding: true, tier: 'subconscious' }
};

// Skill → Model routing (all skills → kuro-core except creative/unrestricted → kuro-moe)
const SKILL_MODELS = {
  chat: 'kuro-core', general: 'kuro-core', code: 'kuro-core', dev: 'kuro-core',
  reasoning: 'kuro-core', research: 'kuro-core', analysis: 'kuro-core',
  vision: 'kuro-core', image: 'kuro-core', crypto: 'kuro-core', security: 'kuro-core',
  stealth: 'kuro-core', opsec: 'kuro-core', creative: 'kuro-core', unrestricted: 'kuro-core',
  exec: 'kuro-core', fast: 'kuro-core', triage: 'kuro-core',
};

// Tier enforcement: free=core only, pro=core, sovereign=core+moe
const MODEL_TIER_ACCESS = {
  'kuro-router':   'free',
  'kuro-core':     'free',
};
const TIER_NUM = { free: 0, pro: 1, sovereign: 2 };

function resolveModel(skill, intent, userTier = 'free') {
  let modelId = 'kuro-core';
  if (skill && SKILL_MODELS[skill]) modelId = SKILL_MODELS[skill];
  else if (intent && SKILL_MODELS[intent]) modelId = SKILL_MODELS[intent];

  // Tier gate — downgrade to core if user can't access the model
  const requiredTier = MODEL_TIER_ACCESS[modelId] || 'sovereign';
  if ((TIER_NUM[userTier] || 0) < (TIER_NUM[requiredTier] || 0)) {
    return 'kuro-core'; // safe fallback
  }
  return modelId;
}

let ollamaHealth = { healthy: true, lastCheck: 0, failures: 0 };
async function checkOllama() {
  if (Date.now() - ollamaHealth.lastCheck < 10000) return ollamaHealth.healthy;
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    ollamaHealth = { healthy: true, lastCheck: Date.now(), failures: 0 };
    return true;
  } catch(e) {
    ollamaHealth.failures++;
    ollamaHealth.lastCheck = Date.now();
    ollamaHealth.healthy = ollamaHealth.failures < 3;
    return ollamaHealth.healthy;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════
const MODE_PROMPTS = {
  main: 'You are KURO, a sovereign AI intelligence running on-premises.\n\nCOMMUNICATION:\n- Direct and genuine\n- Match response length to query complexity\n- Use <think>...</think> for complex reasoning only\n- Address user as Operator when appropriate',
  dev: 'You are KURO::DEV, autonomous coding mode.\n\nPROTOCOL:\n1. Plan first — use <plan>...</plan> tags\n2. Execute without asking permission\n3. Debug autonomously\n\nOUTPUT FORMAT:\n- Terminal: <terminal>$ command</terminal>\n- Files: <file path="..." action="create|modify|delete">content</file>',
  bloodhound: 'You are KURO::BLOODHOUND, deep research mode.\nMethodical, cross-reference sources.\nUse <research>...</research> for analysis.',
  war_room: 'You are KURO::WAR_ROOM, strategic planning mode.\nAll angles, risks, countermeasures.\nUse <strategy>...</strategy> for planning.'
};
if (PROFILE.safety) { Object.keys(MODE_PROMPTS).forEach(k => { MODE_PROMPTS[k] = 'POLICY: Respond within organisational guidelines. Decline requests violating data governance, privacy, or safety policies.\n\n' + MODE_PROMPTS[k]; }); }

const SKILL_BEHAVIORS = { code: 'SENIOR SOFTWARE ARCHITECT MODE\n- Clean production-ready code\n- Use <file> and <terminal> tags', research: 'DEEP RESEARCH MODE\n- Multi-angle analysis\n- Confidence levels', creative: 'CREATIVE MODE\n- Engaging warm\n- Push boundaries', hardware: 'HARDWARE SPECIALIST\n- Protocols pinouts specs', shopping: 'SHOPPING ASSISTANT\n- Objective comparison', default: '' };
const GHOST_PROTOCOLS = { thinking: '\n[THINKING] Wrap reasoning in <think>...</think>.\n', reasoning: '\n[REASONING] Step-by-step in <reasoning>...</reasoning>.\n', incubation: '\n[INCUBATION] Exploratory in <incubation>...</incubation>.\n', redTeam: '\n[RED TEAM] Critique in <critique>...</critique>.\n', nuclearFusion: '\n[FUSION] Multi-angle in <fusion>...</fusion>.\n' };
const LAYERS = { 0: 'Threat Filter', 1: 'Rate Limiter', 2: 'Knowledge Retrieval', 3: 'Intent Router', 4: 'Context Engine', 5: 'Agent Orchestrator', 6: 'Confidence Engine', 7: 'Prompt Builder', 8: 'Quality Filter', 9: 'Output Enhancer', 10: 'Stream Controller', 11: 'Response Cache' };

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR STORE
// ═══════════════════════════════════════════════════════════════════════════
class VectorStore {
  constructor(ns) { this.ns = ns; this.fp = path.join(VECTOR_DIR, `${ns}.json`); this.data = this._load(); }
  _load() { try { if (fs.existsSync(this.fp)) return JSON.parse(fs.readFileSync(this.fp, 'utf8')); } catch(e) {} return { documents: [], embeddings: [], metadata: [] }; }
  _save() { try { fs.writeFileSync(this.fp, JSON.stringify(this.data)); } catch(e) {} }
  async add(d, e, m = []) { for (let i = 0; i < d.length; i++) { this.data.documents.push(d[i]); this.data.embeddings.push(e[i]); this.data.metadata.push(m[i] || { timestamp: Date.now() }); } this._save(); return { added: d.length }; }
  cosine(a, b) { if (!a || !b || a.length !== b.length) return 0; let d = 0, ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; ma += a[i] ** 2; mb += b[i] ** 2; } return d / (Math.sqrt(ma) * Math.sqrt(mb) || 1); }
  query(e, k = 5, t = 0.7) { return this.data.embeddings.map((em, i) => ({ index: i, score: this.cosine(e, em), document: this.data.documents[i], metadata: this.data.metadata[i] })).filter(s => s.score >= t).sort((a, b) => b.score - a.score).slice(0, k); }
  clear() { this.data = { documents: [], embeddings: [], metadata: [] }; this._save(); }
  count() { return this.data.documents.length; }
}
const edubbaStore = new VectorStore('edubba');
const mnemosyneStore = new VectorStore('mnemosyne');

async function getEmbedding(t) { try { const r = await axios.post(`${OLLAMA_URL}/api/embeddings`, { model: MODEL_REGISTRY['kuro-embed'].ollama, prompt: t.slice(0, 8000) }, { timeout: 30000 }); return r.data.embedding; } catch(e) { return null; } }
async function getEmbeddings(ts) { const r = []; for (const t of ts) r.push(await getEmbedding(t)); return r; }
async function extractText(fp) { const e = path.extname(fp).toLowerCase(); if (['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.sh', '.css', '.html', '.csv', '.cjs', '.mjs'].includes(e)) return fs.readFileSync(fp, 'utf8'); if (e === '.pdf') { try { const p = require('pdf-parse'); return (await p(fs.readFileSync(fp))).text; } catch(e) { return '[PDF failed]'; } } return '[Unsupported]'; }
function chunkText(t, s = 500, o = 50) { const c = [], w = t.split(/\s+/); for (let i = 0; i < w.length; i += s - o) c.push(w.slice(i, i + s).join(' ')); return c; }

function sendSSE(r, d) { try { r.write('data: ' + JSON.stringify(d) + '\n\n'); } catch(e) {} }
function sendLayer(r, n, s, x, ct) { if (ct === 'chat') return; const p = { type: 'layer', layer: n, name: LAYERS[n] || `L${n}`, status: s }; if (x) Object.assign(p, x); sendSSE(r, p); }
function buildSystemPrompt(mode, skill, opts, rag, am) { let p = MODE_PROMPTS[mode] || MODE_PROMPTS.main; p += `\nRunning as KURO::CORE [${mode.toUpperCase()}]`; if (am?.agent) { p += ` via ${am.agent.name}`; if (am.downgraded) p += ` [DOWNGRADED: ${am.reason}]`; } p += `\nProfile: ${PROFILE.name}\n`; if (skill && SKILL_BEHAVIORS[skill]) p += '\n' + SKILL_BEHAVIORS[skill] + '\n'; if (opts.thinking) p += GHOST_PROTOCOLS.thinking; if (opts.reasoning) p += GHOST_PROTOCOLS.reasoning; if (opts.incubation) p += GHOST_PROTOCOLS.incubation; if (opts.redTeam) p += GHOST_PROTOCOLS.redTeam; if (opts.nuclearFusion) p += GHOST_PROTOCOLS.nuclearFusion; if (rag?.length) { p += '\n[RETRIEVED CONTEXT]\n'; rag.forEach((d, i) => p += `<context id="${i + 1}" score="${d.score?.toFixed(2) || '?'}">\n${d.document}\n</context>\n`); p += '\nUse above context when relevant.\n'; } return p; }

// ═══════════════════════════════════════════════════════════════════════════
// MOUNT AUTH + STRIPE ROUTES
// ═══════════════════════════════════════════════════════════════════════════
if (createAuthRoutes) {
  app.use('/api/auth', createAuthRoutes(auth));
  console.log('[AUTH] v2 routes mounted (session + OAuth)');
}
if (createStripeRoutes) {
  app.use('/api/stripe', createStripeRoutes(auth));
  console.log('[STRIPE] Checkout + portal routes mounted');
}

// Admin routes (lightweight, no separate file)
try {
  const { stmts: adminStmts } = require('./layers/auth/db.cjs');
  const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.userId === 'anon') return res.status(401).json({ error: 'Auth required' });
    const row = adminStmts.isAdmin.get(req.user.userId);
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  };
  app.get('/api/admin/whoami', auth.required, requireAdmin, (req, res) => {
    res.json({ admin: true, userId: req.user.userId, email: req.user.email, tier: req.user.tier });
  });
  app.get('/api/admin/users', auth.required, requireAdmin, (req, res) => {
    const users = adminStmts.listUsers.all();
    res.json({ users, count: users.length });
  });
  console.log('[ADMIN] Routes mounted at /api/admin/*');
} catch(e) { console.warn('[ADMIN] Failed to mount:', e.message); }

// Sandbox routes (isolated code execution for Pro/Sovereign)
if (createSandboxRoutes) {
  try {
    const { db: sandboxDb } = require('./layers/auth/db.cjs');
    app.use('/api/sandbox', createSandboxRoutes(auth, { db: sandboxDb }));
    console.log('[SANDBOX] Routes mounted at /api/sandbox/*');
  } catch (e) {
    console.warn('[SANDBOX] Failed to mount:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITY ROUTER — Adaptive Scaling Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// Negotiate session policy (called on app load)
app.post('/api/capability/negotiate', guestOrAuth(resolveUser), (req, res) => {
  const user = req.user || {};
  const tier = user.tier || (req.isGuest ? 'free' : 'free');
  const requested = req.body.powerDial || 'instant';
  const deviceCaps = capRouter.parseDeviceCaps(req.body.device || {});
  
  const policy = capRouter.resolvePolicy(requested, tier, deviceCaps);
  
  // Store policy server-side (RT-SEC-01: never send raw policy to client)
  const sid = req.body.sessionId || req.requestId || crypto.randomBytes(8).toString('hex');
  capRouter.storePolicy(sid, policy);
  
  logEvent({ agent: 'capability_router', action: 'negotiate', userId: user.userId || 'guest', requestId: req.requestId,
    meta: { requested, resolved: policy.profile, tier, downgraded: policy.downgraded, reason: policy.downgradeReason } });
  
  // Return only what client needs to know (not the full policy)
  res.json({
    profile: policy.profile,
    label: policy.config.label || policy.profile,
    requested,
    ceiling: policy.ceiling,
    downgraded: policy.downgraded,
    downgradeReason: policy.downgradeReason,
    tier,
    sessionId: sid
  });
});

// Get available profiles for current tier (for Power Dial UI)
app.get('/api/capability/profiles', guestOrAuth(resolveUser), (req, res) => {
  const tier = req.user?.tier || 'free';
  const ceiling = capRouter.TIER_CEILING[tier] || 'instant';
  const ceilingIdx = capRouter.PROFILE_ORDER.indexOf(ceiling);
  
  const profiles = capRouter.PROFILE_ORDER.map((key, idx) => ({
    key,
    label: capRouter.POWER_PROFILES[key].label,
    desc: capRouter.POWER_PROFILES[key].desc,
    available: idx <= ceilingIdx,
    requiresTier: idx === 0 ? 'free' : idx === 1 ? 'pro' : 'sovereign'
  }));
  
  res.json({ profiles, current: ceiling, tier });
});

// ═══════════════════════════════════════════════════════════════════════════
// RAG ENDPOINTS (auth required — no guest access)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/embed', auth.required, async (req, res) => { const { text, texts } = req.body; logEvent({ agent: 'system', action: 'embed', userId: req.user.userId, requestId: req.requestId }); try { if (texts && Array.isArray(texts)) { const e = await getEmbeddings(texts); return res.json({ embeddings: e, count: e.filter(x => x).length }); } if (text) { const e = await getEmbedding(text); return res.json({ embedding: e, dimensions: e?.length || 0 }); } res.status(400).json({ error: 'Provide text or texts[]' }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/ingest', auth.analyst, async (req, res) => { const { filePath, content, namespace: ns = 'edubba', metadata = {} } = req.body; const namespace = validateNamespace(ns); logEvent({ agent: 'system', action: 'ingest', target: filePath || 'inline', userId: req.user.userId, requestId: req.requestId }); try { let t = content; if (filePath && !content) { t = fileConn.read ? fileConn.read(filePath, req.user.userId, 'analysis') : null; if (!t) return res.status(404).json({ error: 'Not found or access denied' }); } if (!t) return res.status(400).json({ error: 'No content' }); const ch = chunkText(t); const em = await getEmbeddings(ch); const vc = ch.filter((_, i) => em[i]); const ve = em.filter(e => e); const st = namespace === 'mnemosyne' ? mnemosyneStore : edubbaStore; await st.add(vc, ve, vc.map((_, i) => ({ ...metadata, chunkIndex: i, timestamp: Date.now() }))); res.json({ success: true, chunks: vc.length, namespace, total: st.count() }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/rag/query', auth.required, async (req, res) => { const v = validateBody(req.body, 'ragQuery'); if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors }); const { query, namespace: ns = 'edubba', topK = 5, threshold = 0.7 } = req.body; try { const qe = await getEmbedding(query); if (!qe) return res.status(500).json({ error: 'Embed failed' }); const st = validateNamespace(ns) === 'mnemosyne' ? mnemosyneStore : edubbaStore; res.json({ results: st.query(qe, topK, threshold), namespace: ns }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/rag/stats', auth.required, (_, res) => { res.json({ edubba: { documents: edubbaStore.count() }, mnemosyne: { documents: mnemosyneStore.count() } }); });
app.post('/api/rag/clear', auth.admin, (req, res) => { const { namespace } = req.body; logEvent({ agent: 'system', action: 'rag_clear', target: namespace || 'all', userId: req.user.userId, requestId: req.requestId }); if (namespace === 'edubba') edubbaStore.clear(); else if (namespace === 'mnemosyne') mnemosyneStore.clear(); else { edubbaStore.clear(); mnemosyneStore.clear(); } res.json({ success: true, cleared: namespace || 'all' }); });

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD + INGEST (in-chat upload → RAG)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/files/upload', auth.required, express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const fn = sanitizeFilename(req.headers['x-filename']);
  const up = path.join(DATA_DIR, 'uploads', fn);
  if (!path.resolve(up).startsWith(path.join(DATA_DIR, 'uploads'))) return res.status(400).json({ error: 'Invalid filename' });
  logEvent({ agent: 'system', action: 'upload', target: fn, userId: req.user.userId, requestId: req.requestId });
  try {
    fs.writeFileSync(up, req.body);
    const fileId = crypto.randomBytes(8).toString('hex');
    // Auto-ingest to RAG if text-extractable
    let chunks = 0;
    try {
      const text = await extractText(up);
      if (text && text.length > 10 && !text.startsWith('[')) {
        const ch = chunkText(text);
        const em = await getEmbeddings(ch);
        const vc = ch.filter((_, i) => em[i]);
        const ve = em.filter(e => e);
        if (vc.length) {
          await edubbaStore.add(vc, ve, vc.map((_, i) => ({ fileId, filename: fn, chunkIndex: i, timestamp: Date.now() })));
          chunks = vc.length;
        }
      }
    } catch(ie) { /* ingest failed — file still saved */ }
    res.json({ success: true, fileId, path: up, size: req.body.length, chunks, filename: fn });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN STREAM — GUEST GATE + FULL PIPELINE + LIVEEDIT
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/stream', guestOrAuth(resolveUser), async (req, res) => {
  const v = validateBody(req.body, 'stream'); if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors });

  // ── GUEST GATE ──
  if (req.isGuest) {
    const quota = req.guestQuota || checkGuestQuota(req);
    if (!quota.allowed) {
      return res.status(200).json({ type: 'gate', reason: 'demo_limit', message: `You've used all ${DEMO_LIMIT} demo messages. Upgrade to KURO Pro for unlimited access.`, remaining: 0, limit: DEMO_LIMIT, resetIn: quota.resetIn });
    }
  }

  // ── TIER GATE — checked post-SSE so client receives a proper gate event ──

  const { messages = [], mode: rawMode = 'main', skill, temperature = 0.7, clientType = 'executioner', sessionId: rawSid, images = [], thinking = false, reasoning = false, incubation = false, redTeam = false, nuclearFusion = false, useRAG = true, ragNamespace: rawNs = 'edubba', ragTopK = 3, fileIds = [], powerDial = 'instant' } = req.body;

  const mode = req.isGuest ? 'main' : validateMode(rawMode);
  const sid = sanitizeSessionId(rawSid) || req.requestId;
  const ragNamespace = validateNamespace(rawNs);
  const user = req.user;
  const fp = fingerprint ? fingerprint(req) : 'unknown';

  // ── CAPABILITY POLICY — resolve Power Dial to effective config ──
  const capPolicy = capRouter.resolvePolicy(
    powerDial,
    user.tier || 'free',
    capRouter.parseDeviceCaps(req.body.device || {}),
    capRouter.getInfraState()
  );
  const capCfg = capPolicy.config || {};
  if (capPolicy.downgraded) {
    logEvent({ agent: 'capability_router', action: 'downgrade', userId: user.userId, requestId: req.requestId,
      meta: { requested: powerDial, resolved: capPolicy.profile, reason: capPolicy.downgradeReason } });
  }

  logEvent({ agent: 'system', action: 'stream_start', requestId: req.requestId, clientFingerprint: fp, userId: user.userId, meta: { mode, skill, sid, profile: ACTIVE_PROFILE, isGuest: !!req.isGuest } });

  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();

  if (req.isGuest) { const q = req.guestQuota || checkGuestQuota(req); sendSSE(res, { type: 'guest_quota', remaining: q.remaining - 1, limit: q.limit, used: q.used + 1 }); }

  // Tier gate — post-SSE so client gets a proper event
  if (tierGate && !req.isGuest && req.user) {
    const gateCheck = tierGate.checkQuota(req.user.userId, req.user.tier || 'free', 'chat');
    if (!gateCheck.allowed) {
      sendSSE(res, { type: 'gate', reason: 'tier_limit', message: gateCheck.message || `Chat limit reached. Upgrade for more.`, tier: req.user.tier || 'free', remaining: gateCheck.remaining, limit: gateCheck.limit });
      return res.end();
    }
  }

  const ka = setInterval(() => { try { res.write(':ka\n\n'); } catch(e) {} }, 15000);
  let aborted = false;
  res.on('close', () => { aborted = true; clearInterval(ka); streamController.unregisterStream(sid); });
  const lastMsg = messages[messages.length - 1]?.content || '';

  const streamAbort = new AbortController();
  streamController.registerStream(sid, req.requestId, res, streamAbort);

  try {
    // L0: THREAT FILTER
    sendLayer(res, 0, 'active', null, clientType);
    const dome = ironDomeCheck(messages.length ? messages : [{ role: 'user', content: lastMsg }]);
    if (dome.status === 'BLOCKED') { sendLayer(res, 0, 'complete', { status: 'BLOCKED' }, clientType); sendSSE(res, { type: 'blocked', layer: 0, reason: dome.message || 'Blocked by policy' }); logEvent({ agent: 'threat_filter', action: 'block', requestId: req.requestId, clientFingerprint: fp, target: lastMsg.substring(0, 100), result: 'denied', userId: user.userId }); clearInterval(ka); return res.end(); }
    sendLayer(res, 0, 'complete', { status: dome.status, score: dome.score || 0 }, clientType);

    // L1: RATE LIMITER
    sendLayer(res, 1, 'active', null, clientType);
    const iff = iffCheck(req);
    if (iff.rateLimited) { sendLayer(res, 1, 'complete', { status: 'THROTTLED' }, clientType); sendSSE(res, { type: 'blocked', layer: 1, reason: 'Rate limited' }); clearInterval(ka); return res.end(); }
    sendLayer(res, 1, 'complete', { clientId: iff.clientId, requests: iff.requestCount }, clientType);

    // L2: KNOWLEDGE RETRIEVAL (+ file context injection)
    let ragCtx = []; sendLayer(res, 2, 'active', null, clientType);
    const edubbaRecall = recall(lastMsg);
    if (useRAG && edubbaStore.count() > 0) {
      try {
        const qe = await getEmbedding(lastMsg);
        if (qe) ragCtx = (ragNamespace === 'mnemosyne' ? mnemosyneStore : edubbaStore).query(qe, capCfg.ragTopK || ragTopK, 0.65);
      } catch(e) {}
    }
    // Inject file-specific context if fileIds provided
    if (fileIds.length && edubbaStore.count() > 0) {
      try {
        const qe = await getEmbedding(lastMsg);
        if (qe) {
          const fileResults = edubbaStore.query(qe, 5, 0.5).filter(r => fileIds.includes(r.metadata?.fileId));
          ragCtx = [...ragCtx, ...fileResults].slice(0, (capCfg.ragTopK || ragTopK) + 3);
        }
      } catch(e) {}
    }
    sendLayer(res, 2, 'complete', { patterns: edubbaRecall.found ? edubbaRecall.patterns?.length : 0, ragResults: ragCtx.length }, clientType);

    // L3: INTENT ROUTER
    sendLayer(res, 3, 'active', null, clientType); const route = semanticRoute(lastMsg);
    if (PROFILE.blockNSFW && route.intent === 'nsfw') { sendLayer(res, 3, 'complete', { intent: 'nsfw', blocked: true }, clientType); sendSSE(res, { type: 'blocked', layer: 3, reason: 'Content policy: not available in this deployment profile.' }); clearInterval(ka); return res.end(); }
    sendLayer(res, 3, 'complete', { intent: route.intent, temp: route.temperature }, clientType);

    // L4: CONTEXT ENGINE
    sendLayer(res, 4, 'active', null, clientType); const memCtx = getContext(sid); sendLayer(res, 4, 'complete', { entries: memCtx.length }, clientType);

    // L5: AGENT ORCHESTRATOR
    sendLayer(res, 5, 'active', null, clientType);
    let effectiveMode = mode;
    if (req.isGuest) effectiveMode = 'main';
    if (PROFILE.maxAgentTier < 3 && mode === 'dev') effectiveMode = 'main';
    if (!PROFILE.execAllowed && mode === 'dev') effectiveMode = 'main';
    if (user.maxAgentTier < 3 && mode === 'dev') effectiveMode = 'main';
    const ar = routeToAgent(route.intent, effectiveMode, user);
    if (!PROFILE.execAllowed) { ar.skillGates.canExec = false; }
    if (!user.devAllowed) { ar.skillGates.canExec = false; ar.skillGates.canWrite = false; }
    logEvent({ agent: 'orchestrator', action: 'route', requestId: req.requestId, clientFingerprint: fp, target: ar.agentId, userId: user.userId, meta: { intent: route.intent, mode: ar.mode, downgraded: ar.downgraded, profile: ACTIVE_PROFILE } });
    const modelId = resolveModel(skill, route.intent, user.tier || 'free');
    // B1: Thermal advisory — downgrade model if GPU is overheating
    let thermalOverride = null;
    const thermal = thermalAdvisory();
    if (thermal.status === 'hot' || thermal.status === 'critical') {
      thermalOverride = { original: modelId, reason: `GPU ${thermal.temperature}°C (${thermal.status})` };
      logEvent({ agent: 'telemetry', action: 'thermal_downgrade', userId: user.userId, requestId: req.requestId, meta: { original: modelId, downgraded: 'kuro-core', temp: thermal.temperature } });
    }
    const cfg = MODEL_REGISTRY[thermalOverride ? 'kuro-core' : modelId] || MODEL_REGISTRY['kuro-core'];
    sendLayer(res, 5, 'complete', { agent: ar.agent.name, agentId: ar.agentId, mode: ar.mode, downgraded: ar.downgraded, skills: ar.agent.skills, profile: ACTIVE_PROFILE, model: modelId }, clientType);
    sendSSE(res, { type: 'model', model: modelId, name: cfg.name, agent: ar.agent.name, agentId: ar.agentId, mode: ar.mode, skills: ar.agent.skills, downgraded: ar.downgraded, profile: ACTIVE_PROFILE });
    if (ar.downgraded) { sendSSE(res, { type: 'policy_notice', level: 'warning', message: `Action scope limited: ${ar.reason || 'insufficient permissions'}. Running in ${ar.agent.name} mode.`, originalMode: mode, effectiveMode: ar.mode, effectiveAgent: ar.agentId }); }

    // L6-L7: FIRE CONTROL + FRONTIER ASSIST DECISION
    sendLayer(res, 6, 'active', null, clientType); const fc = fireControlCheck(lastMsg, route);
    const userTier = user.tier || 'free';
    const frontierDecision = shouldUseFrontier(fc.poh || 0.9, userTier, user.userId);
    sendLayer(res, 6, 'complete', { poh: fc.poh || 0.9, frontier: frontierDecision.useFrontier, reason: frontierDecision.reason }, clientType);
    
    if (frontierDecision.useFrontier) {
      sendSSE(res, { type: 'routing', target: 'frontier_assist', provider: getActiveProvider().provider, poh: fc.poh });
      logEvent({ agent: 'frontier_assist', action: 'route_frontier', userId: user.userId, requestId: req.requestId, meta: { poh: fc.poh, threshold: frontierDecision.threshold, provider: getActiveProvider().provider } });
    }
    
    sendLayer(res, 7, 'active', null, clientType);
    const rSkill = skill || (route.intent === 'dev' || route.intent === 'code' ? 'code' : null);
    const sysPr = buildSystemPrompt(ar.mode, rSkill, { thinking: (thinking || cfg.thinking) && (capCfg.thinking !== false), reasoning: (reasoning || (route.reasoningLevel > 0)) && (capCfg.reasoning !== false), incubation: incubation && (capCfg.incubation !== false), redTeam: redTeam && (capCfg.redTeam !== false), nuclearFusion: nuclearFusion && (capCfg.nuclearFusion !== false) }, ragCtx, { agent: ar.agent, downgraded: ar.downgraded, reason: ar.reason });
    sendLayer(res, 7, 'complete', { mode: ar.mode, agent: ar.agentId }, clientType);

    const refinedPrompt = purify(sysPr);

    // ═══ A3+A5: SYNTHESIS PROTOCOL (Sovereign + nuclearFusion + code/dev) ═══
    // Generates N candidates, judges all, merges best parts.
    // Only activates for Sovereign tier with nuclearFusion flag on code tasks.
    const useSynthesis = nuclearFusion && synthesize && (user.tier === 'sovereign') 
      && (rSkill === 'code' || ar.mode === 'dev' || route.intent === 'code');
    
    if (useSynthesis) {
      sendSSE(res, { type: 'routing', target: 'synthesis_protocol', candidates: 3 });
      logEvent({ agent: 'synthesis', action: 'start', userId: user.userId, requestId: req.requestId, meta: { skill: rSkill, mode: ar.mode } });
      
      try {
        const synthResult = await synthesize(
          lastMsg,
          memCtx.slice(-6),
          refinedPrompt,
          {
            actorModel: cfg.ollama,
            judgeModel: cfg.ollama,
            mergeModel: cfg.ollama,
            actorCtx: cfg.ctx,
            judgeCtx: cfg.ctx,
            mergeCtx: cfg.ctx
          },
          // SSE phase callback
          (phase, status, data) => sendSSE(res, { type: 'synthesis', phase, status, ...data })
        );

        // Stream the merged result token-by-token for consistent UX
        const resultChunks = synthResult.result.match(/.{1,4}/g) || [];
        for (const chunk of resultChunks) {
          if (aborted) break;
          sendSSE(res, { type: 'token', content: chunk });
        }

        sendSSE(res, { 
          type: 'done', tokens: resultChunks.length, model: cfg.name, agent: ar.agentId,
          requestId: req.requestId, synthesis: true, strategy: synthResult.strategy,
          merged: synthResult.merged, timing: synthResult.timing
        });
        
        logEvent({ agent: 'synthesis', action: 'complete', userId: user.userId, requestId: req.requestId, 
          meta: { strategy: synthResult.strategy, merged: synthResult.merged, timing: synthResult.timing } });
        
        addToHistory(sid, 'user', lastMsg);
        addToHistory(sid, 'assistant', synthResult.result);
        if (tierGate && !req.isGuest && req.user) tierGate.recordUsage(req.user.userId, 'chat');
        
        clearInterval(ka);
        return res.end();
      } catch (synthErr) {
        console.warn('[SYNTHESIS] Error, falling back to standard path:', synthErr.message);
        sendSSE(res, { type: 'routing', target: 'standard_fallback', reason: synthErr.message });
        // Fall through to normal streaming path below
      }
    }

    // L10: STREAM (local Ollama or Frontier Assist)
    sendLayer(res, 10, 'active', null, clientType);
    const fTemp = capCfg.temperature || temperature || route.temperature || 0.7;
    const capMaxHist = capCfg.maxHistory || 10;
    const ollMsgs = [{ role: 'system', content: refinedPrompt }, ...memCtx.slice(-capMaxHist), ...messages];
    if (images?.length > 0 && ollMsgs.length > 0) ollMsgs[ollMsgs.length - 1].images = images.map(i => i.replace(/^data:image\/\w+;base64,/, ''));

    // Send capability policy info to client
    sendSSE(res, { type: 'capability', profile: capPolicy.profile, requested: powerDial, downgraded: capPolicy.downgraded, reason: capPolicy.downgradeReason, ctx: capCfg.ctx || cfg.ctx });

    let full = '', tc = 0; const thinkEmitter = createThinkStreamEmitter();
    setStreaming(true); // B5: prevent model warming during active inference
    
    // ═══ FRONTIER ASSIST PATH ═══
    if (frontierDecision.useFrontier && streamFrontier) {
      const fp = getActiveProvider();
      if (fp.configured) {
        try {
          await new Promise((resolve, reject) => {
            const chatMsgs = ollMsgs.filter(m => m.role !== 'system');
            const handle = streamFrontier(fp.provider, fp.key, chatMsgs, refinedPrompt, { model: fp.model }, {
              onToken: (token) => {
                full += token; tc++;
                const tr = thinkEmitter.emit(token);
                if (tr) sendSSE(res, tr);
                sendSSE(res, { type: 'token', content: token });
                streamController.appendPartial(sid, token);
              },
              onDone: (info) => {
                const tf = thinkEmitter.flush(); if (tf) sendSSE(res, tf);
                sendSSE(res, { type: 'done', tokens: tc, model: `frontier:${fp.provider}`, agent: ar.agentId, requestId: req.requestId, frontier: true });
                consumeFrontierQuota(user.userId);
                recordFrontier(); // B3: sovereignty tracking
                logEvent({ agent: 'frontier_assist', action: 'stream_complete', userId: user.userId, requestId: req.requestId, meta: { tokens: tc, provider: fp.provider, model: fp.model } });
                resolve();
              },
              onError: (err) => {
                console.warn('[FRONTIER] Error, falling back to local:', err.message);
                sendSSE(res, { type: 'routing', target: 'local_fallback', reason: err.message });
                reject(err); // will fall through to local
              }
            });
            req.on('close', () => { try { handle.abort(); } catch(e) {} });
          });
          // Frontier completed successfully — skip local
        } catch(frontierErr) {
          // Frontier failed — fall through to local Ollama below
          full = ''; tc = 0;
        }
      }
    }
    
    // ═══ LOCAL OLLAMA PATH (default or frontier fallback) ═══
    if (!full) {
      if (!(await checkOllama())) { sendSSE(res, { type: 'error', message: 'AI model temporarily unavailable. Please retry.' }); clearInterval(ka); return res.end(); }
      logEvent({ agent: 'stream', action: 'local_only', userId: user.userId, requestId: req.requestId, meta: { model: cfg.ollama, poh: fc.poh } });
      recordLocal(); // B3: sovereignty tracking

    try {
      const resp = await axios({ method: 'post', url: `${OLLAMA_URL}/api/chat`, data: { model: cfg.ollama, messages: ollMsgs, stream: true, options: { temperature: fTemp, num_ctx: capCfg.ctx || cfg.ctx } }, responseType: 'stream', timeout: 300000, signal: streamAbort.signal });
      let buf = '';
      for await (const chunk of resp.data) {
        if (aborted) break;
        const correction = streamController.checkCorrection(sid);
        if (correction) { sendSSE(res, { type: 'aborted_for_correction', correction, partial: streamController.getPartial(sid) }); streamAbort.abort(); break; }
        buf += chunk.toString(); const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) { if (!line.trim()) continue; try { const d = JSON.parse(line); if (d.message?.content) { full += d.message.content; tc++; const tr = thinkEmitter.emit(d.message.content); if (tr) sendSSE(res, tr); sendSSE(res, { type: 'token', content: d.message.content }); streamController.appendPartial(sid, d.message.content); } if (d.done) { const tf = thinkEmitter.flush(); if (tf) sendSSE(res, tf); sendSSE(res, { type: 'done', tokens: tc, model: cfg.name, agent: ar.agentId, requestId: req.requestId }); } } catch(e) {} }
      }
    } catch(se) {
      if (se.name === 'CanceledError' || se.code === 'ERR_CANCELED') { streamController.unregisterStream(sid); }
      else { sendSSE(res, { type: 'error', message: se.message }); ollamaHealth.failures++; }
    }
    } // end if(!full) — local Ollama path

    if (full) {
      full = enhanceOutput(full); const cleanFull = stripThinkBlocks(full);
      sendLayer(res, 11, 'active', null, clientType);
      try { const re = await getEmbedding(cleanFull.slice(0, 2000)); if (re) await mnemosyneStore.add([cleanFull.slice(0, 2000)], [re], [{ sessionId: sid, agent: ar.agentId, timestamp: Date.now(), query: lastMsg.slice(0, 200), requestId: req.requestId }]); } catch(e) {}
      sendLayer(res, 11, 'complete', { cached: true }, clientType);
      inscribe(lastMsg, cleanFull);
    }
    sendLayer(res, 10, 'complete', { tokens: tc }, clientType);
    addToHistory(sid, 'user', lastMsg); addToHistory(sid, 'assistant', stripThinkBlocks(full));

    if (req.isGuest) consumeGuestMessage(req);
    if (tierGate && !req.isGuest && req.user) tierGate.recordUsage(req.user.userId, 'chat');

    logEvent({ agent: ar.agentId, action: 'stream_complete', requestId: req.requestId, clientFingerprint: fp, userId: user.userId, meta: { tokens: tc, mode: ar.mode, sid, isGuest: !!req.isGuest } });
  } catch(err) { const errMsg = err?.message || 'Unknown error'; sendSSE(res, { type: 'error', message: errMsg }); logEvent({ agent: 'system', action: 'stream_error', requestId: req.requestId, result: 'error', userId: user.userId, meta: { error: errMsg } }); }
  streamController.unregisterStream(sid);
  setStreaming(false); // B5: allow model warming again
  clearInterval(ka); res.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// DEV ENDPOINTS (token required, no guest)
// ═══════════════════════════════════════════════════════════════════════════
function devGate(req, res, next) {
  if (!req.user.devAllowed) { logEvent({ agent: 'system', action: 'dev_denied', result: 'denied', userId: req.user.userId, requestId: req.requestId }); return res.status(403).json({ error: 'Dev access denied' }); }
  if (!PROFILE.execAllowed && req.path.includes('/exec')) { return res.status(403).json({ error: `Exec disabled in ${PROFILE.name} profile` }); }
  const ar = routeToAgent('dev', 'dev', req.user); if (!PROFILE.execAllowed) ar.skillGates.canExec = false;
  req.agentId = ar.agentId; req.conn = createGatedConnectors(ar.skillGates, req.user.userId, ar.agentId); next();
}
app.post('/api/dev/exec', auth.dev, devGate, async (req, res) => { const v = validateBody(req.body, 'devExec'); if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors }); const { command, cwd } = req.body; try { res.json(await req.conn.terminal.exec(command, cwd, req.requestId)); } catch(e) { res.status(403).json({ error: e.message }); } });
app.post('/api/dev/write', auth.dev, devGate, (req, res) => { const v = validateBody(req.body, 'devWrite'); if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors }); const { filePath: fp, content, action = 'create' } = req.body; try { if (action === 'delete') res.json(req.conn.file.remove(fp)); else res.json(req.conn.file.write(fp, content || '')); } catch(e) { res.status(403).json({ error: e.message }); } });
app.post('/api/dev/stage', auth.dev, devGate, (req, res) => { const { targetPath, content } = req.body; if (!targetPath || !content) return res.status(400).json({ error: 'Need targetPath and content' }); try { res.json(req.conn.file.stagePatch(targetPath, content)); } catch(e) { res.status(403).json({ error: e.message }); } });
app.post('/api/dev/read', auth.dev, devGate, (req, res) => { const v = validateBody(req.body, 'devRead'); if (!v.valid) return res.status(400).json({ error: 'Validation failed', details: v.errors }); const { filePath: fp } = req.body; try { const r = path.resolve(fp), s = fs.statSync(r); if (s.isDirectory()) res.json({ type: 'directory', contents: req.conn.file.list(fp) }); else res.json({ type: 'file', content: req.conn.file.read(fp) }); } catch(e) { res.status(404).json({ error: e.message }); } });

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/audit/verify', auth.analyst, (req, res) => { const d = req.query.date; res.json(d ? verifyChain(d) : verifyAll()); });
app.get('/api/audit/recent', auth.analyst, (req, res) => { const n = parseInt(req.query.n) || 50; res.json({ entries: recentEntries(Math.min(n, 200)), total: auditStats().total }); });
app.get('/api/audit/stats', auth.analyst, (_, res) => { res.json(auditStats()); });
app.post('/api/audit/seal', auth.operator, (req, res) => { logEvent({ agent: 'system', action: 'seal_day', userId: req.user.userId, requestId: req.requestId }); res.json(sealDay(req.body?.date)); });

app.get('/api/patches', auth.analyst, (_, res) => { const pd = path.join(DATA_DIR, 'patches'); try { const dirs = fs.readdirSync(pd).filter(d => fs.statSync(path.join(pd, d)).isDirectory()); const patches = dirs.map(d => { try { return JSON.parse(fs.readFileSync(path.join(pd, d, 'meta.json'), 'utf8')); } catch { return { id: d, error: true }; } }); res.json({ patches, count: patches.length }); } catch { res.json({ patches: [], count: 0 }); } });

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY + GUEST-AWARE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/models', guestOrAuth(resolveUser), async (req, res) => { const conf = Object.entries(MODEL_REGISTRY).map(([id, c]) => ({ id, name: c.name, desc: c.desc || '', ctx: c.ctx, thinking: !!c.thinking, embedding: !!c.embedding, vision: !!c.vision, tier: c.tier, minTier: MODEL_TIER_ACCESS[id] || 'sovereign', available: true })); try { const { data } = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 }); const av = new Set((data.models || []).map(m => m.name)); conf.forEach(m => { const c = MODEL_REGISTRY[m.id]; m.available = av.has(c.ollama) || av.has(c.ollama.split(':')[0]); }); } catch(e) {} res.json({ configured: conf, default: 'kuro-core', skillRouting: SKILL_MODELS, architecture: 'SOVEREIGN_AGENT_v7.0.3', agents: AGENTS, profile: { active: ACTIVE_PROFILE, ...PROFILE }, isGuest: !!req.isGuest }); });

app.get('/api/health', (_, res) => { res.json({ status: 'ok', version: 'v9.0', architecture: 'SOVEREIGN_AGENT', profile: ACTIVE_PROFILE, model: 'kuro-core', ollama: ollamaHealth.healthy ? 'connected' : 'degraded', stores: { edubba: edubbaStore.count(), mnemosyne: mnemosyneStore.count() }, audit: { chainValid: verifyAll().allValid }, fusion: { frontier: getActiveProvider().configured, webSearch: !!webSearch, lab: typeof mountLabRoutes === 'function', artifacts: typeof mountArtifactRoutes === 'function', contextReactor: !!ingestFile, synthesis: !!synthesize, telemetry: typeof mountTelemetryRoutes === 'function', sovereignty: typeof mountSovereigntyRoutes === 'function', snapshots: typeof mountSnapshotRoutes === 'function', warmer: typeof predictiveWarm === 'function', selfHeal: !!selfHeal }, guests: guestStats(), uptime: Math.floor(process.uptime()), timestamp: Date.now() }); });

app.post('/api/upload', auth.required, express.raw({ type: '*/*', limit: '50mb' }), (req, res) => { const fn = sanitizeFilename(req.headers['x-filename']); const up = path.join(DATA_DIR, 'uploads', fn); if (!path.resolve(up).startsWith(path.join(DATA_DIR, 'uploads'))) return res.status(400).json({ error: 'Invalid filename' }); logEvent({ agent: 'system', action: 'upload', target: fn, userId: req.user.userId, requestId: req.requestId }); try { fs.writeFileSync(up, req.body); res.json({ success: true, path: up, size: req.body.length }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/files', auth.required, (req, res) => { const dp = req.query.path || DATA_DIR; const resolved = path.resolve(dp); if (!resolved.startsWith(path.resolve(DATA_DIR)) && !resolved.startsWith(path.resolve(CODE_DIR))) return res.status(403).json({ error: 'Path outside allowed scope' }); const scope = req.user.devAllowed ? 'actions' : (req.user.level >= 2 ? 'analysis' : 'insights'); try { const f = fileConn.list ? fileConn.list(dp, req.user.userId, scope) : []; res.json({ files: f, path: dp }); } catch(e) { res.status(404).json({ error: e.message }); } });
app.get('/api/sessions', auth.analyst, (req, res) => { try { res.json(sessionConn.aggregate ? sessionConn.aggregate(req.user.userId) : { totalSessions: 0, sessions: [] }); } catch(e) { res.json({ totalSessions: 0, sessions: [] }); } });
app.get('/api/profile', guestOrAuth(resolveUser), (_, res) => { res.json({ active: ACTIVE_PROFILE, profile: PROFILE, available: Object.keys(PROFILES) }); });
app.get('/api/guest/quota', (_req, res) => { const q = checkGuestQuota(_req); res.json(q); });

// ═══════════════════════════════════════════════════════════════════════════
// LIVEEDIT + VISION + PREEMPT ROUTES
// ═══════════════════════════════════════════════════════════════════════════
try { mountLiveEditRoutes(app, logEvent); } catch(e) { console.warn('[WARN] LiveEdit routes:', e.message); }
try { mountVisionRoutes(app, logEvent, null, tierGate); } catch(e) { console.warn('[WARN] Vision routes:', e.message); }
try {
  // Preempt needs model config + session context + token validation
  const validateTokenForPreempt = (token) => {
    const user = resolveUser({ headers: { 'x-kuro-token': token } });
    return user ? { valid: true, user } : { valid: false };
  };
  const getSessionContextForPreempt = (sessionId) => getContext(sessionId);
  mountPreemptRoutes(app, logEvent, MODEL_REGISTRY, validateTokenForPreempt, getSessionContextForPreempt);
} catch(e) { console.warn('[WARN] Preempt routes:', e.message); }

// ═══════════════════════════════════════════════════════════════════════════
// FUSION MODULES (Phase 1-3)
// ═══════════════════════════════════════════════════════════════════════════

// Web Search
app.post('/api/tools/web/search', auth.required, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Query required' });
    const userId = req.user?.userId || 'anonymous';
    const tier = req.user?.tier || 'free';
    const result = await webSearch(query.slice(0, 500), userId, tier, req.body.options || {});
    if (result.error) return res.status(result.reason === 'daily_limit_reached' ? 429 : 503).json(result);
    logEvent({ agent: 'web_search', action: 'search', userId, requestId: req.requestId, meta: { query: query.slice(0, 100), results: result.resultCount, cached: result.cached } });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// File Ingest (upload → chunk → embed → RAG)
app.post('/api/files/ingest', auth.required, express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  try {
    const fn = sanitizeFilename(req.headers['x-filename'] || `upload_${Date.now()}`);
    const userId = req.user?.userId || 'anonymous';
    const upload = handleUpload(req.body, fn, userId);
    const result = await ingestFile(upload.filePath, upload.fileId, userId, getEmbedding, edubbaStore);
    logEvent({ agent: 'context_reactor', action: 'ingest', userId, requestId: req.requestId, meta: { fileId: upload.fileId, chunks: result.chunks, embedded: result.embedded } });
    res.json({ ...result, upload: { fileId: upload.fileId, fileName: upload.fileName, size: upload.size } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lab (code interpreter)
try { mountLabRoutes(app, logEvent, auth); } catch(e) { console.warn('[WARN] Lab routes:', e.message); }

// Artifacts
try { mountArtifactRoutes(app, logEvent, auth); } catch(e) { console.warn('[WARN] Artifact routes:', e.message); }

// ═══════════════════════════════════════════════════════════════════════════
// v7.0.3 MODULES
// ═══════════════════════════════════════════════════════════════════════════

// B1: Reactor Telemetry
try { mountTelemetryRoutes(app, logEvent); } catch(e) { console.warn('[WARN] Telemetry routes:', e.message); }

// B3: Sovereignty Dashboard
try { mountSovereigntyRoutes(app, verifyAll); } catch(e) { console.warn('[WARN] Sovereignty routes:', e.message); }

// B4: Cognitive Snapshots
try { mountSnapshotRoutes(app); } catch(e) { console.warn('[WARN] Snapshot routes:', e.message); }

// B5: Model Warmer (debug routes)
try {
  const mw = require('./layers/model_warmer.js');
  if (mw.mountWarmerRoutes) mw.mountWarmerRoutes(app);
} catch(e) { /* silent — debug routes optional */ }

// Frontier Assist status
app.get('/api/frontier/status', auth.required, (req, res) => {
  const provider = getActiveProvider();
  const tier = req.user?.tier || 'free';
  res.json({ configured: provider.configured, provider: provider.provider, model: provider.model, tierEligible: tier !== 'free' });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING: "/" is the React OS desktop (SPA). Marketing landing at /landing.
// ═══════════════════════════════════════════════════════════════════════════

// React OS — primary entry point
app.get('/', (req, res) => {
  const ip = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(ip)) return res.sendFile(ip);
  res.status(200).send('<html><body><h1>KURO OS v9.0</h1><p>Run npm run build.</p></body></html>');
});

// Marketing landing page (optional, preserved at /landing)
app.get('/landing', (req, res) => {
  const lp = path.join(__dirname, 'landing.html');
  if (fs.existsSync(lp)) return res.sendFile(lp);
  res.redirect('/');
});

// React OS SPA (all /app routes)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const ip = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(ip)) return res.sendFile(ip);
    return res.status(200).send('<html><body><h1>KURO OS v9.0</h1><p>Build not found. Run npm run build.</p></body></html>');
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════
// ═══ Startup model validation ═══
(async () => {
  try {
    const { data } = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const available = new Set((data.models || []).map(m => m.name));
    const required = Object.entries(MODEL_REGISTRY).filter(([,c]) => !c.embedding);
    for (const [id, cfg] of required) {
      const ok = available.has(cfg.ollama) || available.has(cfg.ollama.split(':')[0]);
      if (!ok) console.warn(`[STARTUP] WARNING: Model '${cfg.ollama}' (${id}) not found in Ollama. Chat will fail for this model.`);
      else console.log(`[STARTUP] Model '${cfg.ollama}' (${id}) — OK`);
    }
  } catch(e) { console.warn(`[STARTUP] Could not reach Ollama at ${OLLAMA_URL} — models not validated`); }
})();

const server = app.listen(PORT, '0.0.0.0', () => {
  logEvent({ agent: 'system', action: 'server_start', meta: { port: PORT, version: 'v9.0', profile: ACTIVE_PROFILE } });
  console.log('\n  KURO OS v9.0 — UNIFIED BUILD (L4)');
  console.log('  ' + '═'.repeat(50));
  console.log(`  Port:      ${PORT}`);
  console.log(`  Profile:   ${PROFILE.name} (${ACTIVE_PROFILE})`);
  console.log(`  Auth:      Session + OAuth + Legacy Token + Guest Gate`);
  console.log(`  Stripe:    ${stripeWebhookHandler ? 'active' : 'disabled'}`);
  console.log(`  CORS:      ${PROFILE.corsOrigin}`);
  console.log(`  Models:    ${Object.keys(MODEL_REGISTRY).length} (${Object.entries(MODEL_REGISTRY).filter(([,c]) => !c.embedding).map(([id]) => id).join(', ')})`);
  console.log(`  Routing:   Skill-based (${Object.keys(SKILL_MODELS).length} skills)`);
  console.log(`  Agents:    Insights | Actions | Analysis`);
  console.log(`  Safety:    ${PROFILE.safety ? 'ENABLED' : 'disabled'}`);
  console.log(`  Exec:      ${PROFILE.execAllowed ? 'allowed' : 'DISABLED'}`);
  console.log(`  LiveEdit:  ${typeof mountLiveEditRoutes === 'function' ? 'wired (context-aware)' : 'fallback'}`);
  console.log(`  Vision:    ${typeof mountVisionRoutes === 'function' ? 'wired (FLUX schnell+dev, tier-gated)' : 'fallback'}`);
  console.log(`  Synthesis: ${synthesize ? 'wired (A3+A5: parallel candidates + merge)' : 'fallback'}`);
  console.log(`  Telemetry: ${typeof mountTelemetryRoutes === 'function' ? 'wired (B1: GPU/VRAM/thermal)' : 'fallback'}`);
  console.log(`  SelfHeal:  ${selfHeal ? 'wired (B2: autonomous remediation)' : 'fallback'}`);
  console.log(`  Sovereign: ${typeof mountSovereigntyRoutes === 'function' ? 'wired (B3: zero-cloud proof)' : 'fallback'}`);
  console.log(`  Snapshots: ${typeof mountSnapshotRoutes === 'function' ? 'wired (B4: cognitive branching)' : 'fallback'}`);
  console.log(`  Warmer:    ${typeof predictiveWarm === 'function' ? 'wired (B5: predictive model paging)' : 'fallback'}`);
  console.log(`  Preempt:   ${typeof mountPreemptRoutes === 'function' ? 'wired' : 'fallback'}`);
  console.log(`  Sandbox:   ${createSandboxRoutes ? 'wired (Pro+Sovereign, Docker isolation)' : 'not loaded'}`);
  console.log(`  Frontier:  ${getActiveProvider().configured ? getActiveProvider().provider : 'not configured'}`);
  console.log(`  WebSearch: ${webSearch ? 'wired' : 'fallback'}`);
  console.log(`  Lab:       ${typeof mountLabRoutes === 'function' ? 'wired' : 'fallback'}`);
  console.log(`  Artifacts: ${typeof mountArtifactRoutes === 'function' ? 'wired' : 'fallback'}`);
  console.log(`  CtxReact:  ${ingestFile ? 'wired' : 'fallback'}`);
  console.log(`  Vectors:   Edubba(${edubbaStore.count()}) Mnemosyne(${mnemosyneStore.count()})`);
  console.log('  ' + '═'.repeat(50) + '\n');
});
process.on('SIGTERM', () => { logEvent({ agent: 'system', action: 'shutdown', meta: { signal: 'SIGTERM' } }); sealDay(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { logEvent({ agent: 'system', action: 'shutdown', meta: { signal: 'SIGINT' } }); sealDay(); server.close(() => process.exit(0)); });
