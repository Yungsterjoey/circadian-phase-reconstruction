/**
 * KURO :: CAPABILITY ROUTER v9.0
 * 
 * Adaptive capability scaling — same model, different configurations.
 * Routes based on: device + tier + infra + user power dial selection.
 * 
 * RED TEAM NOTES:
 *   RT-CAP-01: Client caps are ADVISORY. Server policy is AUTHORITATIVE.
 *   RT-CAP-02: Single model (kuro-core), different ctx/temp/tools per profile.
 *   RT-CAP-03: Tier ceiling enforced server-side — Free can't select Sovereign.
 *   RT-SEC-01: Policy stored server-side in session, never sent to client unsigned.
 */

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════
// POWER PROFILES — what each dial position actually configures
// ═══════════════════════════════════════════════════════════════════════════
const POWER_PROFILES = {
  instant: {
    label: '⚡ Instant',
    ctx: 4096,
    temperature: 0.7,
    thinking: false,
    reasoning: false,
    incubation: false,
    redTeam: false,
    nuclearFusion: false,
    tools: ['read'],
    streaming: 'fast',
    maxHistory: 4,        // fewer history messages = faster
    ragTopK: 1,
    desc: 'Fast responses, basic context'
  },
  deep: {
    label: '🧠 Deep',
    ctx: 8192,
    temperature: 0.5,
    thinking: true,
    reasoning: true,
    incubation: false,
    redTeam: false,
    nuclearFusion: false,
    tools: ['read', 'compute'],
    streaming: 'balanced',
    maxHistory: 8,
    ragTopK: 3,
    desc: 'Thoughtful analysis, extended context'
  },
  sovereign: {
    label: '👑 Sovereign',
    ctx: 16384,
    temperature: 0.3,
    thinking: true,
    reasoning: true,
    incubation: true,
    redTeam: true,
    nuclearFusion: false,   // synthesis only on explicit flag
    tools: ['read', 'compute', 'write', 'exec', 'aggregate'],
    streaming: 'quality',
    maxHistory: 12,
    ragTopK: 5,
    desc: 'Maximum depth, all capabilities'
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TIER CEILINGS — hard limit on what each tier can access
// ═══════════════════════════════════════════════════════════════════════════
const TIER_CEILING = {
  free:      'instant',     // Free → max Instant
  pro:       'deep',        // Pro → max Deep
  sovereign: 'sovereign'    // Sovereign → max Sovereign
};

const PROFILE_ORDER = ['instant', 'deep', 'sovereign'];

function profileIndex(p) { return PROFILE_ORDER.indexOf(p); }

// ═══════════════════════════════════════════════════════════════════════════
// DEVICE CAPABILITY PARSING
// ═══════════════════════════════════════════════════════════════════════════
function parseDeviceCaps(caps = {}) {
  // Client-reported capabilities (advisory only)
  return {
    cores: Math.max(1, Math.min(128, parseInt(caps.cores) || 4)),
    memory: caps.memory || 'unknown',        // 'low' | 'mid' | 'high' | 'unknown'
    gpu: !!caps.webgpu || !!caps.webgl2,
    connection: caps.connection || 'unknown', // 'slow' | '3g' | '4g' | 'wifi' | 'unknown'
    battery: caps.battery,                   // { charging, level } or null
    mobile: !!caps.mobile,
    pwa: !!caps.pwa,
    rtt: parseInt(caps.rtt) || null,         // round-trip time ms
    downlink: parseFloat(caps.downlink) || null, // Mbps
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE SIGNAL
// ═══════════════════════════════════════════════════════════════════════════
let _thermalAdvisory = () => ({ status: 'unknown', temperature: 0 });
let _ollamaHealth = () => true;

function setInfraSignals(thermalFn, healthFn) {
  if (thermalFn) _thermalAdvisory = thermalFn;
  if (healthFn) _ollamaHealth = healthFn;
}

function getInfraState() {
  const thermal = _thermalAdvisory();
  return {
    gpuAvailable: _ollamaHealth(),
    gpuTemp: thermal.temperature || 0,
    gpuStatus: thermal.status || 'unknown', // 'cool' | 'warm' | 'hot' | 'critical'
    degraded: thermal.status === 'hot' || thermal.status === 'critical'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY RESOLUTION — the core routing decision
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Resolves the effective power profile for a request.
 * 
 * @param {string} requested   - User's Power Dial selection ('instant'|'deep'|'sovereign')
 * @param {string} tier        - User's subscription tier ('free'|'pro'|'sovereign')
 * @param {object} deviceCaps  - Parsed device capabilities
 * @param {object} infraState  - Current infrastructure state
 * @returns {object} policy    - The resolved policy to apply
 */
function resolvePolicy(requested = 'instant', tier = 'free', deviceCaps = {}, infraState = null) {
  const infra = infraState || getInfraState();
  
  // 1. Determine ceiling from tier
  const ceiling = TIER_CEILING[tier] || 'instant';
  const ceilingIdx = profileIndex(ceiling);
  
  // 2. Determine requested profile index
  const requestedIdx = profileIndex(requested);
  
  // 3. Effective = min(requested, ceiling)
  //    Server-side enforcement: Free user requesting 'sovereign' gets 'instant'
  const effectiveIdx = Math.min(requestedIdx, ceilingIdx);
  
  // 4. Infrastructure downgrade — if GPU is overheating, cap at 'deep'
  let finalIdx = effectiveIdx;
  let downgraded = false;
  let downgradeReason = null;

  if (infra.degraded && finalIdx > 0) {
    finalIdx = Math.min(finalIdx, profileIndex('deep'));
    if (finalIdx < effectiveIdx) {
      downgraded = true;
      downgradeReason = `GPU thermal: ${infra.gpuTemp}°C (${infra.gpuStatus})`;
    }
  }
  
  if (!infra.gpuAvailable) {
    // GPU completely down — force instant (which could theoretically run on CPU)
    finalIdx = 0;
    downgraded = true;
    downgradeReason = 'GPU temporarily unavailable';
  }

  // 5. Device-aware adjustments (advisory, minor)
  //    Slow connection → prefer faster streaming regardless of profile
  let streamingOverride = null;
  if (deviceCaps.connection === 'slow' || deviceCaps.connection === '3g' || (deviceCaps.rtt && deviceCaps.rtt > 500)) {
    streamingOverride = 'fast';
  }

  const profileKey = PROFILE_ORDER[finalIdx];
  const profile = { ...POWER_PROFILES[profileKey] };

  if (streamingOverride) profile.streaming = streamingOverride;

  return {
    profile: profileKey,
    requested,
    ceiling,
    downgraded,
    downgradeReason,
    config: profile,
    tier,
    deviceQuality: deviceCaps.connection || 'unknown',
    resolvedAt: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION POLICY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
const _sessionPolicies = new Map();
const SESSION_POLICY_TTL = 24 * 60 * 60 * 1000; // 24h

function storePolicy(sessionId, policy) {
  _sessionPolicies.set(sessionId, { ...policy, storedAt: Date.now() });
  // Cleanup old entries periodically
  if (_sessionPolicies.size > 10000) {
    const now = Date.now();
    for (const [k, v] of _sessionPolicies) {
      if (now - v.storedAt > SESSION_POLICY_TTL) _sessionPolicies.delete(k);
    }
  }
}

function getPolicy(sessionId) {
  const p = _sessionPolicies.get(sessionId);
  if (!p) return null;
  if (Date.now() - p.storedAt > SESSION_POLICY_TTL) {
    _sessionPolicies.delete(sessionId);
    return null;
  }
  return p;
}

function clearPolicy(sessionId) {
  _sessionPolicies.delete(sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: Apply policy to stream request
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Given a stream request body and a resolved policy, returns overrides
 * to merge into the Ollama call parameters.
 */
function applyPolicy(policy, requestBody = {}) {
  if (!policy || !policy.config) return requestBody;

  const cfg = policy.config;
  const overrides = {};

  // Context window cap
  overrides.num_ctx = cfg.ctx;

  // Temperature
  overrides.temperature = cfg.temperature;

  // Ghost protocols — only enable if policy allows
  overrides.thinking = cfg.thinking;
  overrides.reasoning = cfg.reasoning;
  overrides.incubation = cfg.incubation;
  overrides.redTeam = cfg.redTeam;
  overrides.nuclearFusion = cfg.nuclearFusion && requestBody.nuclearFusion; // must be explicitly requested too

  // RAG depth
  overrides.ragTopK = cfg.ragTopK;

  // History window
  overrides.maxHistory = cfg.maxHistory;

  // Tool access (for orchestrator)
  overrides.allowedTools = cfg.tools;

  return overrides;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  POWER_PROFILES,
  TIER_CEILING,
  PROFILE_ORDER,
  parseDeviceCaps,
  setInfraSignals,
  getInfraState,
  resolvePolicy,
  storePolicy,
  getPolicy,
  clearPolicy,
  applyPolicy
};
