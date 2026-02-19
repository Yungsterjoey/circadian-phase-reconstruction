/**
 * KURO::FRONTIER ASSIST v1.0
 * 
 * Pluggable provider router for hosted model fallback.
 * When Fire Control POH drops below threshold, routes complex tasks
 * to a stronger hosted model (Anthropic/OpenAI/Gemini).
 * 
 * Design principles:
 *   - Local-first: kuro-core handles 90%+ of requests
 *   - Frontier only when POH < threshold AND user tier allows it
 *   - Provider is pluggable — no hard binding to any vendor
 *   - Every frontier call logged to audit chain with full provenance
 *   - Streaming support for SSE passthrough
 *   - Graceful degradation: if frontier fails, fall back to local
 * 
 * Tier gating:
 *   Free: never (local_only always)
 *   Pro: enabled when POH < 0.4 (complex tasks)
 *   Sovereign: enabled when POH < 0.6 (lower threshold = more frontier usage)
 */

const https = require('https');
const crypto = require('crypto');

// ═══ Provider Registry ═══
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }),
    buildPayload: (messages, systemPrompt, opts) => ({
      model: opts.model || 'claude-sonnet-4-20250514',
      max_tokens: opts.maxTokens || 4096,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content
      })).filter(m => m.role !== 'system'),
      stream: true
    }),
    parseStream: (line) => {
      // Anthropic SSE: event: content_block_delta, data: {"delta":{"text":"..."}}
      if (!line.startsWith('data: ')) return null;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'content_block_delta' && data.delta?.text) {
          return { token: data.delta.text, done: false };
        }
        if (data.type === 'message_stop') return { token: '', done: true };
        return null;
      } catch(e) { return null; }
    }
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'content-type': 'application/json'
    }),
    buildPayload: (messages, systemPrompt, opts) => ({
      model: opts.model || 'gpt-4o',
      max_tokens: opts.maxTokens || 4096,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true
    }),
    parseStream: (line) => {
      if (!line.startsWith('data: ')) return null;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return { token: '', done: true };
      try {
        const data = JSON.parse(raw);
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) return { token: delta, done: false };
        if (data.choices?.[0]?.finish_reason) return { token: '', done: true };
        return null;
      } catch(e) { return null; }
    }
  },
  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.0-flash',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-goog-api-key': key
    }),
    buildPayload: (messages, systemPrompt, opts) => ({
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: opts.maxTokens || 4096 }
    }),
    parseStream: (line) => {
      // Gemini streaming returns JSON chunks
      try {
        const data = JSON.parse(line);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { token: text, done: false };
        if (data.candidates?.[0]?.finishReason) return { token: '', done: true };
        return null;
      } catch(e) { return null; }
    }
  }
};

// ═══ POH Thresholds per tier ═══
const POH_THRESHOLDS = {
  free: 0.0,       // Never route to frontier
  pro: 0.4,        // Route when POH < 0.4 (hard tasks)
  sovereign: 0.6   // Route when POH < 0.6 (more frontier usage)
};

// ═══ Rate limits per tier (frontier calls/hour) ═══
const FRONTIER_RATE_LIMITS = {
  free: 0,
  pro: 20,
  sovereign: 100
};

const frontierUsage = new Map(); // userId -> { count, windowStart }
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkFrontierQuota(userId, tier) {
  const limit = FRONTIER_RATE_LIMITS[tier] || 0;
  if (limit === 0) return { allowed: false, reason: 'tier_blocked' };
  
  const now = Date.now();
  let entry = frontierUsage.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    frontierUsage.set(userId, entry);
  }
  
  if (entry.count >= limit) return { allowed: false, reason: 'rate_limited', remaining: 0 };
  return { allowed: true, remaining: limit - entry.count };
}

function consumeFrontierQuota(userId) {
  const entry = frontierUsage.get(userId);
  if (entry) entry.count++;
}

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of frontierUsage) {
    if (now - v.windowStart > WINDOW_MS) frontierUsage.delete(k);
  }
}, 15 * 60 * 1000);

// ═══ Decision Engine ═══
function shouldUseFrontier(poh, tier, userId) {
  const threshold = POH_THRESHOLDS[tier] || 0;
  if (threshold === 0) return { useFrontier: false, reason: 'tier_not_eligible' };
  if (poh >= threshold) return { useFrontier: false, reason: 'poh_sufficient', poh, threshold };
  
  const quota = checkFrontierQuota(userId, tier);
  if (!quota.allowed) return { useFrontier: false, reason: quota.reason };
  
  return { useFrontier: true, reason: 'poh_below_threshold', poh, threshold, remaining: quota.remaining };
}

// ═══ Streaming Frontier Request ═══
function streamFrontier(provider, apiKey, messages, systemPrompt, opts, callbacks) {
  const p = PROVIDERS[provider];
  if (!p) {
    callbacks.onError(new Error(`Unknown provider: ${provider}`));
    return;
  }

  const payload = p.buildPayload(messages, systemPrompt, opts);
  const url = new URL(provider === 'gemini' 
    ? `${p.endpoint}/${opts.model || p.model}:streamGenerateContent?alt=sse`
    : p.endpoint);

  const headers = p.headers(apiKey);
  const requestOpts = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(JSON.stringify(payload)) }
  };

  const requestId = crypto.randomBytes(8).toString('hex');
  let totalTokens = 0;
  let fullText = '';

  const req = https.request(requestOpts, (res) => {
    if (res.statusCode !== 200) {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        callbacks.onError(new Error(`${p.name} ${res.statusCode}: ${body.slice(0, 200)}`));
      });
      return;
    }

    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const result = p.parseStream(line);
        if (!result) continue;
        if (result.done) {
          callbacks.onDone({ tokens: totalTokens, text: fullText, requestId, provider });
          return;
        }
        if (result.token) {
          totalTokens++;
          fullText += result.token;
          callbacks.onToken(result.token);
        }
      }
    });

    res.on('end', () => {
      if (totalTokens > 0) {
        callbacks.onDone({ tokens: totalTokens, text: fullText, requestId, provider });
      }
    });

    res.on('error', callbacks.onError);
  });

  req.on('error', callbacks.onError);
  req.write(JSON.stringify(payload));
  req.end();

  return { requestId, abort: () => req.destroy() };
}

// ═══ Configuration ═══
function getActiveProvider() {
  const provider = process.env.FRONTIER_PROVIDER || 'anthropic';
  const key = process.env.FRONTIER_API_KEY || process.env[`${provider.toUpperCase()}_API_KEY`] || '';
  const model = process.env.FRONTIER_MODEL || PROVIDERS[provider]?.model || '';
  return { provider, key, model, configured: !!key };
}

module.exports = {
  PROVIDERS,
  POH_THRESHOLDS,
  FRONTIER_RATE_LIMITS,
  shouldUseFrontier,
  streamFrontier,
  consumeFrontierQuota,
  checkFrontierQuota,
  getActiveProvider
};
