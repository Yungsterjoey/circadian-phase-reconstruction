#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// KURO::ENGINE — smoke test
// ═══════════════════════════════════════════════════════════════════════════
// Spins up the Engine with mocked ollama/embedder/judge/synthesizer and runs
// a toy goal end-to-end. Exits non-zero on any thrown error or missing
// invariant.
//
//   node scripts/kuro_engine_smoke.cjs
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Point trajectory logger at a tmp dir so we don't pollute /var/lib/kuro
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuro-smoke-'));
process.env.KURO_DATA = tmp;

const { Engine } = require('../layers/kuro_engine');

// ── Mocks ───────────────────────────────────────────────────────────────────
// The "controller" responds with a script: first call emits a PLAN that calls
// refine_solution, second call terminates. This exercises parse → dispatch →
// value → latent → log in one go.
let controllerCalls = 0;
const controllerScript = [
  [
    '<STATE>fresh task</STATE>',
    '<REASONING>Goal is to write a haiku. Strategy: draft then refine.</REASONING>',
    '<PLAN>[{"tool":"refine_solution","args":{"critique":"compress imagery"}}]</PLAN>',
    '<DELTA>+0.40</DELTA>',
    '<NEXT_STATE>{"confidence":0.85,"rationale":"clearer imagery"}</NEXT_STATE>'
  ].join('\n'),
  [
    '<STATE>solution converging</STATE>',
    '<REASONING>Output is acceptable. Terminate.</REASONING>',
    '<PLAN>[{"tool":"terminate","args":{"reason":"satisfied"}}]</PLAN>',
    '<DELTA>0.0</DELTA>',
    '<NEXT_STATE>{"confidence":0.9}</NEXT_STATE>'
  ].join('\n')
];

const mockOllama = {
  async chat({ messages }) {
    const prompt = messages[0].content;
    // The controller-shaped prompt is long; refine_solution's prompt is short
    // and starts with "Refine this solution.". Route accordingly.
    if (prompt.startsWith('Refine this solution.')) {
      return 'morning frost—\nthe kettle sings\nawake again';
    }
    const out = controllerScript[Math.min(controllerCalls, controllerScript.length - 1)];
    controllerCalls++;
    return out;
  }
};

async function mockEmbedder(text) {
  // Deterministic 16-dim "embedding": character codes summed into buckets.
  const v = new Array(16).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 16] += text.charCodeAt(i) / 1000;
  return v;
}

async function mockJudge(_prompt, output) {
  // Score 5..9 based on length + presence of haiku markers
  const base = output.includes('\n') ? 7.5 : 5.5;
  return Math.min(9.5, base + Math.min(1.5, (output.length - 20) / 60));
}

// ── Run ─────────────────────────────────────────────────────────────────────
(async () => {
  const engine = new Engine({
    ollama: mockOllama,
    embedder: mockEmbedder,
    judge: mockJudge,
    logger: (level, msg, meta) => {
      if (process.env.KURO_ENGINE_DEBUG) {
        console.log(`[${level}] ${msg}`, meta || '');
      }
    }
  }, {
    maxSteps: 4,
    terminateV: 5.0,   // effectively disable V-triggered early exit
    replanMax: 1
  });

  const result = await engine.run('Write a haiku about morning.', {
    sessionId: 'smoke-1',
    constraints: ['Three lines', 'No more than 20 words']
  });

  const checks = [];
  function assert(name, cond, detail) {
    checks.push({ name, ok: !!cond, detail });
  }

  assert('result.ok', result.ok === true);
  assert('terminalReason set', typeof result.terminalReason === 'string', result.terminalReason);
  assert('bestX populated', typeof result.bestX === 'string' && result.bestX.length > 0);
  assert('bestV finite', Number.isFinite(result.bestV));
  assert('steps >= 1', result.steps >= 1, `steps=${result.steps}`);
  assert('alerts is array', Array.isArray(result.alerts));

  // Trajectory log should have been written
  const dayFile = fs.readdirSync(path.join(tmp, 'trajectories'))[0];
  const logPath = path.join(tmp, 'trajectories', dayFile);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert('trajectory log has entries', lines.length >= 2, `lines=${lines.length}`);

  // Every step line should parse + carry the five blocks
  for (let i = 0; i < lines.length; i++) {
    const rec = JSON.parse(lines[i]);
    if (rec.type === 'step') {
      assert(`line ${i} has blocks.plan`, !!rec.blocks?.plan);
      assert(`line ${i} has controller_attempts`, Number.isFinite(rec.controller_attempts));
      assert(`line ${i} plan_masked exists`, Array.isArray(rec.blocks?.plan_masked));
    }
  }

  // Snapshot shape
  assert('snapshots.value.stats present', !!result.snapshots?.value?.stats?.v_logic);
  assert('snapshots.latent has updates', Number.isFinite(result.snapshots?.latent?.updates));
  assert('snapshots.budget has cfg', !!result.snapshots?.budget?.cfg);
  assert('snapshots.health has adv', !!result.snapshots?.health?.adv);

  // Report
  const failed = checks.filter(c => !c.ok);
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  console.log(`trajectory log: ${logPath}`);

  // Clean up temp dir on success
  if (!failed.length) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('smoke crashed:', e);
  process.exit(2);
});
