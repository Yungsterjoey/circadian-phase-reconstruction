#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — unit tests for the pure modules
// ═══════════════════════════════════════════════════════════════════════════
//
//   node layers/kuro_engine/tests/unit.cjs
//
// Exits 0 if all pass, 1 if any fail. Deliberately no framework — this
// directory stays dependency-free. Each test is a named, numbered invariant.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const assert = require('assert');

const { RunningStats, clip, EPS } = require('../running_stats.cjs');
const { ValueFunction, gradeSyntax, gradeEfficiency, gradeConstraints } = require('../value_function.cjs');
const advantage = require('../advantage.cjs');
const { LatentState, softmax, cosine, weightedMean } = require('../latent_state.cjs');
const { parseControllerOutput, buildControllerPrompt } = require('../prompts.cjs');
const { SearchBudget, weightedTopK, weightedArgmaxSoft } = require('../search.cjs');
const { xorshift32, maskedPlanForLogging, HealthMonitor } = require('../safeguards.cjs');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// ── running_stats ───────────────────────────────────────────────────────────
test('RunningStats Welford μ/σ match closed-form', () => {
  const s = new RunningStats();
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const x of xs) s.update(x);
  assert.strictEqual(s.n, 10);
  assert(Math.abs(s.mean - 5.5) < 1e-9, `mean=${s.mean}`);
  // Sample variance of 1..10 = 9.1666…
  assert(Math.abs(s.variance - 9.166666666) < 1e-6, `variance=${s.variance}`);
});

test('RunningStats normalize is stable on a constant stream', () => {
  const s = new RunningStats();
  for (let i = 0; i < 20; i++) s.update(7);
  // std ≈ 0 → normalize should be 0, not Infinity
  const n = s.normalize(7);
  assert(Number.isFinite(n), `normalize returned ${n}`);
});

test('RunningStats windowed recompute drops stale values', () => {
  const s = new RunningStats({ window: 4 });
  for (const v of [100, 100, 100, 100]) s.update(v);
  for (const v of [0, 0, 0, 0]) s.update(v);   // ring now [0,0,0,0]
  s.recomputeFromWindow();
  assert(Math.abs(s.mean) < 1e-6, `recomputed mean=${s.mean}`);
});

test('clip bounds work on both sides', () => {
  assert.strictEqual(clip(10, -1, 1), 1);
  assert.strictEqual(clip(-10, -1, 1), -1);
  assert.strictEqual(clip(0.5, -1, 1), 0.5);
});

// ── advantage pipeline ──────────────────────────────────────────────────────
test('advantage.stageA tanh-squashes and stays in (-1, 1)', () => {
  const stats = new RunningStats();
  stats.update(0); stats.update(0.1); stats.update(-0.1);
  const a = advantage.stageA_delta(0, 5, stats);  // huge jump
  assert(a < 1 && a > 0, `stageA out=${a}`);
});

test('advantage.stageB applies γ to next-step delta', () => {
  const gamma = 0.5;
  const deltas = [0.2, 0.4, -0.1];
  const A = advantage.stageB_shortHorizon(deltas, gamma);
  assert(Math.abs(A[0] - (0.2 + 0.5 * 0.4)) < 1e-9);
  assert(Math.abs(A[1] - (0.4 + 0.5 * -0.1)) < 1e-9);
  assert(Math.abs(A[2] - (-0.1 + 0)) < 1e-9); // terminal
});

test('advantage.stageC batch-normalises to ~zero mean', () => {
  const A = [1, 2, 3, 4, 5];
  const out = advantage.stageC_batchNorm(A);
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  assert(Math.abs(mean) < 1e-6, `mean after BN=${mean}`);
});

test('advantage.stageD rescales max|A| → 1', () => {
  const out = advantage.stageD_dynamicRescale([0.5, -1.2, 0.3]);
  const maxAbs = out.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  // EPS in denominator makes this asymptotically but not exactly 1
  assert(Math.abs(maxAbs - 1) < 1e-5, `maxAbs=${maxAbs}`);
});

test('advantage.stageE keeps big |A|, keeps quiet metric wins, drops flat', () => {
  const sampleStrong = { v_raw: { a: 0.5 }, v_next_raw: { a: 0.5 } };
  const sampleQuiet  = { v_raw: { a: 0.5 }, v_next_raw: { a: 0.7 } };  // ΔV=0, but metric improved
  const sampleFlat   = { v_raw: { a: 0.5 }, v_next_raw: { a: 0.5 } };

  assert(advantage.stageE_pareto(sampleStrong, 0.5), 'strong should keep');
  assert(advantage.stageE_pareto(sampleQuiet, 0.0), 'quiet metric improve should keep');
  assert(!advantage.stageE_pareto(sampleFlat, 0.0), 'flat should drop');
});

test('advantage.stageF drops miscalibrated, keeps calibrated', () => {
  assert(advantage.stageF_calibrationGate({ delta_pred: 0.1, delta_actual: 0.12 }));
  assert(!advantage.stageF_calibrationGate({ delta_pred: 0.1, delta_actual: 0.9 }));
});

test('advantage.stageG weights are strictly positive (softplus)', () => {
  const w = advantage.stageG_weight([0, 1, -1, 2], [0.8, 0.9, 0.6, 1.0]);
  for (const wi of w) assert(wi > 0, `non-positive weight ${wi}`);
});

test('advantage.runPipeline end-to-end on toy trajectory', () => {
  const traj = [
    { V: 0,   V_next: 0.3, v_raw: { a: 0.2 }, v_next_raw: { a: 0.5 }, delta_pred: 0.30, delta_actual: 0.30, confidence: 0.9 },
    { V: 0.3, V_next: 0.6, v_raw: { a: 0.5 }, v_next_raw: { a: 0.7 }, delta_pred: 0.30, delta_actual: 0.30, confidence: 0.85 },
    { V: 0.6, V_next: 0.6, v_raw: { a: 0.7 }, v_next_raw: { a: 0.7 }, delta_pred: 0.00, delta_actual: 0.00, confidence: 0.7 }
  ];
  const stats = new RunningStats();
  const out = advantage.runPipeline(traj, stats);
  assert(Array.isArray(out.samples));
  assert(out.kept <= 3 && out.kept >= 1, `kept=${out.kept}`);
  assert(out.weights.length === out.samples.length);
  assert(Number.isFinite(out.stats.delta_sigma));
});

// ── value function ──────────────────────────────────────────────────────────
test('gradeSyntax scores valid JSON higher than garbage', () => {
  const good = gradeSyntax('{"a": 1}', { format: 'json' });
  const bad  = gradeSyntax('{a: 1', { format: 'json' });
  assert(good > bad, `good=${good} bad=${bad}`);
});

test('gradeSyntax penalises repetition loops', () => {
  const spam = Array(200).fill('yes').join(' ');
  assert(gradeSyntax(spam) <= 0.3, `spam score=${gradeSyntax(spam)}`);
});

test('gradeEfficiency rewards shorter-within-budget output', () => {
  const brief = gradeEfficiency('a'.repeat(200), { expectedLen: 400 });
  const bloat = gradeEfficiency('a'.repeat(2000), { expectedLen: 400 });
  assert(brief > bloat, `brief=${brief} bloat=${bloat}`);
});

test('gradeConstraints honours weights', () => {
  const cons = [
    { check: o => o.includes('foo'), weight: 3 },
    { check: o => o.includes('bar'), weight: 1 }
  ];
  assert.strictEqual(gradeConstraints('foo', cons), 0.75);     // 3/4
  assert.strictEqual(gradeConstraints('bar', cons), 0.25);     // 1/4
  assert.strictEqual(gradeConstraints('foo bar', cons), 1.0);
});

test('ValueFunction.evaluate clips to [-3,3]', async () => {
  const vf = new ValueFunction();
  // Force huge raw values
  for (let i = 0; i < 5; i++) {
    vf.evaluate({ v_logic: 10, v_syntax: 1, v_efficiency: 1, v_constraints: 1 });
  }
  const r = vf.evaluate({ v_logic: 10, v_syntax: 1, v_efficiency: 1, v_constraints: 1 });
  assert(r.V >= -3 && r.V <= 3, `V=${r.V}`);
});

// ── latent state ────────────────────────────────────────────────────────────
test('softmax sums to 1 and is monotone in input', () => {
  const p = softmax([1, 2, 3]);
  const sum = p.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-6, `sum=${sum}`);
  assert(p[0] < p[1] && p[1] < p[2]);
});

test('cosine is 1 for identical vectors, ~0 for orthogonal', () => {
  assert(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-6);
  assert(Math.abs(cosine([1, 0], [0, 1])) < 1e-6);
});

test('LatentState.step shifts z toward higher-V candidates', () => {
  const ls = new LatentState({ alpha: 0.5 });
  ls.step([
    { embedding: [1, 0, 0], V: 0.1, x: 'lo' },
    { embedding: [0, 1, 0], V: 5.0, x: 'hi' }
  ]);
  // After one update, z should lean toward [0,1,0]
  assert(ls.z[1] > ls.z[0], `z=${ls.z}`);
});

test('LatentState periodic reset snaps to best embedding', () => {
  const ls = new LatentState({ alpha: 0.5, resetEvery: 3 });
  ls.step([{ embedding: [1, 0, 0], V: 9, x: 'best' }]);
  ls.step([{ embedding: [0, 1, 0], V: 1, x: 'meh' }]);
  ls.step([{ embedding: [0, 0, 1], V: 1, x: 'meh' }]); // triggers reset on update 3
  assert(ls.z[0] === 1 && ls.z[1] === 0 && ls.z[2] === 0,
    `after reset, z=${ls.z}`);
});

// ── prompts parser ──────────────────────────────────────────────────────────
test('parseControllerOutput extracts all five blocks', () => {
  const raw = [
    '<STATE>s1</STATE>',
    '<REASONING>r1</REASONING>',
    '<PLAN>[{"tool":"refine_solution","args":{}}]</PLAN>',
    '<DELTA>+0.25</DELTA>',
    '<NEXT_STATE>{"confidence":0.8}</NEXT_STATE>'
  ].join('\n');
  const p = parseControllerOutput(raw);
  assert.strictEqual(p.state, 's1');
  assert.strictEqual(p.reasoning, 'r1');
  assert(Array.isArray(p.plan) && p.plan[0].tool === 'refine_solution');
  assert.strictEqual(p.delta_pred, 0.25);
  assert.strictEqual(p.confidence, 0.8);
});

test('parseControllerOutput clamps confidence to [0.6,1.0]', () => {
  const p = parseControllerOutput(
    '<STATE>x</STATE><REASONING>r</REASONING>' +
    '<PLAN>[]</PLAN><DELTA>0</DELTA>' +
    '<NEXT_STATE>{"confidence":0.1}</NEXT_STATE>'
  );
  assert.strictEqual(p.confidence, 0.6);
});

test('parseControllerOutput reports missing blocks', () => {
  const p = parseControllerOutput('<STATE>s</STATE>only state');
  assert(p.missing.includes('PLAN'));
  assert(p.missing.includes('DELTA'));
});

test('parseControllerOutput handles code-fenced PLAN', () => {
  const raw =
    '<STATE>s</STATE><REASONING>r</REASONING>' +
    '<PLAN>```json\n[{"tool":"terminate","args":{}}]\n```</PLAN>' +
    '<DELTA>0</DELTA><NEXT_STATE>{}</NEXT_STATE>';
  const p = parseControllerOutput(raw);
  assert(Array.isArray(p.plan), `plan=${JSON.stringify(p.plan)}`);
  assert.strictEqual(p.plan[0].tool, 'terminate');
});

test('buildControllerPrompt mentions all required block tags', () => {
  const s = buildControllerPrompt({
    goal: 'test goal',
    stateSummary: 'summary',
    toolCatalog: [{ name: 'terminate', description: 'stop' }]
  });
  for (const tag of ['STATE', 'REASONING', 'PLAN', 'DELTA', 'NEXT_STATE']) {
    assert(s.includes(`<${tag}>`), `prompt missing <${tag}>`);
  }
});

// ── search ──────────────────────────────────────────────────────────────────
test('SearchBudget enforces node and depth caps', () => {
  const b = new SearchBudget({ maxNodes: 5, maxDepth: 2 });
  assert(b.canExpand(1));
  b.record(1, 5);
  assert(!b.canExpand(1), 'should block after budget exhausted');
  const b2 = new SearchBudget({ maxNodes: 99, maxDepth: 2 });
  assert(b2.canExpand(2));
  assert(!b2.canExpand(3));
});

test('weightedTopK preserves descending V order and weights sum to 1', () => {
  const out = weightedTopK([{V: 1}, {V: 3}, {V: 2}], 3, 1.0);
  assert(out[0].V >= out[1].V && out[1].V >= out[2].V);
  const wsum = out.reduce((a, b) => a + b.weight, 0);
  assert(Math.abs(wsum - 1) < 1e-6, `wsum=${wsum}`);
});

test('weightedArgmaxSoft picks the highest V', () => {
  const out = weightedArgmaxSoft([{V: 0.5, k:'a'}, {V: 2.0, k:'b'}, {V: 1.1, k:'c'}]);
  assert.strictEqual(out.k, 'b');
});

// ── safeguards ──────────────────────────────────────────────────────────────
test('xorshift32 is deterministic per seed', () => {
  const a = xorshift32(42);
  const b = xorshift32(42);
  for (let i = 0; i < 5; i++) assert.strictEqual(a(), b());
});

test('maskedPlanForLogging returns same-length list with some MASKED', () => {
  const plan = Array(20).fill(0).map((_, i) => ({ tool: 't', args: { k: `v${i}`, j: i } }));
  const masked = maskedPlanForLogging(plan, { seed: 1, dropProb: 0.5 });
  assert.strictEqual(masked.length, plan.length);
  const maskedCount = masked.reduce((acc, e) =>
    acc + Object.values(e.args).filter(v => v === '<MASKED>').length, 0);
  assert(maskedCount > 0, 'expected some args masked with dropProb=0.5');
});

test('HealthMonitor flags advantage collapse', () => {
  const hm = new HealthMonitor({ window: 64 });
  for (let i = 0; i < 40; i++) hm.observe({ advantages: [0.0001 * i % 0.01] });
  const alerts = hm.assess();
  assert(alerts.some(a => a.kind === 'advantage_collapse'), JSON.stringify(alerts));
});

test('HealthMonitor flags runaway variance', () => {
  const hm = new HealthMonitor({ window: 64 });
  for (let i = 0; i < 40; i++) hm.observe({ advantages: [Math.sin(i) * 5] });
  const alerts = hm.assess();
  assert(alerts.some(a => a.kind === 'advantage_runaway'), JSON.stringify(alerts));
});

// ── Report ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${r.name}${r.err ? ' — ' + r.err : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
