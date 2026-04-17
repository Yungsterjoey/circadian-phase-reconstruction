/**
 * PoweredByStripe: the Stripe wordmark (clickable → stripe.com) paired with
 * a small keypad icon, set in Stripe's own brand typography (Camphor →
 * system-ui fallback ladder that matches Stripe.com).
 */
import React from 'react';

function KeypadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="10" y="3" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="17" y="3" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="3" y="10" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="10" y="10" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="17" y="10" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="3" y="17" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="10" y="17" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="17" y="17" width="4" height="4" rx="1" fill="currentColor" opacity="0.85"/>
    </svg>
  );
}

/* Stripe wordmark: vectorised from the official logo. Rendered in Stripe-blue
 * accent on hover, neutral grey at rest to stay unobtrusive on the form. */
function StripeWordmark() {
  return (
    <svg
      viewBox="0 0 60 25"
      width="48"
      height="20"
      role="img"
      aria-label="Stripe"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.63l.21 1.03a4.7 4.7 0 0 1 3.22-1.24c2.88 0 5.6 2.61 5.6 7.4 0 5.23-2.7 7.54-5.62 7.54zM40 9.01c-.95 0-1.54.34-1.98.81l.02 6.35c.4.44.98.78 1.96.78 1.54 0 2.58-1.68 2.58-3.99 0-2.24-1.05-3.95-2.58-3.95zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.14v5.85zm-4.91.7c0 2.97-2.31 4.66-5.73 4.66a11.2 11.2 0 0 1-4.46-.93v-3.93c1.38.75 3.1 1.31 4.46 1.31.92 0 1.58-.24 1.58-1C6.3 13.76 0 14.51 0 9.95 0 7.04 2.28 5.3 5.62 5.3c1.36 0 2.72.2 4.09.75v3.88a9.23 9.23 0 0 0-4.1-1.06c-.86 0-1.44.25-1.44.9 0 1.85 6.29.97 6.29 5.88z"
      />
    </svg>
  );
}

export default function PoweredByStripe({ className = '' }) {
  return (
    <div className={`kp-stripe-attrib ${className}`}>
      <span className="kp-stripe-keypad" aria-hidden="true">
        <KeypadIcon />
      </span>
      <span className="kp-stripe-sep" aria-hidden="true" />
      <span className="kp-stripe-powered">Powered by</span>
      <a
        className="kp-stripe-link"
        href="https://stripe.com"
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Stripe: opens in a new tab"
      >
        <StripeWordmark />
      </a>
    </div>
  );
}
