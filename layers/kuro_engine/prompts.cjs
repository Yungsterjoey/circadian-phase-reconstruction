// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Controller Prompt Format (§7)
// ═══════════════════════════════════════════════════════════════════════════
//
// The controller is instructed to emit structured blocks in this order:
//
//   <STATE>         compressed state summary                      (input-shaped)
//   <REASONING>     Goal / Issue / Strategy                       (weight 1.0)
//   <PLAN>          JSON array of tool calls                      (weight 2.5, 15% masked)
//   <DELTA>         numeric ΔV prediction, e.g. "+0.34"           (weight 2.0)
//   <NEXT_STATE>    JSON outcome prediction incl. confidence      (weight 1.5)
//
// The parser below is liberal on whitespace and tolerates order-drift on the
// back blocks (models sometimes flip DELTA/NEXT_STATE). Missing blocks are
// returned as nulls, not thrown — the caller decides whether to replan.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const BLOCK_TAGS = ['STATE', 'REASONING', 'PLAN', 'DELTA', 'NEXT_STATE'];

// Token weighting table (§8). Used by training/token_weights.py too — keep in sync.
const TOKEN_WEIGHTS = {
  REASONING:  1.0,
  PLAN:       2.5,
  DELTA:      2.0,
  NEXT_STATE: 1.5,
  FILLER:     0.1
};

// ── Prompt builder ──────────────────────────────────────────────────────────
// M_t (structured memory/constraints) and recent z-nearest memories are
// injected as additional context before the user goal.
function buildControllerPrompt({
  goal,
  stateSummary,
  history = [],
  memoryContext = [],   // [{ x, V, similarity }]
  toolCatalog = [],     // [{ name, description, schema }]
  constraints = [],     // [string]
  available_budget = 1.0
}) {
  const memBlock = memoryContext.length
    ? memoryContext.map((m, i) =>
        `  [${i}] V=${m.V.toFixed(2)} sim=${m.similarity.toFixed(2)} :: ${truncate(m.x, 180)}`
      ).join('\n')
    : '  (no prior memory)';

  const toolBlock = toolCatalog.length
    ? toolCatalog.map(t => `  - ${t.name}: ${t.description}`).join('\n')
    : '  (no tools)';

  const constraintsBlock = constraints.length
    ? constraints.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
    : '  (none)';

  const histBlock = history.length
    ? history.slice(-4).map(h =>
        `  t=${h.t}: V=${(h.V ?? 0).toFixed(2)} plan=${JSON.stringify(h.plan || []).slice(0, 120)}`
      ).join('\n')
    : '  (no prior steps)';

  return [
    'You are KURO::CONTROLLER — a search-augmented reasoning system.',
    'You observe the current state, emit structured blocks, and receive feedback on ΔV.',
    '',
    'CURRENT STATE SUMMARY:',
    `  ${stateSummary}`,
    '',
    'RECENT TRAJECTORY:',
    histBlock,
    '',
    'LATENT MEMORY (top-k by cosine similarity to z_t):',
    memBlock,
    '',
    'CONSTRAINTS (M_t):',
    constraintsBlock,
    '',
    'AVAILABLE TOOLS:',
    toolBlock,
    '',
    `COMPUTE BUDGET THIS STEP: ${(available_budget * 100).toFixed(0)}%`,
    '',
    `GOAL: ${goal}`,
    '',
    'You MUST emit EXACTLY these five blocks, in this order, nothing outside them:',
    '<STATE>one-line compressed state summary for next iteration</STATE>',
    '<REASONING>Goal / Issue / Strategy — three short paragraphs max</REASONING>',
    '<PLAN>JSON array of tool calls, e.g. [{"tool":"refine_solution","args":{"x":"..."}}]</PLAN>',
    '<DELTA>numeric prediction of ΔV for this step, e.g. +0.32 or -0.05</DELTA>',
    '<NEXT_STATE>JSON outcome prediction {"v_logic_pred": number, "confidence": 0.6-1.0, "rationale": "..."}</NEXT_STATE>',
    '',
    'DO NOT emit any text outside these blocks.'
  ].join('\n');
}

// ── Parser ──────────────────────────────────────────────────────────────────
// Returns: { state, reasoning, plan, delta_pred, next_state, confidence, raw }
// Any missing block → null / undefined; caller decides whether to replan.
function parseControllerOutput(raw) {
  if (!raw || typeof raw !== 'string') {
    return { state: null, reasoning: null, plan: null, delta_pred: null,
             next_state: null, confidence: null, raw: '', missing: BLOCK_TAGS.slice() };
  }
  const blocks = {};
  const missing = [];
  for (const tag of BLOCK_TAGS) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const m = raw.match(re);
    blocks[tag] = m ? m[1].trim() : null;
    if (!m) missing.push(tag);
  }

  const plan = parsePlan(blocks.PLAN);
  const delta_pred = parseDelta(blocks.DELTA);
  const next_state = parseNextState(blocks.NEXT_STATE);

  return {
    state: blocks.STATE,
    reasoning: blocks.REASONING,
    plan,
    delta_pred,
    next_state,
    confidence: next_state?.confidence ?? null,
    raw,
    missing
  };
}

function parsePlan(s) {
  if (!s) return null;
  // Strip code fences if the model wraps JSON in ```json ... ```
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Last-chance: find the first top-level [...] or {...}
    const match = stripped.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      try {
        const p = JSON.parse(match[0]);
        return Array.isArray(p) ? p : [p];
      } catch { /* fall through */ }
    }
    return null;
  }
}

function parseDelta(s) {
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

function parseNextState(s) {
  if (!s) return null;
  const stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed === 'object' && parsed) {
      // Clamp confidence to [0.6, 1.0] as per spec
      if (typeof parsed.confidence === 'number') {
        parsed.confidence = Math.min(1.0, Math.max(0.6, parsed.confidence));
      }
      return parsed;
    }
  } catch { /* fall through */ }
  return null;
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ');
  return s.length <= n ? s : s.slice(0, n) + '…';
}

module.exports = {
  BLOCK_TAGS,
  TOKEN_WEIGHTS,
  buildControllerPrompt,
  parseControllerOutput,
  parsePlan,
  parseDelta,
  parseNextState
};
