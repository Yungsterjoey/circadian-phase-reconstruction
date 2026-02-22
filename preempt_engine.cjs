/**
 * KURO::PREEMPT v2 — Hardened Speculative Pre-Inference Engine
 * 
 * Fixes: RT-01 through RT-08
 * 
 * RT-01: Global concurrency cap + per-session cooldown + Ollama cancel
 * RT-02: Superset-only claiming, weighted similarity, 0.75 threshold
 * RT-03: Auth required (validated externally before calling)
 * RT-04: No continuation prompt — fresh inference with buffer head-start
 * RT-05: Buffer snapshot on claim, no mutation during flush
 * RT-06: No messages in speculate — server-side session lookup
 * RT-07: Graceful shutdown handler
 * RT-08: Client-side fetch fixes (see usePreempt v2)
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const STALE_MS = 30000;

// ═══ RT-01: Tuned limits ═══
const MAX_CONCURRENT_SPECULATIONS = 3;
const PER_SESSION_COOLDOWN_MS = 2000;
const MAX_BUFFER_TOKENS = 150;

// ═══ RT-02: Stricter threshold ═══
const SIMILARITY_THRESHOLD = 0.75;

const speculations = new Map();
const cooldowns = new Map(); // sessionId → last speculation timestamp

/**
 * RT-02: Weighted word-overlap similarity.
 * Final words weighted 2x — they determine intent more than opening words.
 */
function similarity(speculated, final) {
  if (!speculated || !final) return 0;
  const wordsA = speculated.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = final.toLowerCase().split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  // Weight: last 3 words count double
  const tailCount = 3;
  let score = 0;
  let maxScore = 0;

  for (let i = 0; i < wordsA.length; i++) {
    const weight = (i >= wordsA.length - tailCount) ? 2 : 1;
    maxScore += weight;
    if (wordsB.includes(wordsA[i])) score += weight;
  }

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * RT-02: Superset check — final input must contain all speculated words.
 * User can ADD words but not CHANGE core words.
 */
function isSupersetOf(speculated, final) {
  const wordsA = new Set(speculated.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(final.toLowerCase().split(/\s+/).filter(Boolean));
  let contained = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) contained++;
  }
  // Allow 1 word divergence for typo tolerance
  return contained >= wordsA.size - 1;
}

/**
 * RT-01: Check global concurrency + per-session cooldown
 */
function canSpeculate(sessionId) {
  // Global cap
  let activeCount = 0;
  for (const [, s] of speculations) {
    if (s.status === 'streaming') activeCount++;
  }
  if (activeCount >= MAX_CONCURRENT_SPECULATIONS) return { allowed: false, reason: 'global_cap' };

  // Per-session cooldown
  const lastTime = cooldowns.get(sessionId) || 0;
  if (Date.now() - lastTime < PER_SESSION_COOLDOWN_MS) return { allowed: false, reason: 'cooldown' };

  return { allowed: true };
}

/**
 * Start or update a speculative inference.
 * RT-03: Auth is validated by the route layer before this is called.
 * RT-06: sessionId used for server-side context lookup, no messages param.
 */
async function speculate(sessionId, partialInput, getSessionContext, modelConfig) {
  // RT-01: Check limits
  const check = canSpeculate(sessionId);
  if (!check.allowed) return { action: 'throttled', reason: check.reason };

  const existing = speculations.get(sessionId);

  // If existing speculation is close enough AND final is superset, keep it
  if (existing && existing.status === 'streaming') {
    const sim = similarity(existing.input, partialInput);
    if (sim >= SIMILARITY_THRESHOLD && isSupersetOf(existing.input, partialInput)) {
      existing.lastUpdate = Date.now();
      return { action: 'continued', buffered: existing.buffer.length };
    }
    // Diverged — abort and restart
    await abortSpeculation(sessionId);
  }

  // Don't speculate on very short input
  if (partialInput.trim().split(/\s+/).length < 3) {
    return { action: 'too_short' };
  }

  // RT-06: Get messages from server-side session, not from client
  let messages = [];
  if (typeof getSessionContext === 'function') {
    try {
      messages = await getSessionContext(sessionId);
    } catch (e) {
      messages = [];
    }
  }

  const state = {
    input: partialInput,
    buffer: [],
    status: 'streaming',
    abortController: new AbortController(),
    startTime: Date.now(),
    lastUpdate: Date.now(),
    model: modelConfig?.name || 'kuro-main',
    mode: modelConfig?.mode || 'main'
  };

  speculations.set(sessionId, state);
  cooldowns.set(sessionId, Date.now()); // RT-01: Set cooldown

  // Fire and forget
  _streamIntoBuffer(sessionId, partialInput, messages, modelConfig).catch(err => {
    if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
      console.error(`[PREEMPT] ${sessionId} error:`, err.message);
    }
  });

  return { action: 'started' };
}

/**
 * Internal: Ollama inference → buffer tokens silently
 */
async function _streamIntoBuffer(sessionId, input, messages, modelConfig) {
  const state = speculations.get(sessionId);
  if (!state) return;

  const model = modelConfig?.name || 'kuro-main';
  const ctx = modelConfig?.ctx || 16384;

  const chatMessages = [
    ...(messages || []),
    { role: 'user', content: input }
  ];

  try {
    const response = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model,
      messages: chatMessages,
      stream: true,
      options: { num_ctx: ctx, temperature: 0.7 }
    }, {
      responseType: 'stream',
      signal: state.abortController.signal,
      timeout: 60000
    });

    let lineBuffer = '';

    response.data.on('data', (chunk) => {
      if (state.status !== 'streaming') return;

      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            state.buffer.push(data.message.content);
            if (state.buffer.length >= MAX_BUFFER_TOKENS) {
              state.status = 'capped';
              state.abortController.abort();
              return;
            }
          }
          if (data.done) {
            state.status = 'done';
          }
        } catch (e) { /* skip */ }
      }
    });

    response.data.on('end', () => {
      if (state.status === 'streaming') state.status = 'done';
    });

    response.data.on('error', (err) => {
      if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
        state.status = 'error';
      }
    });

  } catch (err) {
    if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
      state.status = 'error';
    }
  }
}

/**
 * RT-01: Abort with Ollama inference cancellation attempt
 */
async function abortSpeculation(sessionId) {
  const state = speculations.get(sessionId);
  if (!state) return;

  state.status = 'aborted';
  try { state.abortController.abort(); } catch (e) {}
  speculations.delete(sessionId);

  // RT-01: Attempt to cancel Ollama inference
  // Ollama doesn't have a cancel API, but destroying the stream
  // causes it to stop after the current token batch completes.
  // The abort above handles this via axios signal.
}

/**
 * RT-04 + RT-05: Claim speculation for delivery.
 * Returns SNAPSHOT of buffer. Does NOT attempt continuation —
 * caller starts fresh inference and uses buffer as head-start.
 * 
 * RT-02: Only claims if final input is superset of speculated input.
 */
function claim(sessionId, finalInput) {
  const state = speculations.get(sessionId);
  if (!state) return null;

  // RT-02: Strict similarity + superset check
  const sim = similarity(state.input, finalInput);
  if (sim < SIMILARITY_THRESHOLD || !isSupersetOf(state.input, finalInput)) {
    abortSpeculation(sessionId);
    return null;
  }

  // RT-05: Snapshot buffer before any mutation
  const bufferSnapshot = [...state.buffer];
  const result = {
    buffer: bufferSnapshot,
    status: state.status,
    speculatedInput: state.input,
    model: state.model,
    startTime: state.startTime,
    tokenCount: bufferSnapshot.length
  };

  // Now safely abort and cleanup
  state.status = 'claimed';
  try { state.abortController.abort(); } catch (e) {}
  speculations.delete(sessionId);

  return result;
}

function hasSpeculation(sessionId) {
  return speculations.has(sessionId);
}

/**
 * Cleanup stale speculations
 */
function cleanup() {
  const now = Date.now();
  for (const [id, state] of speculations) {
    if (now - state.lastUpdate > STALE_MS) {
      abortSpeculation(id);
    }
  }
  // Cleanup old cooldowns
  for (const [id, ts] of cooldowns) {
    if (now - ts > STALE_MS) cooldowns.delete(id);
  }
}

setInterval(cleanup, 15000);

/**
 * RT-07: Graceful shutdown — abort all speculations
 */
function shutdown() {
  console.log(`[PREEMPT] Shutting down, aborting ${speculations.size} speculations`);
  for (const [id] of speculations) {
    abortSpeculation(id);
  }
  speculations.clear();
  cooldowns.clear();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  speculate,
  abortSpeculation,
  claim,
  hasSpeculation,
  similarity,
  isSupersetOf,
  shutdown
};
