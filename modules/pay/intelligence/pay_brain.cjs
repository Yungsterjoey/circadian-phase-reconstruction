'use strict';

const axios = require('axios');

/* ------------------------------------------------------------------ */
/*  KURO::PAY — Core AI Brain                                         */
/*  All functions return deterministic fallback on parse failure.      */
/* ------------------------------------------------------------------ */

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'huihui_ai/huihui-moe-abliterated:24b-a8b-Q4_K_M';

const PROFILES = {
  instant:   { num_ctx: 4096,  temperature: 0.7 },
  deep:      { num_ctx: 8192,  temperature: 0.5 },
  sovereign: { num_ctx: 16384, temperature: 0.3 },
};

/* ------------------------------------------------------------------ */
/*  Internal helper                                                    */
/* ------------------------------------------------------------------ */

async function callOllama(profile, systemPrompt, userContent) {
  const opts = PROFILES[profile] || PROFILES.instant;
  const body = {
    model: MODEL,
    stream: false,
    options: {
      num_ctx: opts.num_ctx,
      temperature: opts.temperature,
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent) },
    ],
  };

  const res = await axios.post(OLLAMA_URL, body, { timeout: 120_000 });
  const raw = (res.data && res.data.message && res.data.message.content) || '';
  return raw.trim();
}

function safeParse(raw, fallback) {
  try {
    // Strip markdown fences if the model wraps anyway
    let cleaned = raw;
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
  } catch (_) {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  classifyTransaction                                                */
/* ------------------------------------------------------------------ */

const CLASSIFY_SYSTEM = [
  'Financial transaction classifier. JSON only. No markdown.',
  'Schema: { "action": "hold"|"auto_convert_btc"|"auto_convert_xmr"|"flag",',
  '"confidence": 0.0-1.0, "memo": string (max 8 words), "reasoning": string }',
].join(' ');

const CLASSIFY_FALLBACK = {
  action: 'hold',
  confidence: 0.5,
  memo: 'Held for review',
  reasoning: 'AI parse failed',
};

async function classifyTransaction({ amount_aud, description, sender_name }) {
  try {
    const raw = await callOllama('instant', CLASSIFY_SYSTEM, {
      amount_aud,
      description,
      sender_name,
    });
    return safeParse(raw, CLASSIFY_FALLBACK);
  } catch (_) {
    return CLASSIFY_FALLBACK;
  }
}

/* ------------------------------------------------------------------ */
/*  parseNLP                                                           */
/* ------------------------------------------------------------------ */

const NLP_SYSTEM = [
  'Parse financial instruction. JSON only. No markdown.',
  'Schema: { "operation": "send_xmr"|"send_btc"|"convert_to_xmr"|"convert_to_btc"|"convert_forex"|"withdraw_aud"|"check_balance"|"unknown",',
  '"currency_from": string, "currency_to": string, "amount": number|null,',
  '"destination": string|null, "confidence": 0.0-1.0 }',
].join(' ');

const NLP_FALLBACK = {
  operation: 'unknown',
  currency_from: '',
  currency_to: '',
  amount: null,
  destination: null,
  confidence: 0,
};

async function parseNLP(instruction) {
  try {
    const raw = await callOllama('instant', NLP_SYSTEM, instruction);
    return safeParse(raw, NLP_FALLBACK);
  } catch (_) {
    return NLP_FALLBACK;
  }
}

/* ------------------------------------------------------------------ */
/*  generateMemo                                                       */
/* ------------------------------------------------------------------ */

const MEMO_SYSTEM = 'Generate 6 word max human memo for this transaction. JSON only. No markdown. Schema: { "memo": string }';

const MEMO_FALLBACK = { memo: 'Transaction processed' };

async function generateMemo(transaction) {
  try {
    const raw = await callOllama('instant', MEMO_SYSTEM, transaction);
    return safeParse(raw, MEMO_FALLBACK);
  } catch (_) {
    return MEMO_FALLBACK;
  }
}

/* ------------------------------------------------------------------ */
/*  generateInsight                                                    */
/* ------------------------------------------------------------------ */

const INSIGHT_SYSTEM = [
  'KURO sovereign financial intelligence. JSON only. No markdown.',
  'Schema: { "market_context": string (2-3 sentences),',
  '"signals": [{ "asset": string, "signal": "accumulate"|"hold"|"reduce"|"watch",',
  '"reasoning": string, "confidence": 0.0-1.0, "timeframe": string }],',
  '"risk_note": string, "awareness_note": string|null }',
].join(' ');

const INSIGHT_FALLBACK = {
  market_context: 'Market data unavailable. Holding position.',
  signals: [],
  risk_note: 'Unable to generate insight — using fallback.',
  awareness_note: null,
};

async function generateInsight(context) {
  try {
    const raw = await callOllama('deep', INSIGHT_SYSTEM, context);
    return safeParse(raw, INSIGHT_FALLBACK);
  } catch (_) {
    return INSIGHT_FALLBACK;
  }
}

/* ------------------------------------------------------------------ */
/*  generateOracle                                                     */
/* ------------------------------------------------------------------ */

const ORACLE_SYSTEM = [
  'Sovereign financial oracle. JSON only. No markdown.',
  'Schema: { "analysis": string,',
  '"recommendations": [{ "asset": string, "signal": string,',
  '"reasoning": string, "confidence": 0.0-1.0, "timeframe": string }],',
  '"macro_note": string,',
  '"disclaimer": "Signals only. Not financial advice." }',
].join(' ');

const ORACLE_FALLBACK = {
  analysis: 'Oracle unavailable — fallback active.',
  recommendations: [],
  macro_note: 'Insufficient data for macro analysis.',
  disclaimer: 'Signals only. Not financial advice.',
};

async function generateOracle(context) {
  try {
    const raw = await callOllama('sovereign', ORACLE_SYSTEM, context);
    return safeParse(raw, ORACLE_FALLBACK);
  } catch (_) {
    return ORACLE_FALLBACK;
  }
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  classifyTransaction,
  parseNLP,
  generateMemo,
  generateInsight,
  generateOracle,
  // Exposed for testing
  _callOllama: callOllama,
  _safeParse: safeParse,
};
