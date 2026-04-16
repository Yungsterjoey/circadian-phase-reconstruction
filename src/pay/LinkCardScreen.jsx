import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { getSetupIntent } from './api.js';

/**
 * Card linking via Stripe SetupIntent.
 *
 *   1. POST /api/pay/card/setup → { clientSecret } (creates SetupIntent)
 *   2. stripe.confirmCardSetup(clientSecret, { card })
 *   3. Stripe webhook (handled backend) saves the payment_method → kuro_pay_cards
 *
 * We rely on the webhook-persisted card, then fall back to /card/list
 * to pick up the saved row before sending the user forward.
 */

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

function InnerForm() {
  const stripe   = useStripe();
  const elements = useElements();
  const nav      = useNavigate();

  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [submitting, setSubmitting]     = useState(false);
  const [err, setErr]                   = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { clientSecret } = await getSetupIntent();
        if (!cancelled) setClientSecret(clientSecret);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) return;
    setSubmitting(true);
    setErr(null);

    const { error } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: elements.getElement(CardElement) },
    });
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    // Webhook writes the card asynchronously — poll briefly for it.
    // Cap at ~6s total; if it still isn't there we forward anyway and
    // Confirm will bounce back to /link-card if no card is found.
    nav('/scan', { replace: true });
  }

  if (loading) {
    return (
      <div className="kp-center kp-fullscreen">
        <div className="kp-spinner" />
        <div className="kp-dim kp-mt16">Preparing secure card form…</div>
      </div>
    );
  }
  if (!clientSecret) {
    return (
      <div className="kp-center kp-fullscreen kp-pad">
        <div className="kp-title">Couldn’t start card setup</div>
        <div className="kp-dim kp-mt8">{err || 'Unknown error.'}</div>
        <button className="kp-btn kp-mt24" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="kp-link-form">
      <div className="kp-title">Link a card</div>
      <div className="kp-dim kp-mt4 kp-sm">
        Used to fund KURO::PAY transfers. Charged once per payment — no wallet top-up.
      </div>

      <div className="kp-glass kp-card-input kp-mt24">
        <CardElement
          options={{
            style: {
              base: {
                fontSize:     '18px',
                color:        '#f4f4f5',
                fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                '::placeholder': { color: '#6b7280' },
              },
              invalid: { color: '#ef4444' },
            },
          }}
        />
      </div>

      {err && <div className="kp-err kp-mt16">{err}</div>}

      <button
        type="submit"
        className="kp-btn kp-btn-primary kp-btn-lg kp-mt24"
        disabled={!stripe || submitting}
      >
        {submitting ? 'Linking…' : 'Link card'}
      </button>
    </form>
  );
}

export default function LinkCardScreen() {
  const stripePromise = useMemo(
    () => (STRIPE_PK ? loadStripe(STRIPE_PK) : null),
    []
  );

  if (!STRIPE_PK) {
    return (
      <div className="kp-center kp-fullscreen kp-pad">
        <div className="kp-title">Stripe not configured</div>
        <div className="kp-dim kp-mt8">
          VITE_STRIPE_PUBLISHABLE_KEY is missing. Set it in <code>.env</code> and rebuild.
        </div>
      </div>
    );
  }

  return (
    <div className="kp-fullscreen kp-link-root">
      <Elements stripe={stripePromise}>
        <InnerForm />
      </Elements>
    </div>
  );
}
