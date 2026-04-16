'use strict';
// §3, §5.1, §5.3 — shared Ollama clients for KUROPay intelligence.
// Orchestrator for pattern/classification; Brain for reasoning.
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_HOST
  ? `${process.env.OLLAMA_HOST.replace(/\/$/, '')}/api/chat`
  : 'http://127.0.0.1:11434/api/chat';

// Role → Ollama tag. Swap tags here (one line each) to migrate models
// across every intelligence module. Abliterated variants for KURO stack consistency.
const ORCHESTRATOR = {
  id: 'kuro-pay-orchestrator',
  model: 'huihui_ai/qwen3.5-abliterated:0.8B',
  options: { num_ctx: 4096, temperature: 0.2 },
  timeout_ms: 15_000,
};

const BRAIN = {
  id: 'kuro-pay-brain',
  model: 'huihui_ai/gemma-4-abliterated:e4b',
  options: { num_ctx: 8192, temperature: 0.3 },
  timeout_ms: 60_000,
};

async function chat(cfg, systemPrompt, userContent, extra = {}) {
  const body = {
    model: cfg.model,
    stream: false,
    options: cfg.options,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent) },
    ],
    ...extra,
  };
  const res = await axios.post(OLLAMA_URL, body, { timeout: cfg.timeout_ms });
  return ((res.data && res.data.message && res.data.message.content) || '').trim();
}

function safeParse(raw, fallback) {
  try {
    const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!cleaned) return fallback;
    return JSON.parse(cleaned);
  } catch (_) {
    return fallback;
  }
}

module.exports = { ORCHESTRATOR, BRAIN, chat, safeParse, OLLAMA_URL };
