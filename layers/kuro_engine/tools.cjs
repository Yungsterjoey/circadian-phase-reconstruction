// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — Tool Actions (§12)
// ═══════════════════════════════════════════════════════════════════════════
//
// Each action is a pure async function: (state, args, deps) => { result, ... }
// - `state`  : current SystemState
// - `args`   : plan entry from controller output
// - `deps`   : shared handles { ollama, embedder, judge, synthesizer, webSearch }
//
// Available actions (per spec §12):
//   generate_candidates  — N parallel draft solutions, temperature-varied
//   refine_solution      — single-candidate improvement of x_t
//   evaluate_candidates  — batch scoring via value function
//   expand_node          — generate children for one trajectory branch
//   prune_nodes          — drop low-V branches under budget
//   web_search           — external retrieval (uses layers/web_search.js)
//   update_state         — commit a candidate as the new x_t
//   terminate            — stop the loop (emits reason)
//
// All synthesis/voter/web_search dependencies are INJECTED — the engine can
// run in isolation (unit tests) by providing mocks.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const TOOL_NAMES = [
  'generate_candidates', 'refine_solution', 'evaluate_candidates',
  'expand_node', 'prune_nodes', 'web_search', 'update_state', 'terminate'
];

// Catalog surfaced to the controller prompt
const TOOL_CATALOG = [
  { name: 'generate_candidates',
    description: 'Generate N parallel draft solutions with varied temperature.' },
  { name: 'refine_solution',
    description: 'Improve the current best solution x_t in-place.' },
  { name: 'evaluate_candidates',
    description: 'Score a batch of candidates against v_logic/syntax/efficiency/constraints.' },
  { name: 'expand_node',
    description: 'Expand a tree node by generating children.' },
  { name: 'prune_nodes',
    description: 'Drop low-value branches under the current compute budget.' },
  { name: 'web_search',
    description: 'External search. Args: { query, topK }.' },
  { name: 'update_state',
    description: 'Commit a candidate index as the new x_t.' },
  { name: 'terminate',
    description: 'Terminate the loop. Args: { reason }.' }
];

// ── Helpers ─────────────────────────────────────────────────────────────────
async function embedText(deps, text) {
  if (!deps.embedder) return null;
  try { return await deps.embedder(text); }
  catch { return null; }
}

function sliceSafe(s, n) {
  if (!s) return '';
  return String(s).length > n ? String(s).slice(0, n) + '…' : String(s);
}

// ── generate_candidates ─────────────────────────────────────────────────────
// Uses synthesis_layer if available; else falls back to serial ollama calls.
async function generate_candidates(state, args, deps) {
  const n = Math.max(1, Math.min(args.n || 3, 5));
  const temps = args.temperatures || [0.7, 0.3, 0.5, 0.9, 0.2].slice(0, n);
  const prompt = args.prompt || state.goal;

  if (deps.synthesizer) {
    // synthesize() yields { candidates: [{ raw, temperature, index }] }
    const result = await deps.synthesizer(prompt, {
      candidates: n, temperatures: temps
    });
    return { candidates: (result.candidates || []).filter(c => !c.error) };
  }

  // Fallback: direct ollama calls
  if (!deps.ollama) return { candidates: [] };
  const out = [];
  for (let i = 0; i < n; i++) {
    try {
      const raw = await deps.ollama.chat({
        messages: [{ role: 'user', content: prompt }],
        temperature: temps[i] ?? 0.5
      });
      out.push({ index: i, raw, temperature: temps[i] ?? 0.5 });
    } catch (e) {
      out.push({ index: i, raw: '', error: e.message });
    }
  }
  return { candidates: out.filter(c => !c.error) };
}

// ── refine_solution ─────────────────────────────────────────────────────────
async function refine_solution(state, args, deps) {
  const critique = args.critique || 'Improve clarity, correctness, and efficiency.';
  const prompt = [
    'Refine this solution. Keep what works; fix what doesn\'t.',
    `CURRENT:\n${sliceSafe(state.x, 4000)}`,
    '',
    `CRITIQUE:\n${critique}`,
    '',
    'Emit the refined solution only.'
  ].join('\n');
  if (!deps.ollama) return { refined: null };
  const raw = await deps.ollama.chat({
    messages: [{ role: 'user', content: prompt }],
    temperature: args.temperature ?? 0.3
  });
  return { refined: raw };
}

// ── evaluate_candidates ─────────────────────────────────────────────────────
async function evaluate_candidates(state, args, deps) {
  if (!deps.valueFunction) return { scored: [] };
  const candidates = args.candidates || [];
  const scored = [];
  for (const c of candidates) {
    try {
      const { V, raw, normalised } = await deps.valueFunction.score(
        c.raw || c.x, {
          prompt: state.goal,
          constraints: state.M.constraints,
          format: args.format || 'auto',
          expectedLen: args.expectedLen || 400
        }
      );
      scored.push({ ...c, V, v_raw: raw, v_normalised: normalised });
    } catch (e) {
      scored.push({ ...c, V: 0, error: e.message });
    }
  }
  return { scored };
}

// ── expand_node ─────────────────────────────────────────────────────────────
async function expand_node(state, args, deps) {
  const node = args.node || { x: state.x };
  const children = args.k || 2;
  const temps = [0.5, 0.8, 0.3].slice(0, children);
  const prompt = [
    'Expand this partial solution in the most promising direction.',
    `PARENT:\n${sliceSafe(node.x, 3000)}`,
    '',
    `HINT: ${args.hint || 'explore a different approach or deepen this one'}`
  ].join('\n');
  if (!deps.ollama) return { children: [] };
  const out = [];
  for (let i = 0; i < children; i++) {
    const raw = await deps.ollama.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: temps[i] ?? 0.5
    });
    out.push({ index: i, parent: node, raw, temperature: temps[i] ?? 0.5 });
  }
  return { children: out };
}

// ── prune_nodes ─────────────────────────────────────────────────────────────
// Pure — no LLM. Takes candidates with .V and drops below percentile.
function prune_nodes(state, args) {
  const nodes = args.nodes || [];
  const keepTop = args.keepTop ?? 0.5;    // fraction
  if (!nodes.length) return { kept: [], dropped: [] };
  const sorted = nodes.slice().sort((a, b) => (b.V ?? 0) - (a.V ?? 0));
  const cut = Math.max(1, Math.floor(sorted.length * keepTop));
  return { kept: sorted.slice(0, cut), dropped: sorted.slice(cut) };
}

// ── web_search ──────────────────────────────────────────────────────────────
async function web_search(state, args, deps) {
  if (!deps.webSearch) return { results: [], error: 'web_search not configured' };
  const query = args.query || state.goal;
  try {
    const results = await deps.webSearch(query, args.topK || 5);
    return { query, results };
  } catch (e) {
    return { query, results: [], error: e.message };
  }
}

// ── update_state ────────────────────────────────────────────────────────────
// Promote a candidate to the new x_t. Caller is responsible for follow-up
// value scoring in the engine loop (kept out of this tool to avoid double
// evaluation).
function update_state(state, args) {
  const picked = args.candidate;
  if (!picked) return { updated: false, reason: 'no candidate provided' };
  return { updated: true, x: picked.raw || picked.x, V: picked.V ?? null };
}

// ── terminate ───────────────────────────────────────────────────────────────
function terminate(_state, args) {
  return { terminated: true, reason: args.reason || 'controller requested' };
}

// ── Dispatch ────────────────────────────────────────────────────────────────
const HANDLERS = {
  generate_candidates,
  refine_solution,
  evaluate_candidates,
  expand_node,
  prune_nodes,
  web_search,
  update_state,
  terminate
};

async function dispatch(tool, state, args, deps) {
  if (!HANDLERS[tool]) {
    return { ok: false, error: `unknown tool: ${tool}` };
  }
  try {
    const result = await HANDLERS[tool](state, args || {}, deps);
    return { ok: true, tool, result };
  } catch (e) {
    return { ok: false, tool, error: e.message };
  }
}

module.exports = {
  TOOL_NAMES,
  TOOL_CATALOG,
  HANDLERS,
  dispatch
};
