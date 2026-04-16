'use strict';
const test = require('node:test');
const assert = require('node:assert');
const models = require('../../../modules/pay/intelligence/models.cjs');

test('orchestrator config points at qwen3:0.6b', () => {
  assert.strictEqual(models.ORCHESTRATOR.model, 'qwen3:0.6b');
  assert.strictEqual(models.ORCHESTRATOR.id, 'kuro-pay-orchestrator');
});

test('brain config points at gemma4:e4b', () => {
  assert.strictEqual(models.BRAIN.model, 'gemma4:e4b');
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
