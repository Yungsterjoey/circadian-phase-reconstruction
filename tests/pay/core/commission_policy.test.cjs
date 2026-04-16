'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const policy = require('../../../modules/pay/core/commission_policy.cjs');

test('tier rates match the product spec', () => {
  assert.strictEqual(policy.TIERS.free.rate, 0.03);
  assert.strictEqual(policy.TIERS.pro.rate,  0.015);
  assert.strictEqual(policy.TIERS.sov.rate,  0.0075);
});

test('tier minimums and caps match the product spec', () => {
  assert.strictEqual(policy.TIERS.free.minimum_fee_aud, 0.19);
  assert.strictEqual(policy.TIERS.pro.minimum_fee_aud,  0);
  assert.strictEqual(policy.TIERS.sov.minimum_fee_aud,  0);
  assert.strictEqual(policy.TIERS.free.cap_aud, 5.00);
  assert.strictEqual(policy.TIERS.pro.cap_aud,  3.00);
  assert.strictEqual(policy.TIERS.sov.cap_aud,  null);
});

test('normalizeTier coerces sovereign → sov and unknown → free', () => {
  assert.strictEqual(policy.normalizeTier('SOVEREIGN'), 'sov');
  assert.strictEqual(policy.normalizeTier('platinum'),  'free');
  assert.strictEqual(policy.normalizeTier(null),        'free');
});

test('calcFee applies minimum on small Free charges', () => {
  // 5,000 VND / 16,500 VND-per-AUD ≈ $0.3030; 3% = $0.009 → below $0.19 min.
  const r = policy.calcFee(0.3030, 'free');
  assert.strictEqual(r.fee, 0.19);
  assert.strictEqual(r.feeFloored, true);
  assert.strictEqual(r.feeCapped, false);
});

test('calcFee for Pro has no minimum and ceils sub-cent fees up to $0.01', () => {
  // Same gross as above; Pro has no minimum. 1.5% × $0.3030 = $0.004545 → ceil to cent = $0.01.
  const r = policy.calcFee(0.3030, 'pro');
  assert.strictEqual(r.fee, 0.01);
  assert.strictEqual(r.feeFloored, false);
  assert.strictEqual(r.feeCapped, false);
});

test('calcFee caps Free at $5 on large charges', () => {
  const r = policy.calcFee(500, 'free');
  assert.strictEqual(r.fee, 5.00);
  assert.strictEqual(r.feeCapped, true);
});

test('calcFee caps Pro at $3 on large charges', () => {
  const r = policy.calcFee(500, 'pro');
  assert.strictEqual(r.fee, 3.00);
  assert.strictEqual(r.feeCapped, true);
});

test('calcFee has no cap for Sov — fee scales linearly', () => {
  const r = policy.calcFee(1000, 'sov');
  // 0.75% × 1000 = $7.50 exactly.
  assert.strictEqual(r.fee, 7.50);
  assert.strictEqual(r.feeCapped, false);
});

test('localizedMinimum rounds $0.19 AUD up to 3,500 VND at a 16500 rate', () => {
  assert.strictEqual(policy.localizedMinimum(0.19, 'VND', 16500), 3500);
});

test('localizedMinimum returns null when tier minimum is zero', () => {
  assert.strictEqual(policy.localizedMinimum(0, 'VND', 16500), null);
});

test('localizedMinimum rounds IDR up to nearest 1,000', () => {
  // 0.19 × 10300 = 1957 → ceil to 1000 → 2000.
  assert.strictEqual(policy.localizedMinimum(0.19, 'IDR', 10300), 2000);
});

test('publicPolicy returns a UI-ready view with localized minima', () => {
  const view = policy.publicPolicy('free', { VND: 16500, THB: 23.5 });
  assert.strictEqual(view.tier, 'free');
  assert.strictEqual(view.minimum_fee_aud, 0.19);
  assert.strictEqual(view.localized_minima.VND, 3500);
  assert.strictEqual(view.localized_minima.THB, 5);
});
