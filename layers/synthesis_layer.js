/**
 * KURO::SYNTHESIS v1.0 — The Merge Protocol
 * 
 * Transforms the voter_layer from binary (Pass/Fail) to a synthesizer.
 * Generates N candidate solutions with varied temperature,
 * judges all candidates, then merges the best parts into a final output.
 * 
 * Architecture:
 *   1. MULTIVERSE — Generate 3 candidates (varied temperature + seed)
 *   2. CRITIQUE   — Judge all 3 with kuro-logic (scoring + strengths/weaknesses)
 *   3. COLLAPSE   — If 1 clear winner (>8.5), use it. Otherwise, merge.
 *   4. VERIFY     — Final merge goes through standard voter_layer judge pass
 * 
 * GPU behavior on single L4:
 *   - 3 concurrent Ollama requests serialize on GPU (single inference at a time)
 *   - Total wall time ≈ 3× single generation (not parallel on single GPU)
 *   - But varied temperature/seed produces genuinely divergent solutions
 *   - Judge pass uses kuro-logic (14B) — swaps in after forge (14B) finishes
 * 
 * Tier gate: Sovereign only (3× GPU time per request)
 * 
 * v7.0.2a — Extracted from Gemini "Nuclear Fusion" analysis, red-teamed by Opus 4.6
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const SYNTHESIS_CONFIG = {
  candidates: 3,              // Number of parallel candidates
  temperatures: [0.7, 0.3, 0.5],  // Creative, Conservative, Balanced
  passThreshold: 8.5,         // Score out of 10 — above this, skip merge
  mergeModel: null,           // Set at runtime (kuro-core or kuro-forge)
  judgeModel: null,           // Set at runtime (kuro-logic or kuro-scout)
  actorModel: null,           // Set at runtime (kuro-forge)
  actorCtx: 32768,
  judgeCtx: 16384,
  mergeCtx: 32768,
  enabled: true
};

// ═══════════════════════════════════════════════════════════════════════════
// JUDGE PROMPT — Scores + identifies strengths per candidate
// ═══════════════════════════════════════════════════════════════════════════

const SYNTHESIS_JUDGE_PROMPT = `You are KURO::JUDGE in Synthesis mode.

You are evaluating multiple candidate solutions for the same task. 
Score each candidate and identify what each does BEST.

OUTPUT FORMAT (respond with ONLY this JSON, no other text):
{
  "candidates": [
    {
      "index": 0,
      "score": 0.0-10.0,
      "strengths": ["what this candidate does best"],
      "weaknesses": ["what this candidate gets wrong"],
      "bestSection": "which part of this candidate is worth keeping"
    }
  ],
  "recommendation": "USE_BEST" | "MERGE",
  "mergeStrategy": "if MERGE, describe which parts from which candidates to combine"
}`;

// ═══════════════════════════════════════════════════════════════════════════
// MERGE PROMPT — Combines best parts of N candidates
// ═══════════════════════════════════════════════════════════════════════════

function buildMergePrompt(userPrompt, candidates, critiques) {
  let prompt = `TASK: Write the optimal solution for the following request.

USER REQUEST:
${userPrompt}

You have ${candidates.length} draft solutions. None are individually perfect.
Combine the best elements from each into a single, superior solution.

`;

  for (let i = 0; i < candidates.length; i++) {
    const c = critiques.candidates?.[i] || {};
    prompt += `═══ DRAFT ${String.fromCharCode(65 + i)} (Score: ${c.score || '?'}/10) ═══
Strengths: ${(c.strengths || []).join(', ') || 'unknown'}
Weaknesses: ${(c.weaknesses || []).join(', ') || 'unknown'}
Best section: ${c.bestSection || 'unknown'}

${candidates[i].raw}

`;
  }

  if (critiques.mergeStrategy) {
    prompt += `MERGE STRATEGY (from Judge):
${critiques.mergeStrategy}

`;
  }

  prompt += `INSTRUCTIONS:
- Combine the strongest elements from each draft
- Fix weaknesses identified by the Judge
- Produce complete, working code — no placeholders
- Use <file path="..." action="create|modify"> tags for file changes
- Use <terminal>$ command</terminal> for commands
- Output ONLY the final merged solution, no commentary about the drafts`;

  return prompt;
}

// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA HELPER
// ═══════════════════════════════════════════════════════════════════════════

async function ollamaChat(model, messages, options = {}) {
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.3,
      num_ctx: options.ctx || 16384,
      seed: options.seed || undefined
    }
  }, { timeout: 300000 }); // 5 min timeout for large generations

  return data.message?.content || '';
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: MULTIVERSE — Generate N candidates
// ═══════════════════════════════════════════════════════════════════════════

async function generateCandidates(userPrompt, context, actorSystem, config) {
  const model = config.actorModel || 'kuro-forge';
  const n = config.candidates || 3;
  const temps = config.temperatures || [0.7, 0.3, 0.5];

  const requests = Array.from({ length: n }, (_, i) => {
    const messages = [
      { role: 'system', content: actorSystem },
      ...context,
      { role: 'user', content: userPrompt }
    ];

    return ollamaChat(model, messages, {
      temperature: temps[i % temps.length],
      seed: Date.now() + (i * 1000),
      ctx: config.actorCtx || 32768
    }).then(raw => ({ index: i, raw, temperature: temps[i % temps.length] }))
      .catch(err => ({ index: i, raw: `[ERROR: ${err.message}]`, error: true }));
  });

  // These serialize on single GPU, but Promise.all keeps the queue fed
  return Promise.all(requests);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: CRITIQUE — Judge all candidates
// ═══════════════════════════════════════════════════════════════════════════

async function critiqueCandidates(userPrompt, candidates, config) {
  const model = config.judgeModel || 'kuro-logic';

  let evalContent = `USER REQUEST:\n${userPrompt}\n\n`;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].error) continue;
    evalContent += `═══ CANDIDATE ${String.fromCharCode(65 + i)} (temp=${candidates[i].temperature}) ═══\n`;
    evalContent += candidates[i].raw.slice(0, 6000) + '\n\n'; // Cap per candidate
  }

  const response = await ollamaChat(model, [
    { role: 'system', content: SYNTHESIS_JUDGE_PROMPT },
    { role: 'user', content: evalContent }
  ], { temperature: 0.1, ctx: config.judgeCtx || 16384 });

  // Parse JSON
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) { /* fall through */ }

  // Fallback: pick first non-error candidate
  return {
    candidates: candidates.map((c, i) => ({
      index: i, score: c.error ? 0 : 5, strengths: [], weaknesses: [], bestSection: ''
    })),
    recommendation: 'USE_BEST',
    mergeStrategy: null
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: COLLAPSE — Use best or merge
// ═══════════════════════════════════════════════════════════════════════════

async function collapse(userPrompt, candidates, critiques, config) {
  const validCandidates = (critiques.candidates || []).filter(c => c.score > 0);
  if (validCandidates.length === 0) {
    // All failed — return first non-error candidate raw
    const fallback = candidates.find(c => !c.error);
    return { strategy: 'FALLBACK', result: fallback?.raw || '[All candidates failed]', merged: false };
  }

  // Sort by score descending
  const sorted = [...validCandidates].sort((a, b) => b.score - a.score);
  const best = sorted[0];

  // Path A: Clear winner — use it directly
  if (best.score >= (config.passThreshold || 8.5)) {
    return {
      strategy: 'USE_BEST',
      result: candidates[best.index].raw,
      merged: false,
      bestIndex: best.index,
      bestScore: best.score
    };
  }

  // Path B: No clear winner — merge
  if (critiques.recommendation === 'MERGE' || sorted.length >= 2) {
    const mergePrompt = buildMergePrompt(userPrompt, candidates, critiques);
    const model = config.mergeModel || config.actorModel || 'kuro-core';

    const merged = await ollamaChat(model, [
      { role: 'system', content: 'You are KURO::CORE performing a synthesis merge. Combine the best elements of multiple draft solutions into a single optimal output.' },
      { role: 'user', content: mergePrompt }
    ], { temperature: 0.2, ctx: config.mergeCtx || 32768 });

    return {
      strategy: 'MERGE',
      result: merged,
      merged: true,
      scores: sorted.map(s => ({ index: s.index, score: s.score })),
      mergeStrategy: critiques.mergeStrategy
    };
  }

  // Path C: Only 1 valid candidate — use it
  return {
    strategy: 'SINGLE',
    result: candidates[best.index].raw,
    merged: false,
    bestIndex: best.index,
    bestScore: best.score
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY: synthesize()
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full synthesis pipeline.
 * @param {string} userPrompt — The user's request
 * @param {Array} context — Conversation history messages
 * @param {string} actorSystem — System prompt for actor
 * @param {object} config — Override SYNTHESIS_CONFIG
 * @param {function} onPhase — SSE callback: (phase, status, data) => void
 * @returns {object} { result, strategy, candidates, critiques, attempts, timing }
 */
async function synthesize(userPrompt, context = [], actorSystem = '', config = {}, onPhase = null) {
  const cfg = { ...SYNTHESIS_CONFIG, ...config };
  const t0 = Date.now();
  const emit = (phase, status, data) => onPhase?.(phase, status, data);

  // Phase 1: Multiverse
  emit('synthesis_generate', 'active', { candidates: cfg.candidates, temperatures: cfg.temperatures });
  const candidates = await generateCandidates(userPrompt, context, actorSystem, cfg);
  const validCount = candidates.filter(c => !c.error).length;
  emit('synthesis_generate', 'complete', { generated: validCount, errors: candidates.length - validCount });

  // Short-circuit: if only 1 valid candidate, skip critique/merge
  if (validCount <= 1) {
    const single = candidates.find(c => !c.error);
    emit('synthesis_collapse', 'complete', { strategy: 'SINGLE_VALID', merged: false });
    return {
      result: single?.raw || '[All candidates failed]',
      strategy: 'SINGLE_VALID',
      merged: false,
      candidates,
      critiques: null,
      timing: Date.now() - t0
    };
  }

  // Phase 2: Critique
  emit('synthesis_critique', 'active', { judge: cfg.judgeModel, candidates: validCount });
  const critiques = await critiqueCandidates(userPrompt, candidates, cfg);
  emit('synthesis_critique', 'complete', {
    scores: (critiques.candidates || []).map(c => c.score),
    recommendation: critiques.recommendation
  });

  // Phase 3: Collapse
  emit('synthesis_collapse', 'active', { recommendation: critiques.recommendation });
  const collapsed = await collapse(userPrompt, candidates, critiques, cfg);
  emit('synthesis_collapse', 'complete', {
    strategy: collapsed.strategy,
    merged: collapsed.merged,
    bestScore: collapsed.bestScore
  });

  return {
    result: collapsed.result,
    strategy: collapsed.strategy,
    merged: collapsed.merged,
    candidates,
    critiques,
    scores: collapsed.scores,
    timing: Date.now() - t0
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAM-COMPATIBLE WRAPPER (for SSE integration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Async generator for SSE streaming.
 * Yields phase events, then returns final result.
 */
async function* synthesizeStream(userPrompt, context, actorSystem, config) {
  const cfg = { ...SYNTHESIS_CONFIG, ...config };
  const t0 = Date.now();

  yield { type: 'synthesis', phase: 'start', candidates: cfg.candidates };

  // Phase 1
  yield { type: 'synthesis', phase: 'generate', status: 'active' };
  const candidates = await generateCandidates(userPrompt, context, actorSystem, cfg);
  const validCount = candidates.filter(c => !c.error).length;
  yield { type: 'synthesis', phase: 'generate', status: 'complete', valid: validCount };

  if (validCount <= 1) {
    const single = candidates.find(c => !c.error);
    yield { type: 'synthesis', phase: 'complete', strategy: 'SINGLE_VALID', timing: Date.now() - t0 };
    return { result: single?.raw || '[All candidates failed]', strategy: 'SINGLE_VALID' };
  }

  // Phase 2
  yield { type: 'synthesis', phase: 'critique', status: 'active' };
  const critiques = await critiqueCandidates(userPrompt, candidates, cfg);
  yield { type: 'synthesis', phase: 'critique', status: 'complete', scores: (critiques.candidates || []).map(c => c.score) };

  // Phase 3
  yield { type: 'synthesis', phase: 'collapse', status: 'active', recommendation: critiques.recommendation };
  const collapsed = await collapse(userPrompt, candidates, critiques, cfg);
  yield { type: 'synthesis', phase: 'collapse', status: 'complete', strategy: collapsed.strategy, merged: collapsed.merged };

  yield { type: 'synthesis', phase: 'complete', strategy: collapsed.strategy, timing: Date.now() - t0 };
  return { result: collapsed.result, strategy: collapsed.strategy, merged: collapsed.merged, candidates, critiques };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  synthesize,
  synthesizeStream,
  generateCandidates,
  critiqueCandidates,
  collapse,
  buildMergePrompt,
  SYNTHESIS_CONFIG,
  SYNTHESIS_JUDGE_PROMPT
};
