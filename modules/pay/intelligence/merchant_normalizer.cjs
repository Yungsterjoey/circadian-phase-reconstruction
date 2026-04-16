'use strict';
// §4.1 — Clean up cryptic VietQR merchant names. Async after settlement.
// Low confidence or error → raw name, never blocks display.
const ledger = require('../core/ledger.cjs');
const { ORCHESTRATOR, chat, safeParse } = require('./models.cjs');
const { wrap, isInjectionEcho } = require('./prompt_safety.cjs');
const iq = require('../core/intelligence_queue.cjs');
const worker = require('./worker.cjs');

const SYSTEM = [
  'You clean cryptic Vietnamese business registration names into short readable display names.',
  'JSON only, no markdown. Schema: {"displayName":string,"category":string,"confidence":0.0-1.0}.',
  'Categories: convenience_store, cafe, restaurant, grocery, pharmacy, transport, service, other.',
  'Examples:',
  '  CTY TNHH LOVE VIETNAM 30 -> {"displayName":"Love Vietnam 30","category":"convenience_store","confidence":0.85}',
  '  CONG TY PHO 24 QUAN 1    -> {"displayName":"Pho 24","category":"restaurant","confidence":0.9}',
  '  HKD NGUYEN VAN A         -> {"displayName":"Nguyen Van A","category":"service","confidence":0.7}',
].join('\n');

const FALLBACK = { displayName: null, category: 'other', confidence: 0 };
const MIN_CONFIDENCE = 0.5;

let _modelFn = async (system, user) => chat(ORCHESTRATOR, system, user);

async function normalize({ merchant_account_number, raw_name }) {
  const db = ledger._db();
  const cached = db.prepare(
    'SELECT display_name, category, confidence FROM merchant_cache WHERE merchant_account_number=?'
  ).get(merchant_account_number);
  if (cached) {
    return { displayName: cached.display_name, category: cached.category, confidence: cached.confidence };
  }

  let parsed = FALLBACK;
  try {
    const raw = await _modelFn(SYSTEM, wrap(raw_name));
    if (isInjectionEcho(raw)) parsed = FALLBACK;
    else parsed = safeParse(raw, FALLBACK);
  } catch (_) {
    parsed = FALLBACK;
  }

  const accept = parsed.displayName && parsed.confidence >= MIN_CONFIDENCE;
  const finalDisplay = accept ? parsed.displayName : raw_name;
  const finalCategory = accept ? parsed.category : 'other';
  const finalConfidence = accept ? parsed.confidence : 0;

  db.prepare(
    `INSERT OR REPLACE INTO merchant_cache
       (merchant_account_number, display_name, category, confidence, raw_name, normalized_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(merchant_account_number, finalDisplay, finalCategory, finalConfidence, raw_name);

  return { displayName: finalDisplay, category: finalCategory, confidence: finalConfidence };
}

function enqueueIfNew({ merchant_account_number, raw_name }) {
  const db = ledger._db();
  const row = db.prepare(
    'SELECT 1 FROM merchant_cache WHERE merchant_account_number=?'
  ).get(merchant_account_number);
  if (row) return null;
  return iq.enqueue('merchant_normalize', { merchant_account_number, raw_name });
}

worker.register('merchant_normalize', async (payload) => { await normalize(payload); });

module.exports = {
  normalize,
  enqueueIfNew,
  _setModelForTest: fn => { _modelFn = fn; },
};
