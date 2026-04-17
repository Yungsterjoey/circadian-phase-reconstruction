/**
 * LinkCardScreen: Claude-style dark payment form.
 * Stripe SetupIntent is confirmed via the persistent PayNav dock's Next button.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { getSetupIntent } from './api.js';
import { usePayNav } from './nav/PayNavContext.jsx';
import PoweredByStripe from './components/PoweredByStripe.jsx';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const STRIPE_EL_STYLE = {
  base: {
    fontSize: '16px',
    color: '#e5e7eb',
    fontFamily: 'Camphor, "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif',
    '::placeholder': { color: '#52525b' },
    iconColor: '#a1a1aa',
  },
  invalid: { color: '#ef4444' },
};

function InnerForm() {
  const stripe   = useStripe();
  const elements = useElements();
  const nav      = useNavigate();

  const [fullName, setFullName]       = useState('');
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [err, setErr]                 = useState(null);
  const [cardComplete, setCardComplete] = useState({ number: false, expiry: false, cvc: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { clientSecret } = await getSetupIntent();
        if (!cancelled) setClientSecret(clientSecret);
      } catch (e) {
        if (!cancelled) {
          if (e.status === 401) { window.location.href = '/login?redirect=/pay'; return; }
          setErr(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const readyToSubmit =
    !!stripe && !!elements && !!clientSecret &&
    fullName.trim().length >= 2 &&
    cardComplete.number && cardComplete.expiry && cardComplete.cvc;

  async function submit() {
    if (!readyToSubmit || submitting) return;
    setSubmitting(true);
    setErr(null);
    const { error } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: {
        card: elements.getElement(CardNumberElement),
        billing_details: { name: fullName.trim() },
      },
    });
    if (error) {
      setErr(error.message);
      setSubmitting(false);
      return;
    }
    nav('/send', { replace: true });
  }

  // Expose submit to the dock's Next button. Back → go to welcome.
  usePayNav({
    back:  { label: 'Cancel', onClick: () => nav('/welcome') },
    next:  readyToSubmit
      ? { label: submitting ? 'Linking…' : 'Link card', onClick: submit, loading: submitting, variant: 'primary' }
      : { label: 'Link card', variant: 'primary' },
  }, [readyToSubmit, submitting, clientSecret, stripe, elements, fullName]);

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
        <div className="kp-title">Couldn't start card setup</div>
        <div className="kp-dim kp-mt8">{err || 'Unknown error.'}</div>
        <button className="kp-btn kp-mt24" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <form className="kp-cform" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="kp-cform-inner">
        <h1 className="kp-cform-title">Payment method</h1>

        <div className="kp-field">
          <label htmlFor="kp-name" className="kp-field-label">Full name</label>
          <input
            id="kp-name"
            className="kp-field-input"
            type="text"
            autoComplete="cc-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="As shown on card"
            spellCheck={false}
          />
        </div>

        <div className="kp-field">
          <label className="kp-field-label">Card number</label>
          <div className="kp-field-stripe">
            <CardNumberElement
              options={{ style: STRIPE_EL_STYLE, placeholder: '1234 1234 1234 1234', showIcon: true }}
              onChange={(e) => setCardComplete((c) => ({ ...c, number: e.complete }))}
            />
          </div>
        </div>

        <div className="kp-field-row">
          <div className="kp-field">
            <label className="kp-field-label">Expiration date</label>
            <div className="kp-field-stripe">
              <CardExpiryElement
                options={{ style: STRIPE_EL_STYLE, placeholder: 'MM / YY' }}
                onChange={(e) => setCardComplete((c) => ({ ...c, expiry: e.complete }))}
              />
            </div>
          </div>
          <div className="kp-field">
            <label className="kp-field-label">Security code</label>
            <div className="kp-field-stripe">
              <CardCvcElement
                options={{ style: STRIPE_EL_STYLE, placeholder: 'CVC' }}
                onChange={(e) => setCardComplete((c) => ({ ...c, cvc: e.complete }))}
              />
            </div>
          </div>
        </div>

        {err && <div className="kp-err kp-mt8">{err}</div>}

        <PoweredByStripe className="kp-cform-stripe" />
      </div>
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
    <Elements stripe={stripePromise}>
      <InnerForm />
    </Elements>
  );
}
