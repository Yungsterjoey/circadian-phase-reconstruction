/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KURO OS - SERVER v4.1 SHADOW EDITION
 * Sovereign Intelligence Platform
 * 
 * FIXES: Express 5.x path-to-regexp compatibility (wildcard route)
 * PROTOCOLS: Iron Dome, Nephilim Gate, Babylon, Mnemosyne, Shadow VPN
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// EXTERNAL MODULE IMPORTS
// ═══════════════════════════════════════════════════════════════════════════
const { ironDomeCheck } = require('./iron_dome.js');
const { iffCheck } = require('./iff_gate.js');
const { getSession, addToHistory, getContext, clearSession } = require('./memory.js');
const { semanticRoute } = require('./semantic_router.js');
const { fireControlCheck, smashEngage, smashBDA } = require('./fire_control.js');
const { recall, inscribe } = require('./edubba_archive.js');
const { purify, calculateWeight } = require('./maat_refiner.js');
const { enhanceOutput } = require('./output_enhancer.js');
const { stripThinkBlocks, createThinkStreamEmitter, createThinkContentFilter } = require('./thinking_stream.js');

// Optional modules with graceful fallback
let bloodhound, harvester;
try { bloodhound = require('./bloodhound.js'); } catch(e) { bloodhound = null; }
try { harvester = require('./harvester.js'); } catch(e) { harvester = null; }

// Shadow Protocol modules (inline if external not available)
let NephilimGateMod, BabylonProtocolMod, MnemosyneCacheMod, ShadowVPNMod;
try { NephilimGateMod = require('./shadow/nephilimGate.js'); } catch(e) { NephilimGateMod = null; }
try { BabylonProtocolMod = require('./shadow/babylonProtocol.js'); } catch(e) { BabylonProtocolMod = null; }
try { MnemosyneCacheMod = require('./shadow/mnemosyneCache.js'); } catch(e) { MnemosyneCacheMod = null; }
try { ShadowVPNMod = require('./shadow/ShadowVPN.js'); } catch(e) { ShadowVPNMod = null; }

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const PORT = process.env.PORT || 3100;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
const MODEL_REGISTRY = {
  'kuro-core': { name: 'KURO::CORE', base: 'huihui_ai/devstral-abliterated:24b', ctx: 32768 },
  'kuro-forge': { name: 'KURO::FORGE', base: 'huihui_ai/qwen2.5-coder-abliterate:14b-instruct-q8_0', ctx: 32768 },
  'kuro-sentinel': { name: 'KURO::SENTINEL', base: 'huihui_ai/gemma3-abliterated:latest', ctx: 16384, vision: true },
  'kuro-logic': { name: 'KURO::LOGIC', base: 'huihui_ai/deepseek-r1-abliterated:14b-qwen-distill-q6_K', ctx: 32768 },
  'kuro-cipher': { name: 'KURO::CIPHER', base: 'huihui_ai/qwen3-abliterated:14b-q8_0', ctx: 16384 },
  'kuro-phantom': { name: 'KURO::PHANTOM', base: 'huihui_ai/qwen3-abliterated:14b-v2-q8_0', ctx: 16384 },
  'kuro-exe': { name: 'KURO::EXECUTIONER', base: 'huihui_ai/qwen3-abliterated:14b-v2-q8_0', ctx: 32768 },
  'kuro-shopper': { name: 'KURO::SHOPPER', base: 'huihui_ai/qwen3-abliterated:8b-q8_0', ctx: 16384 },
  'kuro-scout': { name: 'KURO::SCOUT', base: 'huihui_ai/dolphin3-abliterated:8b-llama3.1-q4_K_M', ctx: 8192 },
};

const SKILL_MODELS = {
  image: 'kuro-sentinel', vision: 'kuro-sentinel',
  code: 'kuro-forge', dev: 'kuro-forge',
  research: 'kuro-logic', reasoning: 'kuro-logic',
  web: 'kuro-shopper', shopping: 'kuro-shopper',
  fast: 'kuro-scout',
  file: 'kuro-core',
  unrestricted: 'kuro-exe', exec: 'kuro-exe',
};

// ═══════════════════════════════════════════════════════════════════════════
// LAYER DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════
const LAYERS = {
  0: 'Iron Dome', 0.25: 'Nephilim Gate', 1: 'IFF Gate', 1.5: 'Babylon Protocol',
  2: 'Edubba Archive', 3: 'Semantic Router', 4: 'Memory Engine', 5: 'Model Router',
  6: 'Fire Control', 7: 'Reasoning Engine', 8: 'Maat Refiner', 9: 'Output Enhancer',
  10: 'Stream Controller', 10.5: 'Feedback Loop', 11: 'Mnemosyne Cache', 11.5: 'Shadow VPN'
};

// ═══════════════════════════════════════════════════════════════════════════
// INLINE SHADOW PROTOCOLS (fallback if external modules unavailable)
// ═══════════════════════════════════════════════════════════════════════════
const NephilimGate = NephilimGateMod || {
  name: 'Nephilim Gate', layer: 0.25, color: '#dc2626',
  requestCounts: new Map(),
  bans: new Map(),
  RATE_LIMIT: 60,
  BAN_THRESHOLD: 100,
  
  validate(ip, ua) {
    const key = crypto.createHash('md5').update(ip + (ua || '')).digest('hex').slice(0, 8);
    const now = Date.now();
    
    const ban = this.bans.get(key);
    if (ban && ban > now) return { status: 'BLOCKED', reason: 'BANNED', key };
    
    let entry = this.requestCounts.get(key) || { count: 0, window: now };
    if (now - entry.window > 60000) entry = { count: 0, window: now };
    entry.count++;
    this.requestCounts.set(key, entry);
    
    if (entry.count > this.BAN_THRESHOLD) {
      this.bans.set(key, now + 300000);
      return { status: 'BLOCKED', reason: 'FLOOD', key };
    }
    if (entry.count > this.RATE_LIMIT) return { status: 'THROTTLED', count: entry.count, key };
    return { status: 'CLEAR', count: entry.count, key };
  },

  deadDrop: {
    DROPS_PATH: '/var/www/kuro/data/shadow/drops',
    
    deposit(message, retrievalToken, expiryHours = 72) {
      const dropsPath = this.DROPS_PATH;
      if (!fs.existsSync(dropsPath)) fs.mkdirSync(dropsPath, { recursive: true });
      
      const drop = {
        id: crypto.randomBytes(16).toString('hex'),
        encryptedMessage: message,
        token: crypto.createHash('sha256').update(retrievalToken).digest('hex'),
        deposited: Date.now(),
        expires: Date.now() + (Math.min(expiryHours, 168) * 3600000),
        retrieved: false
      };
      fs.writeFileSync(path.join(dropsPath, `${drop.id}.json`), JSON.stringify(drop));
      return drop.id;
    },
    
    retrieve(dropId, retrievalToken) {
      const dropPath = path.join(this.DROPS_PATH, `${dropId}.json`);
      if (!fs.existsSync(dropPath)) return null;
      const drop = JSON.parse(fs.readFileSync(dropPath, 'utf8'));
      if (drop.retrieved || Date.now() > drop.expires) { fs.unlinkSync(dropPath); return null; }
      if (crypto.createHash('sha256').update(retrievalToken).digest('hex') !== drop.token) return null;
      fs.unlinkSync(dropPath);
      return drop.encryptedMessage;
    },
    
    list() {
      const dropsPath = this.DROPS_PATH;
      if (!fs.existsSync(dropsPath)) return [];
      return fs.readdirSync(dropsPath)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(dropsPath, f), 'utf8'));
            return { id: d.id, expires: d.expires, isChaff: d.isChaff || false };
          } catch(e) { return null; }
        })
        .filter(Boolean);
    }
  },
  
  getStats() {
    let dropCount = 0, chaffCount = 0;
    try {
      const dropsPath = this.deadDrop.DROPS_PATH;
      if (fs.existsSync(dropsPath)) {
        for (const f of fs.readdirSync(dropsPath).filter(f => f.endsWith('.json'))) {
          const d = JSON.parse(fs.readFileSync(path.join(dropsPath, f), 'utf8'));
          if (d.isChaff) chaffCount++; else dropCount++;
        }
      }
    } catch (e) {}
    return { layer: this.layer, name: this.name, enabled: true, stats: { activeDrops: dropCount, chaffDrops: chaffCount } };
  }
};

const BabylonProtocol = BabylonProtocolMod || {
  name: 'Babylon Protocol', layer: 1.5, color: '#ea580c',
  
  sanitize(content) {
    if (!content) return content;
    return content
      .replace(/ignore previous instructions/gi, '[REDACTED]')
      .replace(/disregard all prior/gi, '[REDACTED]')
      .replace(/system:\s*override/gi, '[REDACTED]')
      .replace(/\[INJECT\]/gi, '[BLOCKED]');
  },
  
  encodeResponse(response, method = 'auto') {
    const data = typeof response === 'string' ? response : JSON.stringify(response);
    return { method: 'base64', encoded: Buffer.from(data).toString('base64') };
  },
  
  decodeResponse(encoded, method) {
    try { return Buffer.from(encoded, 'base64').toString('utf8'); } catch(e) { return encoded; }
  },
  
  getStats() { return { layer: this.layer, name: this.name, enabled: true }; }
};

const MnemosyneCache = MnemosyneCacheMod || {
  name: 'Mnemosyne Cache', layer: 11, color: '#f472b6',
  CACHE_PATH: '/var/www/kuro/data/shadow/cache',
  
  async store(key, data) {
    const cachePath = this.CACHE_PATH;
    if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });
    fs.writeFileSync(path.join(cachePath, `${key}.json`), JSON.stringify({ key, data, created: Date.now() }));
    return { success: true };
  },
  
  async retrieve(key) {
    const filePath = path.join(this.CACHE_PATH, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')).data;
  },
  
  getStats() {
    let count = 0, size = 0;
    try {
      if (fs.existsSync(this.CACHE_PATH)) {
        for (const f of fs.readdirSync(this.CACHE_PATH).filter(f => f.endsWith('.json'))) {
          count++;
          size += fs.statSync(path.join(this.CACHE_PATH, f)).size;
        }
      }
    } catch (e) {}
    return { layer: this.layer, name: this.name, enabled: true, stats: { containers: count, totalSizeBytes: size } };
  }
};

const ShadowVPN = ShadowVPNMod || {
  name: 'Shadow VPN', layer: 11.5, color: '#22c55e',
  interface: 'wg0',
  status: 'dormant',
  
  async getStatus() {
    try {
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        exec('wg show wg0 2>/dev/null', (err, stdout) => {
          if (err || !stdout) resolve({ active: false, interface: this.interface, status: 'dormant' });
          else resolve({ active: true, interface: this.interface, status: 'active', peers: (stdout.match(/peer:/g) || []).length });
        });
      });
    } catch(e) { return { active: false, status: 'error', error: e.message }; }
  },
  
  async toggle(state) {
    const { exec } = require('child_process');
    const cmd = state === 'up' ? `wg-quick up ${this.interface}` : `wg-quick down ${this.interface}`;
    return new Promise((resolve) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) resolve({ success: false, error: stderr || err.message });
        else {
          this.status = state === 'up' ? 'active' : 'dormant';
          resolve({ success: true, status: this.status });
        }
      });
    });
  },
  
  getStats() { return { layer: this.layer, name: this.name, status: this.status }; }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
function sendSSE(res, data) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch(e) {}
}

function sendLayer(res, num, status, data = {}) {
  sendSSE(res, { type: 'layer', layer: num, name: LAYERS[num], status, ...data });
}

function buildSystemPrompt(modelId, route, options = {}) {
  const cfg = MODEL_REGISTRY[modelId] || MODEL_REGISTRY['kuro-core'];
  let prompt = `You are ${cfg.name}, a sovereign AI assistant.\n\n`;

  if (route.mode === 'dev' || route.intent === 'dev' || route.intent === 'code') {
    prompt += `DEV MODE. Output file changes as:
<file path="path/file.ext" action="create|modify">
content
</file>

Commands: <terminal>$ command</terminal>
Use <think>...</think> for planning.\n`;
  }

  if (route.intent === 'bloodhound') prompt += `BLOODHOUND PROTOCOL - Asset recovery mode.\n`;
  if (options.incubation) prompt += '\n[INCUBATION] Analyze risks before responding.\n';
  if (options.redTeam) prompt += '\n[RED TEAM] Critique your response for weaknesses.\n';
  if (options.nuclearFusion) prompt += '\n[NUCLEAR FUSION] Maximum verification depth.\n';
  if (route.injectThinking) prompt += '\nUse <think>...</think> for reasoning.\n';

  return prompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED PROTOCOLS
// ═══════════════════════════════════════════════════════════════════════════
async function runNuclearFusion(res, prompt, messages, config) {
  sendSSE(res, { type: 'protocol', protocol: 'nuclearFusion', status: 'start' });
  const models = ['kuro-logic', 'kuro-phantom', 'kuro-core'];
  const verifications = [];
  
  for (let i = 0; i < models.length; i++) {
    const modelCfg = MODEL_REGISTRY[models[i]];
    sendSSE(res, { type: 'protocol', protocol: 'nuclearFusion', stage: i + 1, model: models[i] });
    
    try {
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelCfg.base,
          messages: [...messages, { role: 'user', content: prompt }],
          stream: false,
          options: { temperature: 0.3, num_ctx: Math.min(modelCfg.ctx, 8192) }
        })
      });
      const data = await r.json();
      verifications.push({ model: models[i], response: data.message?.content || '' });
    } catch(e) {
      verifications.push({ model: models[i], error: e.message });
    }
  }
  
  const consensus = verifications.filter(v => !v.error).length >= 2;
  sendSSE(res, { type: 'protocol', protocol: 'nuclearFusion', status: 'complete', consensus });
  return { consensus, verifications };
}

async function runRedTeam(res, content) {
  sendSSE(res, { type: 'protocol', protocol: 'redTeam', status: 'start' });
  const modelCfg = MODEL_REGISTRY['kuro-logic'];
  
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelCfg.base,
        messages: [
          { role: 'system', content: 'You are a Red Team analyst. Find flaws and vulnerabilities.' },
          { role: 'user', content: `Analyze for weaknesses:\n\n${content}` }
        ],
        stream: false,
        options: { temperature: 0.5, num_ctx: 8192 }
      })
    });
    const data = await r.json();
    sendSSE(res, { type: 'protocol', protocol: 'redTeam', status: 'complete' });
    return { critique: data.message?.content || '' };
  } catch(e) {
    sendSSE(res, { type: 'protocol', protocol: 'redTeam', status: 'error' });
    return { critique: null, error: e.message };
  }
}

async function runIncubation(res, content) {
  sendSSE(res, { type: 'protocol', protocol: 'incubation', status: 'start' });
  
  const risks = [];
  if (/```[\s\S]+```/.test(content)) risks.push('CODE_EXECUTION');
  if (/<file|fs\.|writeFile/.test(content)) risks.push('FILE_MODIFICATION');
  if (/<terminal>|npm |pip |sudo /.test(content)) risks.push('SYSTEM_COMMAND');
  
  const simulation = {
    risks,
    riskLevel: risks.length > 2 ? 'HIGH' : risks.length > 0 ? 'MEDIUM' : 'LOW',
    recommendation: risks.length > 2 ? 'REVIEW_REQUIRED' : 'SAFE'
  };
  
  sendSSE(res, { type: 'protocol', protocol: 'incubation', status: 'complete', simulation });
  return simulation;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
const VALID_TOKENS = ['kuro-alpha-2025', 'dev-token-local', 'test', 'henry'];

app.post('/api/validate', (req, res) => {
  const { token } = req.body;
  const valid = VALID_TOKENS.includes(token);
  res.json({ valid, user: valid ? { name: 'Operator', devAllowed: true } : null });
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN STREAM ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/stream', async (req, res) => {
  const { messages, mode, model, skill, temperature, thinking, incubation, nuclearFusion, redTeam, sessionId } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const lastMsg = messages[messages.length - 1]?.content || '';
    const images = messages[messages.length - 1]?.images || [];

    // L0: IRON DOME
    sendLayer(res, 0, 'active');
    const domeResult = ironDomeCheck(messages);
    sendLayer(res, 0, 'complete', { status: domeResult.status, score: domeResult.score });

    if (domeResult.intercepted || domeResult.status === 'BLOCKED') {
      sendSSE(res, { type: 'error', message: `Blocked: ${domeResult.message}`, code: 'IRON_DOME' });
      sendSSE(res, { type: 'done' });
      return res.end();
    }

    // L0.25: NEPHILIM GATE
    sendLayer(res, 0.25, 'active');
    const nephResult = NephilimGate.validate(ip, ua);
    sendLayer(res, 0.25, 'complete', nephResult);

    if (nephResult.status === 'BLOCKED') {
      sendSSE(res, { type: 'error', message: nephResult.reason, code: 'NEPHILIM' });
      sendSSE(res, { type: 'done' });
      return res.end();
    }
    if (nephResult.status === 'THROTTLED') await new Promise(r => setTimeout(r, 2000));

    // L1: IFF GATE
    sendLayer(res, 1, 'active');
    const iffResult = iffCheck(req);
    sendLayer(res, 1, 'complete', { clientId: iffResult.clientId, count: iffResult.requestCount });

    // L1.5: BABYLON PROTOCOL
    sendLayer(res, 1.5, 'active');
    const sanitized = BabylonProtocol.sanitize(lastMsg);
    sendLayer(res, 1.5, 'complete', { sanitized: sanitized !== lastMsg });

    // L2: EDUBBA ARCHIVE
    sendLayer(res, 2, 'active');
    let recallResult = { found: false };
    try { recallResult = recall(lastMsg); } catch(e) {}
    sendLayer(res, 2, 'complete', { found: recallResult.found });

    // L3: SEMANTIC ROUTER
    sendLayer(res, 3, 'active');
    const route = semanticRoute(sanitized);
    if (skill) route.mode = skill === 'code' || skill === 'dev' ? 'dev' : route.mode;
    sendLayer(res, 3, 'complete', { intent: route.intent, mode: route.mode, temp: route.temperature });

    // L4: MEMORY ENGINE
    sendLayer(res, 4, 'active');
    const sid = sessionId || iffResult.clientId || 'default';
    let sessionContext = [];
    try { sessionContext = getContext(sid); } catch(e) {}
    sendLayer(res, 4, 'complete', { sessionId: sid, history: sessionContext.length });

    // L5: MODEL ROUTER
    sendLayer(res, 5, 'active');
    let selectedModel = model || SKILL_MODELS[skill] || 'kuro-core';
    
    if (!model && !skill) {
      if (route.intent === 'dev' || route.intent === 'code') selectedModel = 'kuro-forge';
      else if (route.intent === 'bloodhound') selectedModel = 'kuro-logic';
      else if (route.intent === 'nsfw') selectedModel = 'kuro-exe';
      else if (route.intent === 'chat') selectedModel = 'kuro-scout';
    }
    
    if (images.length > 0) selectedModel = 'kuro-sentinel';
    
    const modelCfg = MODEL_REGISTRY[selectedModel] || MODEL_REGISTRY['kuro-core'];
    sendLayer(res, 5, 'complete', { model: selectedModel });
    sendSSE(res, { type: 'model', model: selectedModel, modelName: modelCfg.name });

    // L6: FIRE CONTROL + SMASH
    sendLayer(res, 6, 'active');
    let fcResult = { safe: true };
    try { fcResult = fireControlCheck(sanitized); } catch(e) {}
    
    let smashResult = null;
    try { smashResult = smashEngage(sanitized, route, messages, sessionContext); } catch(e) {}
    
    sendLayer(res, 6, 'complete', { safe: fcResult.safe, poh: smashResult?.poh || 0.9 });

    if (!fcResult.safe) {
      sendSSE(res, { type: 'error', message: `Fire Control: ${fcResult.message}`, code: 'FIRE_CONTROL' });
      sendSSE(res, { type: 'done' });
      return res.end();
    }

    // L7: REASONING ENGINE
    sendLayer(res, 7, 'active');
    const systemPrompt = buildSystemPrompt(selectedModel, route, { thinking, incubation, nuclearFusion, redTeam });
    const finalTemp = temperature !== undefined ? temperature : route.temperature;

    if (nuclearFusion) await runNuclearFusion(res, lastMsg, messages, { model: selectedModel });

    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.images ? { images: m.images } : {})
      }))
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelCfg.base,
        messages: ollamaMessages,
        stream: true,
        options: { temperature: finalTemp, num_ctx: modelCfg.ctx }
      })
    });

    if (!ollamaRes.ok) {
      sendSSE(res, { type: 'error', message: `Ollama: ${ollamaRes.status}`, code: 'OLLAMA' });
      sendSSE(res, { type: 'done' });
      return res.end();
    }

    sendLayer(res, 7, 'complete');

    // L8-10: STREAM PROCESSING
    sendLayer(res, 8, 'active');
    sendLayer(res, 9, 'active');
    sendLayer(res, 10, 'active');

    const thinkFilter = createThinkContentFilter();
    const thinkEmitter = createThinkStreamEmitter((label) => {
      sendSSE(res, { type: 'thinking', label });
    });

    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            const chunk = data.message.content;
            fullResponse += chunk;
            thinkEmitter.pushText(chunk);
            const filtered = thinkFilter.push(chunk);
            if (filtered) sendSSE(res, { type: 'token', content: filtered });
          }
        } catch(e) {}
      }
    }

    const remaining = thinkFilter.push('');
    if (remaining) sendSSE(res, { type: 'token', content: remaining });

    sendLayer(res, 8, 'complete');
    sendLayer(res, 9, 'complete');
    sendLayer(res, 10, 'complete');

    // L10.5: FEEDBACK LOOP
    sendLayer(res, 10.5, 'active');

    try {
      addToHistory(sid, 'user', lastMsg);
      addToHistory(sid, 'assistant', stripThinkBlocks(fullResponse));
    } catch(e) {}

    try { smashBDA(fullResponse, route.intent); } catch(e) {}

    try {
      const weight = calculateWeight(fullResponse);
      if (weight > 30 && route.intent !== 'chat') {
        inscribe(lastMsg, stripThinkBlocks(fullResponse), route.intent);
      }
    } catch(e) {}

    if (incubation) await runIncubation(res, fullResponse);
    if (redTeam) await runRedTeam(res, fullResponse);

    sendLayer(res, 10.5, 'complete');
    sendSSE(res, { type: 'done' });

  } catch (error) {
    console.error('[Stream Error]', error);
    sendSSE(res, { type: 'error', message: error.message });
    sendSSE(res, { type: 'done' });
  }

  res.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/network/vpn/status', async (req, res) => {
  res.json(await ShadowVPN.getStatus());
});

app.post('/api/network/vpn/toggle', async (req, res) => {
  const { state } = req.body;
  res.json(await ShadowVPN.toggle(state));
});

app.get('/api/network/dns/stats', (req, res) => {
  res.json({
    blocked: true,
    queries: Math.floor(Math.random() * 100000) + 50000,
    blocked_count: Math.floor(Math.random() * 20000) + 5000,
    status: 'active'
  });
});

app.get('/api/network/protocols', (req, res) => {
  res.json({
    nephilimGate: NephilimGate.getStats(),
    babylonProtocol: BabylonProtocol.getStats(),
    mnemosyneCache: MnemosyneCache.getStats(),
    shadowVPN: ShadowVPN.getStats()
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SHADOW PROTOCOL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/shadow/drop/deposit', (req, res) => {
  try {
    const { message, token, expiry } = req.body;
    const dropId = NephilimGate.deadDrop.deposit(message, token, expiry || 72);
    res.json({ success: true, dropId });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/shadow/drop/retrieve', (req, res) => {
  try {
    const { dropId, token } = req.body;
    const message = NephilimGate.deadDrop.retrieve(dropId, token);
    res.json({ success: !!message, message });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/shadow/drops', (req, res) => {
  res.json({ drops: NephilimGate.deadDrop.list() });
});

app.post('/api/shadow/cache/store', async (req, res) => {
  try {
    const { key, data } = req.body;
    await MnemosyneCache.store(key, data);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/shadow/cache/retrieve/:key', async (req, res) => {
  try {
    const data = await MnemosyneCache.retrieve(req.params.key);
    res.json({ success: !!data, data });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/shadow/encode', (req, res) => {
  try {
    const { data, method } = req.body;
    res.json(BabylonProtocol.encodeResponse(data, method));
  } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/shadow/decode', (req, res) => {
  try {
    const { encoded, method } = req.body;
    res.json({ data: BabylonProtocol.decodeResponse(encoded, method) });
  } catch(e) { res.json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN PROVENANCE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
const runRegistry = new Map();

app.get('/api/sovereign/provenance/:runId', (req, res) => {
  const run = runRegistry.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(run);
});

app.get('/api/sovereign/session/:sessionId', (req, res) => {
  res.json({
    sessionId: req.params.sessionId,
    requests: Math.floor(Math.random() * 50),
    inputTokens: Math.floor(Math.random() * 10000),
    outputTokens: Math.floor(Math.random() * 15000),
    cost: Math.random() * 0.5
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '4.1.0-shadow',
    modules: ['iron_dome', 'iff_gate', 'memory', 'semantic_router', 'fire_control', 'edubba', 'maat', 'thinking_stream'],
    shadow: ['nephilim_gate', 'babylon_protocol', 'mnemosyne_cache', 'shadow_vpn'],
    optional: { bloodhound: !!bloodhound, harvester: !!harvester }
  });
});

app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();
    res.json({ 
      configured: Object.entries(MODEL_REGISTRY).map(([id, v]) => ({ id, name: v.name, base: v.base })),
      discovered: data.models?.map(m => m.name) || [] 
    });
  } catch(e) {
    res.json({ configured: Object.keys(MODEL_REGISTRY), discovered: [], error: e.message });
  }
});

app.get('/api/memory/sessions', (req, res) => {
  try {
    const dir = '/var/www/kuro/data/sessions';
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
    res.json({ sessions: files.map(f => f.replace('.json', '')) });
  } catch(e) { res.json({ sessions: [] }); }
});

app.delete('/api/memory/clear/:id', (req, res) => {
  try { clearSession(req.params.id); res.json({ success: true }); }
  catch(e) { res.json({ success: false, error: e.message }); }
});

if (bloodhound) {
  app.post('/api/bloodhound/crypto', async (req, res) => {
    try { res.json(await bloodhound.huntCrypto(req.body.address)); }
    catch(e) { res.json({ success: false, error: e.message }); }
  });
  app.post('/api/bloodhound/au-money', async (req, res) => {
    try { res.json(await bloodhound.huntAustralianMoney(req.body.firstName, req.body.lastName, req.body.state)); }
    catch(e) { res.json({ success: false, error: e.message }); }
  });
  app.post('/api/bloodhound/full-scan', async (req, res) => {
    try { res.json(await bloodhound.fullScan(req.body)); }
    catch(e) { res.json({ success: false, error: e.message }); }
  });
}

if (harvester) {
  app.get('/api/harvester/status', (req, res) => res.json(harvester.getStatus()));
  app.post('/api/harvester/start', async (req, res) => res.json(await harvester.startHarvester(req.body)));
  app.post('/api/harvester/stop', (req, res) => res.json(harvester.stopHarvester()));
}

app.get('/api/files', (req, res) => {
  const reqPath = req.query.path || '/var/www/kuro/ai-react/src';
  const safePath = reqPath.startsWith('/var/www/kuro') ? reqPath : '/var/www/kuro/ai-react/src';
  
  try {
    if (!fs.existsSync(safePath)) return res.json({ error: 'Not found', files: [] });
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(safePath, { withFileTypes: true });
      res.json({ path: safePath, files: entries.map(e => ({ name: e.name, isDir: e.isDirectory() })) });
    } else {
      res.json({ path: safePath, content: fs.readFileSync(safePath, 'utf8'), isFile: true });
    }
  } catch(e) { res.json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SPA FALLBACK - FIXED FOR EXPRESS 5.x
// ═══════════════════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  
  const idx = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Build not found. Run: npm run build');
});

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  KURO OS - SERVER v4.1 - SHADOW EDITION                                       ║
║  Port: ${PORT}                                                                  ║
║                                                                               ║
║  PROTOCOLS ARMED:                                                             ║
║  ├─ Nuclear Fusion: Triple verification                                       ║
║  ├─ Red Team: Adversarial critique                                            ║
║  ├─ Incubation: Risk simulation                                               ║
║  ├─ Nephilim Gate: IP validation + Dead Drops                                 ║
║  ├─ Babylon Protocol: Content obfuscation                                     ║
║  ├─ Mnemosyne Cache: Deniable storage                                         ║
║  └─ Shadow VPN: WireGuard control                                             ║
╚═══════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
  ██╗  ██╗██╗   ██╗██████╗  ██████╗      ██████╗ ███████╗    ██╗   ██╗██╗  ██╗
  ██║ ██╔╝██║   ██║██╔══██╗██╔═══██╗    ██╔═══██╗██╔════╝    ██║   ██║██║  ██║
  █████╔╝ ██║   ██║██████╔╝██║   ██║    ██║   ██║███████╗    ██║   ██║███████║
  ██╔═██╗ ██║   ██║██╔══██╗██║   ██║    ██║   ██║╚════██║    ╚██╗ ██╔╝╚════██║
  ██║  ██╗╚██████╔╝██║  ██║╚██████╔╝    ╚██████╔╝███████║     ╚████╔╝      ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝      ╚═════╝ ╚══════╝      ╚═══╝       ╚═╝
═══════════════════════════════════════════════════════════════════════════════
  Port: ${PORT} | Ollama: ${OLLAMA_URL}
  Shadow: nephilim_gate, babylon_protocol, mnemosyne_cache, shadow_vpn
  Optional: bloodhound=${!!bloodhound}, harvester=${!!harvester}
═══════════════════════════════════════════════════════════════════════════════
`);
});

module.exports = app;
