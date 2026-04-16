'use strict';

// End-to-end smoke for the quote engine: asserts the exact fees the product
// spec calls out for a 5,000 VND transaction across Free and Pro tiers.

const test   = require('node:test');
const assert = require('node:assert');
const engine = require('../../../modules/pay/core/quote_engine.cjs');

// Stand-in for the VietQR adapter: same shape rails/vietqr.cjs produces,
// but deterministic and free of network/CRC deps.
const fakeVietQR = {
  id: 'vietqr',
  async quote({ sourceAmount }) {
    const fxRate = 16500;
    return {
      fxRate,
      destinationAmount: Math.round(sourceAmount * fxRate),
      destinationCurrency: 'VND',
      fee: 0,
      feeCapped: false,
      net: sourceAmount,
      eta: '< 30s',
      ratesExact: false,
    };
  },
};

// Invert the rail so we express the tx as "5,000 VND" and let the engine see
// the corresponding AUD gross. Keeps the smoke assertion true to the spec.
const vnd5000InAUD = 5000 / 16500;

test('5,000 VND — Free tier shows AUD $0.19 fee (minimum)', async () => {
  const out = await engine.quote(fakeVietQR, {
    sourceAmount:   vnd5000InAUD,
    sourceCurrency: 'AUD',
    destination:    { country: 'VN' },
    user:           { tier: 'free' },
  });
  assert.strictEqual(out.commission, 0.19);
  assert.strictEqual(out.commissionRate, 0.03);
  assert.strictEqual(out.tier, 'free');
  assert.strictEqual(out.feeCapped, false);
  assert.strictEqual(out.localizedMinimum, 3500);
});

test('5,000 VND — Pro tier shows AUD $0.01 fee (no minimum, ceiled to cent)', async () => {
  const out = await engine.quote(fakeVietQR, {
    sourceAmount:   vnd5000InAUD,
    sourceCurrency: 'AUD',
    destination:    { country: 'VN' },
    user:           { tier: 'pro' },
  });
  assert.strictEqual(out.commission, 0.01);
  assert.strictEqual(out.commissionRate, 0.015);
  assert.strictEqual(out.tier, 'pro');
  // Pro has no minimum, so no localized minimum is displayed.
  assert.strictEqual(out.localizedMinimum, null);
});

test('5,000 VND — Sov tier applies 0.75% with no cap and no minimum', async () => {
  const out = await engine.quote(fakeVietQR, {
    sourceAmount:   vnd5000InAUD,
    sourceCurrency: 'AUD',
    destination:    { country: 'VN' },
    user:           { tier: 'sovereign' },
  });
  // 0.0075 × 0.3030... = 0.00227; ceil to cent = $0.01.
  assert.strictEqual(out.commission, 0.01);
  assert.strictEqual(out.tier, 'sov');
  assert.strictEqual(out.feeCapped, false);
});

test('large charge caps Free at $5 and Pro at $3', async () => {
  const free = await engine.quote(fakeVietQR, {
    sourceAmount: 300, sourceCurrency: 'AUD', destination: {}, user: { tier: 'free' },
  });
  assert.strictEqual(free.commission, 5.00);
  assert.strictEqual(free.feeCapped, true);

  const pro = await engine.quote(fakeVietQR, {
    sourceAmount: 300, sourceCurrency: 'AUD', destination: {}, user: { tier: 'pro' },
  });
  assert.strictEqual(pro.commission, 3.00);
  assert.strictEqual(pro.feeCapped, true);
});
