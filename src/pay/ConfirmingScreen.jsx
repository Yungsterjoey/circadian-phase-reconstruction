import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPaymentStatus } from './api.js';

const POLL_INTERVAL_MS = 1500;

const COPY_STAGES = [
  { atMs: 0,      text: 'Payment submitted…' },
  { atMs: 10_000, text: 'Waiting for settlement…' },
  { atMs: 30_000, text: 'This is taking a little longer than usual…' },
  { atMs: 60_000, text: null },  // null = stop polling, route home
];

export default function ConfirmingScreen() {
  const loc = useLocation();
  const nav = useNavigate();

  const { paymentId, rail, railMeta, amountLocal, card } = loc.state || {};

  const [copy, setCopy]       = useState(COPY_STAGES[0].text);
  const [elapsed, setElapsed] = useState(0);
  const startRef   = useRef(Date.now());
  const intervalRef = useRef(null);
  const timedOut   = useRef(false);

  useEffect(() => {
    if (!paymentId) { nav('/send', { replace: true }); return; }

    const tick = async () => {
      const now     = Date.now();
      const elapsedMs = now - startRef.current;
      setElapsed(elapsedMs);

      // Update copy based on elapsed time
      const stage = [...COPY_STAGES].reverse().find(s => elapsedMs >= s.atMs);
      if (stage?.text) setCopy(stage.text);

      // 60s timeout: give up polling
      if (elapsedMs >= 60_000 && !timedOut.current) {
        timedOut.current = true;
        clearInterval(intervalRef.current);
        nav('/', { replace: true, state: { toast: 'Payment submitted — settling in background.' } });
        return;
      }

      try {
        const result = await getPaymentStatus(paymentId);
        if (result.status === 'settled') {
          clearInterval(intervalRef.current);
          nav('/receipt', {
            replace: true,
            state: {
              created: {
                paymentId,
                amountAud:   result.receipt?.source?.grossAmount,
                commission:  result.receipt?.source?.commission,
                merchant:    result.receipt?.merchant,
                reference:   result.receipt?.reference,
              },
              conf: {
                paymentId,
                confirmed: true,
                status:    'settled',
                receipt:   {
                  status:       'settled',
                  reference:    result.receipt?.reference,
                  merchant:     result.receipt?.merchant?.merchantName,
                  bank:         result.receipt?.merchant?.bankName,
                  amountLocal,
                  currency:     railMeta?.currency,
                  settledAt:    result.settledAt,
                  proof:        result.receipt?.txSignature || result.receipt?.receiptId,
                },
              },
            },
          });
          return;
        }
        if (result.status === 'failed' || result.status === 'error') {
          clearInterval(intervalRef.current);
          nav('/receipt', {
            replace: true,
            state: {
              created: { paymentId },
              conf:    { paymentId, confirmed: false, status: 'failed', message: result.error || 'Payment failed.' },
            },
          });
        }
      } catch (_) {
        // Network error — keep polling
      }
    };

    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);
    tick(); // immediate first poll

    return () => clearInterval(intervalRef.current);
  }, [paymentId, nav, amountLocal, railMeta]);

  const elapsedSec = Math.floor(elapsed / 1000);

  return (
    <div className="kp-fullscreen kp-confirming-root">
      <div className="kp-confirming-center">
        <div className="kp-spinner kp-spinner-lg" />
        <div className="kp-confirming-copy">{copy}</div>
        {elapsedSec > 5 && (
          <div className="kp-dim kp-xs kp-mt8">{elapsedSec}s</div>
        )}
        {railMeta && (
          <div className="kp-rail-badge kp-mt16">
            <span>{railMeta.flag}</span>
            <span className="kp-rail-name">{railMeta.name}</span>
          </div>
        )}
        {amountLocal && railMeta && (
          <div className="kp-dim kp-mt8">{railMeta.currency} {amountLocal}</div>
        )}
      </div>
    </div>
  );
}
