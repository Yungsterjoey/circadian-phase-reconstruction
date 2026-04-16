'use strict';
// §4.4 — NL search parser. Debounced upstream; fast path must stay <500ms.
const { ORCHESTRATOR, chat, safeParse } = require('./models.cjs');
const { wrap, isInjectionEcho } = require('./prompt_safety.cjs');

const SYSTEM = [
  'Extract a search filter from a user query about their payment history.',
  'JSON only. Schema: {"date_from":"YYYY-MM-DD"|null,"date_to":"YYYY-MM-DD"|null,"merchant_category":string[],"keywords":string[]}.',
  'Resolve relative dates ("last month", "yesterday") using today = {{TODAY}}.',
].join(' ');

let _clock = () => new Date();
let _modelFn = async (system, user) => chat(ORCHESTRATOR, system, user);

function keywordFallback(q) {
  return {
    date_from: null,
    date_to: null,
    merchant_category: [],
    keywords: q.toLowerCase().split(/\s+/).filter(Boolean),
    fallback: true,
  };
}

async function parse(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return { date_from: null, date_to: null, merchant_category: [], keywords: [], fallback: false };
  }
  const today = _clock().toISOString().slice(0, 10);
  try {
    const raw = await _modelFn(SYSTEM.replace('{{TODAY}}', today), wrap(trimmed));
    if (isInjectionEcho(raw)) return keywordFallback(trimmed);
    const parsed = safeParse(raw, null);
    if (!parsed) return keywordFallback(trimmed);
    return {
      date_from: parsed.date_from || null,
      date_to: parsed.date_to || null,
      merchant_category: Array.isArray(parsed.merchant_category) ? parsed.merchant_category : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      fallback: false,
    };
  } catch (_) {
    return keywordFallback(trimmed);
  }
}

module.exports = {
  parse,
  _setModelForTest: fn => { _modelFn = fn; },
  _setClock: fn => { _clock = fn; },
};
