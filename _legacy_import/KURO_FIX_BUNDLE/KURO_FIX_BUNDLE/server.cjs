/**
 * KURO OS - SERVER v4.1 MEGA FIX
 * Port: 3100 | All layer modules integrated with proper error handling
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Safe module loading
const loadModule = (file, fallback) => { try { return require(file); } catch(e) { console.log(`[WARN] ${file} not found`); return fallback; } };

const { ironDomeCheck = () => ({ status: 'CLEAR', score: 100 }) } = loadModule('./iron_dome.js', {});
const { iffCheck = (req) => ({ clientId: crypto.randomBytes(4).toString('hex'), requestCount: 1 }) } = loadModule('./iff_gate.js', {});
const { addToHistory = () => {}, getContext = () => [], clearSession = () => {} } = loadModule('./memory.js', {});
const { semanticRoute = () => ({ intent: 'chat', mode: 'main', temperature: 0.7 }) } = loadModule('./semantic_router.js', {});
const { fireControlCheck = () => ({ safe: true }), smashEngage = () => ({ poh: 0.9 }), smashBDA = () => {} } = loadModule('./fire_control.js', {});
const { recall = () => ({ found: false }), inscribe = () => {} } = loadModule('./edubba_archive.js', {});
const { calculateWeight = () => 50 } = loadModule('./maat_refiner.js', {});
const { stripThinkBlocks = (t) => t.replace(/<think>[\s\S]*?<\/think>/g, ''), createThinkContentFilter = () => ({ push: (t) => t }) } = loadModule('./thinking_stream.js', {});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const PORT = 3100;
const OLLAMA_URL = 'http://localhost:11434';
const TIMEOUT = 120000;

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

const SKILL_MODELS = { image: 'kuro-sentinel', vision: 'kuro-sentinel', code: 'kuro-forge', dev: 'kuro-forge', research: 'kuro-logic', web: 'kuro-shopper', fast: 'kuro-scout', file: 'kuro-core', unrestricted: 'kuro-exe' };
const LAYERS = { 0: 'Iron Dome', 0.25: 'Nephilim Gate', 1: 'IFF Gate', 1.5: 'Babylon Protocol', 2: 'Edubba Archive', 3: 'Semantic Router', 4: 'Memory Engine', 5: 'Model Router', 6: 'Fire Control', 7: 'Reasoning Engine', 8: 'Maat Refiner', 9: 'Output Enhancer', 10: 'Stream Controller', 10.5: 'Feedback Loop' };

// Rate limiter
const rateLimiter = { counts: new Map(), bans: new Map(), check(ip) { const k = crypto.createHash('md5').update(ip).digest('hex').slice(0,8), n = Date.now(); if (this.bans.get(k) > n) return { blocked: true }; let e = this.counts.get(k) || { c: 0, w: n }; if (n - e.w > 60000) e = { c: 0, w: n }; e.c++; this.counts.set(k, e); if (e.c > 100) { this.bans.set(k, n + 300000); return { blocked: true }; } return { blocked: false, throttle: e.c > 60, count: e.c }; } };

// Sanitizer
const sanitize = (t) => { if (!t) return { text: t, modified: false }; const patterns = [/ignore previous instructions/gi, /disregard all prior/gi, /system:\s*override/gi]; let m = false; patterns.forEach(p => { if (p.test(t)) { t = t.replace(p, '[REDACTED]'); m = true; } }); return { text: t, modified: m }; };

// SSE helpers
const sse = (res, d) => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch(e) {} };
const layer = (res, n, s, d = {}) => sse(res, { type: 'layer', layer: n, name: LAYERS[n], status: s, ...d });

// Fetch with timeout
const fetchT = async (url, opts, t = TIMEOUT) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { const r = await fetch(url, { ...opts, signal: c.signal }); clearTimeout(id); return r; } catch(e) { clearTimeout(id); throw e.name === 'AbortError' ? new Error(`Timeout ${t}ms`) : e; } };

// Protocols
const runIncubation = (res, content) => {
  sse(res, { type: 'protocol', protocol: 'incubation', status: 'start' });
  const risks = [];
  if (/```[\s\S]+```/.test(content)) risks.push('CODE_EXECUTION');
  if (/<file|fs\.|writeFile/.test(content)) risks.push('FILE_MODIFICATION');
  if (/<terminal>|npm |pip |sudo /.test(content)) risks.push('SYSTEM_COMMAND');
  if (/password|secret|api.?key/i.test(content)) risks.push('SENSITIVE_DATA');
  const simulation = { risks, riskLevel: risks.length > 2 ? 'HIGH' : risks.length > 0 ? 'MEDIUM' : 'LOW', recommendation: risks.length > 2 ? 'REVIEW_REQUIRED' : 'SAFE' };
  sse(res, { type: 'protocol', protocol: 'incubation', status: 'complete', simulation });
  return simulation;
};

const runRedTeam = async (res, content) => {
  sse(res, { type: 'protocol', protocol: 'redTeam', status: 'start' });
  try {
    const m = MODEL_REGISTRY['kuro-logic'];
    const r = await fetchT(`${OLLAMA_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.base, messages: [{ role: 'system', content: 'Red Team analyst. Find flaws concisely.' }, { role: 'user', content: `Analyze:\n${content.slice(0, 3000)}` }], stream: false, options: { temperature: 0.5, num_ctx: 8192 } }) }, 45000);
    const d = await r.json();
    const critique = d.message?.content || 'No critique';
    sse(res, { type: 'protocol', protocol: 'redTeam', status: 'complete', critique });
    return { critique };
  } catch(e) { sse(res, { type: 'protocol', protocol: 'redTeam', status: 'error' }); return { critique: null }; }
};

const runFireControl = (res, content, route) => {
  sse(res, { type: 'protocol', protocol: 'fireControl', status: 'start' });
  let fc = { safe: true }, sm = { poh: 0.9 };
  try { fc = fireControlCheck(content); sm = smashEngage(content, route, [], []); } catch(e) {}
  sse(res, { type: 'protocol', protocol: 'fireControl', status: 'complete', safe: fc.safe, poh: sm.poh });
  return { safe: fc.safe, poh: sm.poh };
};

// Main stream
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
    const ip = req.ip || req.headers['x-forwarded-for'] || '?';
    const lastMsg = messages[messages.length - 1]?.content || '';
    const images = messages[messages.length - 1]?.images || [];

    // L0: Iron Dome
    layer(res, 0, 'active');
    let dome = { status: 'CLEAR', score: 100 };
    try { dome = ironDomeCheck(messages); } catch(e) {}
    layer(res, 0, 'complete', { status: dome.status, score: dome.score });
    if (dome.intercepted || dome.status === 'BLOCKED') { sse(res, { type: 'error', message: 'Iron Dome blocked', code: 'BLOCKED' }); sse(res, { type: 'done' }); return res.end(); }

    // L0.25: Nephilim
    layer(res, 0.25, 'active');
    const rate = rateLimiter.check(ip);
    layer(res, 0.25, 'complete', { ...rate });
    if (rate.blocked) { sse(res, { type: 'error', message: 'Rate limited', code: 'RATE' }); sse(res, { type: 'done' }); return res.end(); }
    if (rate.throttle) await new Promise(r => setTimeout(r, 2000));

    // L1: IFF
    layer(res, 1, 'active');
    let iff = { clientId: crypto.randomBytes(4).toString('hex'), requestCount: 1 };
    try { iff = iffCheck(req); } catch(e) {}
    layer(res, 1, 'complete', iff);

    // L1.5: Babylon
    layer(res, 1.5, 'active');
    const san = sanitize(lastMsg);
    layer(res, 1.5, 'complete', { sanitized: san.modified });

    // L2: Edubba
    layer(res, 2, 'active');
    let rec = { found: false };
    try { rec = recall(san.text); } catch(e) {}
    layer(res, 2, 'complete', { found: rec.found });

    // L3: Semantic
    layer(res, 3, 'active');
    let route = { intent: 'chat', mode: 'main', temperature: 0.7 };
    try { route = semanticRoute(san.text); } catch(e) {}
    if (skill === 'code' || skill === 'dev' || mode === 'dev' || mode === 'exe') route.mode = 'dev';
    layer(res, 3, 'complete', route);

    // L4: Memory
    layer(res, 4, 'active');
    const sid = sessionId || iff.clientId || 'default';
    let ctx = [];
    try { ctx = getContext(sid); } catch(e) {}
    layer(res, 4, 'complete', { sessionId: sid, history: ctx.length });

    // L5: Model Router
    layer(res, 5, 'active');
    let selModel = model || SKILL_MODELS[skill] || 'kuro-core';
    if (!model && !skill) {
      if (route.intent === 'dev' || route.intent === 'code') selModel = 'kuro-forge';
      else if (route.intent === 'nsfw') selModel = 'kuro-exe';
      else if (san.text.length < 100 && route.intent === 'chat') selModel = 'kuro-scout';
    }
    if (images.length > 0) selModel = 'kuro-sentinel';
    const cfg = MODEL_REGISTRY[selModel] || MODEL_REGISTRY['kuro-core'];
    layer(res, 5, 'complete', { model: selModel });
    sse(res, { type: 'model', model: selModel, modelName: cfg.name, trustZone: 'VPS' });

    // L6: Fire Control
    layer(res, 6, 'active');
    const fc = runFireControl(res, san.text, route);
    layer(res, 6, 'complete', fc);
    if (!fc.safe) { sse(res, { type: 'error', message: 'Fire Control blocked', code: 'FC' }); sse(res, { type: 'done' }); return res.end(); }

    // L7: Reasoning
    layer(res, 7, 'active');
    let sys = `You are ${cfg.name}, a sovereign AI. Respond helpfully.\n`;
    if (route.mode === 'dev') sys += 'DEV MODE: Output code as <file path="...">content</file>, commands as <terminal>$ cmd</terminal>\n';
    if (thinking) sys += 'Use <think>...</think> for reasoning.\n';
    if (incubation) sys += 'Wrap risk analysis in <incubation>...</incubation>\n';
    if (redTeam) sys += 'Wrap self-critique in <critique>...</critique>\n';
    const temp = temperature ?? route.temperature;
    layer(res, 7, 'complete');

    // L8: Maat
    layer(res, 8, 'active');
    let ollamaRes;
    try {
      ollamaRes = await fetchT(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.base, messages: [{ role: 'system', content: sys }, ...messages.map(m => ({ role: m.role, content: m.content, ...(m.images ? { images: m.images } : {}) }))], stream: true, options: { temperature: temp, num_ctx: cfg.ctx } })
      });
    } catch(e) { sse(res, { type: 'error', message: `Ollama: ${e.message}`, code: 'OLLAMA' }); sse(res, { type: 'done' }); return res.end(); }
    if (!ollamaRes.ok) { const t = await ollamaRes.text().catch(() => '?'); sse(res, { type: 'error', message: `Ollama ${ollamaRes.status}: ${t}`, code: 'OLLAMA' }); sse(res, { type: 'done' }); return res.end(); }
    layer(res, 8, 'complete');

    // L9-10: Stream
    layer(res, 9, 'active');
    layer(res, 10, 'active');
    const filter = createThinkContentFilter();
    const reader = ollamaRes.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', tokens = 0;

    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const ln of lines) {
        if (!ln.trim()) continue;
        try {
          const d = JSON.parse(ln);
          if (d.message?.content) {
            full += d.message.content;
            tokens++;
            const filtered = filter.push(d.message.content);
            if (filtered) sse(res, { type: 'token', content: filtered });
          }
        } catch(e) {}
      }
    }
    const rem = filter.push('');
    if (rem) sse(res, { type: 'token', content: rem });
    layer(res, 9, 'complete', { tokens });
    layer(res, 10, 'complete');

    // L10.5: Feedback
    layer(res, 10.5, 'active');
    try { addToHistory(sid, 'user', san.text); addToHistory(sid, 'assistant', stripThinkBlocks(full)); } catch(e) {}
    try { smashBDA(full, route.intent); } catch(e) {}
    try { const w = calculateWeight(full); if (w > 30 && route.intent !== 'chat') inscribe(san.text, stripThinkBlocks(full), route.intent); } catch(e) {}
    if (incubation && !aborted) runIncubation(res, full);
    if (redTeam && !aborted) await runRedTeam(res, full);
    layer(res, 10.5, 'complete');
    sse(res, { type: 'done' });

  } catch (e) {
    console.error('[Stream Error]', e);
    sse(res, { type: 'error', message: e.message });
    sse(res, { type: 'done' });
  }
  res.end();
});

// API
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.1.0-MEGA', port: PORT }));
app.get('/api/models', async (req, res) => {
  try {
    const r = await fetchT(`${OLLAMA_URL}/api/tags`, {}, 10000);
    const d = await r.json();
    res.json({ configured: Object.entries(MODEL_REGISTRY).map(([id, v]) => ({ id, ...v })), discovered: d.models || [] });
  } catch(e) { res.json({ configured: Object.keys(MODEL_REGISTRY), error: e.message }); }
});

app.get('/api/memory/sessions', (req, res) => { try { const d = '/var/www/kuro/data/sessions'; res.json({ sessions: fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')) : [] }); } catch(e) { res.json({ sessions: [] }); } });
app.delete('/api/memory/clear/:id', (req, res) => { try { clearSession(req.params.id); res.json({ success: true }); } catch(e) { res.json({ success: false }); } });

app.get('/api/files', (req, res) => {
  const p = (req.query.path || '/var/www/kuro/ai-react/src').startsWith('/var/www/kuro') ? req.query.path : '/var/www/kuro/ai-react/src';
  try { if (!fs.existsSync(p)) return res.json({ error: 'Not found' }); const s = fs.statSync(p); if (s.isDirectory()) res.json({ path: p, files: fs.readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() })) }); else res.json({ path: p, content: fs.readFileSync(p, 'utf8'), isFile: true }); } catch(e) { res.json({ error: e.message }); }
});

app.get('*', (req, res) => { const i = path.join(__dirname, 'dist', 'index.html'); fs.existsSync(i) ? res.sendFile(i) : res.status(404).send('Run: npm run build'); });

app.listen(PORT, () => console.log(`\n  KURO OS v4.1 MEGA | Port ${PORT} | Ollama ${OLLAMA_URL}\n`));
module.exports = app;
