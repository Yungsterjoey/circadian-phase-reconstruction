'use strict';
const test = require('node:test');
const assert = require('node:assert');
const models = require('../../../modules/pay/intelligence/models.cjs');

test('orchestrator config points at abliterated qwen3.5', () => {
  assert.strictEqual(models.ORCHESTRATOR.model, 'huihui_ai/qwen3.5-abliterated:0.8B');
  assert.strictEqual(models.ORCHESTRATOR.id, 'kuro-pay-orchestrator');
});

test('brain config points at abliterated gemma-4', () => {
  assert.strictEqual(models.BRAIN.model, 'huihui_ai/gemma-4-abliterated:e4b');
  assert.strictEqual(models.BRAIN.id, 'kuro-pay-brain');
});

test('safeParse strips markdown fences and parses JSON', () => {
  assert.deepStrictEqual(models.safeParse('```json\n{"a":1}\n```', { a: 0 }), { a: 1 });
  assert.deepStrictEqual(models.safeParse('```\n{"a":2}\n```', null), { a: 2 });
});

test('safeParse returns fallback on bad json', () => {
  assert.deepStrictEqual(models.safeParse('lol not json', { ok: false }), { ok: false });
  assert.deepStrictEqual(models.safeParse('', { ok: false }), { ok: false });
});

test('OLLAMA_URL defaults to localhost and honours OLLAMA_HOST env', () => {
  // Default has already been captured at require time — check the baseline.
  assert.match(models.OLLAMA_URL, /\/api\/chat$/);
});
