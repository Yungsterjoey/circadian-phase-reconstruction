'use strict';

// Hourly commission payout to KURO's Wise treasury account.
// Default-off: no-ops unless KURO_PAY_PAYOUT_ENABLED === 'true'.
// Safety ceiling: KURO_PAY_PAYOUT_MAX_PER_TRANSFER_AUD (default 500).
// Minimum threshold: KURO_PAY_COMMISSION_MIN_PAYOUT_AUD (default 5).
//
// wise_treasury is only required inside the payout function — not at module load.
// This prevents the guard from firing on the scheduler's load itself (scheduler/ is
// on the allow-list, but the require happens at call time, which still traces back
// to this file in the call stack, not a rails/ file).

const commissionLedger = require('../core/commission_ledger.cjs');

let _intervalHandle = null;

async function runPayout() {
  if (process.env.KURO_PAY_PAYOUT_ENABLED !== 'true') {
    console.log('[KURO::PAY] COMMISSION_PAYOUT_DISABLED_BY_CONFIG');
    return;
  }

  const MIN = parseFloat(process.env.KURO_PAY_COMMISSION_MIN_PAYOUT_AUD || '5');
  const MAX = parseFloat(process.env.KURO_PAY_PAYOUT_MAX_PER_TRANSFER_AUD || '500');

  const total = commissionLedger.pendingTotal();

  if (total < MIN) {
    console.log('[KURO::PAY] COMMISSION_PAYOUT_SKIPPED_BELOW_MIN', { total, min: MIN });
    return;
  }

  if (total > MAX) {
    console.log('[KURO::PAY] COMMISSION_PAYOUT_EXCEEDS_MAX', { total, max: MAX });
    return;
  }

  try {
    const treasury = require('../connectors/wise_treasury.cjs');
    const result   = await treasury.transfer(total);
    commissionLedger.markPaid(String(result.transferId));
    console.log('[KURO::PAY] COMMISSION_PAYOUT_SENT', { total, transferId: result.transferId, status: result.status });
  } catch (err) {
    console.log('[KURO::PAY] COMMISSION_PAYOUT_FAILED', { total, error: err.message });
  }
}

function start() {
  if (_intervalHandle) return; // already running
  _intervalHandle = setInterval(runPayout, 60 * 60 * 1000); // 1hr
  console.log('[KURO::PAY] Commission payout scheduler started (payout enabled:', process.env.KURO_PAY_PAYOUT_ENABLED === 'true', ')');
}

function stop() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

// Exported for admin/sweep endpoint — bypasses interval, still respects MIN/MAX/ENABLED.
module.exports = { start, stop, runPayout };
