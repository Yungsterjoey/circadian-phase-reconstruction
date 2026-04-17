/**
 * WelcomeScreen: first screen after launching KUROPay from kuroglass.net.
 * Brief marketing copy, coverage, legal links. The dock's "Get started"
 * button moves the user to /link-card (or /send if cards already exist).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCards } from './api.js';
import { usePayNav } from './nav/PayNavContext.jsx';
import PoweredByStripe from './components/PoweredByStripe.jsx';
import { openLegalModal } from '../components/legal/legalBus.js';

// Inline SVG approximations of each rail's official mark. Kept compact
// (24px square) — these are brand chips, not logomarks at scale.
function RailLogo({ code }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' };
  switch (code) {
    case 'VietQR':
      // NAPAS VietQR: blue rounded square w/ stylised QR corner + centre dot
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="#004A9F"/>
          <rect x="4" y="4" width="6" height="6" rx="1" fill="#fff"/>
          <rect x="6" y="6" width="2" height="2" fill="#004A9F"/>
          <rect x="14" y="4" width="6" height="6" rx="1" fill="#fff"/>
          <rect x="16" y="6" width="2" height="2" fill="#004A9F"/>
          <rect x="4" y="14" width="6" height="6" rx="1" fill="#fff"/>
          <rect x="6" y="16" width="2" height="2" fill="#004A9F"/>
          <rect x="14" y="14" width="6" height="6" rx="1" fill="#E30613"/>
        </svg>
      );
    case 'PromptPay':
      // BOT PromptPay: blue circle with white "p" glyph abstraction
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" fill="#002F6C"/>
          <path d="M8 6.5h5.2a4.2 4.2 0 0 1 0 8.4H10v3.6H8V6.5Zm2 2v4.4h3.2a2.2 2.2 0 0 0 0-4.4H10Z" fill="#fff"/>
          <circle cx="17.6" cy="9.2" r="1.6" fill="#1CA49E"/>
        </svg>
      );
    case 'QRIS':
      // Bank Indonesia QRIS: red-white stacked bars + QR square
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="23" height="23" rx="4" fill="#fff" stroke="#E60012" strokeWidth="1"/>
          <rect x="3" y="3" width="7" height="7" fill="#E60012"/>
          <rect x="5" y="5" width="3" height="3" fill="#fff"/>
          <rect x="14" y="3" width="7" height="7" fill="#E60012"/>
          <rect x="16" y="5" width="3" height="3" fill="#fff"/>
          <rect x="3" y="14" width="7" height="7" fill="#E60012"/>
          <rect x="5" y="16" width="3" height="3" fill="#fff"/>
          <rect x="14" y="14" width="3" height="3" fill="#E60012"/>
          <rect x="18" y="14" width="3" height="3" fill="#E60012"/>
          <rect x="14" y="18" width="7" height="3" fill="#E60012"/>
        </svg>
      );
    case 'QR Ph':
      // BSP QR Ph: blue rounded square with sun rays + PH-yellow centre
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="#0038A8"/>
          <circle cx="12" cy="12" r="4.5" fill="#FCD116"/>
          <g stroke="#FCD116" strokeWidth="1.2" strokeLinecap="round">
            <line x1="12" y1="2.5" x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="21.5"/>
            <line x1="2.5" y1="12" x2="5" y2="12"/>
            <line x1="19" y1="12" x2="21.5" y2="12"/>
            <line x1="5.2" y1="5.2" x2="7" y2="7"/>
            <line x1="17" y1="17" x2="18.8" y2="18.8"/>
            <line x1="18.8" y1="5.2" x2="17" y2="7"/>
            <line x1="7" y1="17" x2="5.2" y2="18.8"/>
          </g>
          <circle cx="12" cy="12" r="2" fill="#CE1126"/>
        </svg>
      );
    case 'DuitNow':
      // PayNet DuitNow: red rounded square with white "D" + arrow flourish
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="#ED1C24"/>
          <path d="M6 6.5h5.5a5.5 5.5 0 0 1 0 11H6v-11Zm2 2v7h3.5a3.5 3.5 0 0 0 0-7H8Z" fill="#fff"/>
          <path d="M17 9.5l2.5 2.5L17 14.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    default:
      return null;
  }
}

const RAILS = [
  { code: 'VietQR',    country: 'Vietnam'      },
  { code: 'PromptPay', country: 'Thailand'     },
  { code: 'QRIS',      country: 'Indonesia'    },
  { code: 'QR Ph',     country: 'Philippines'  },
  { code: 'DuitNow',   country: 'Malaysia'     },
];

export default function WelcomeScreen() {
  const nav = useNavigate();
  const [nextHref, setNextHref] = useState('/link-card');

  // Decide whether Get Started goes to /link-card or /send based on saved cards.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { cards } = await fetchCards();
        if (cancelled) return;
        setNextHref(cards && cards.length > 0 ? '/send' : '/link-card');
      } catch {
        // keep default /link-card; LinkCardScreen's own 401 handler bounces if unauth
      }
    })();
    return () => { cancelled = true; };
  }, []);

  usePayNav({
    back: { label: 'Back' }, // disabled: nowhere to go back on landing
    next: {
      label: 'Get started',
      onClick: () => nav(nextHref),
      variant: 'primary',
    },
  }, [nextHref]);

  return (
    <div className="kp-welcome">
      <div className="kp-welcome-inner">

        <header className="kp-welcome-head">
          <div className="kp-welcome-eyebrow">KUROPay</div>
          <h1 className="kp-welcome-title">
            Card → local QR,<br/>anywhere in SEA.
          </h1>
          <p className="kp-welcome-sub">
            Scan any supported QR code in five countries and pay instantly
            from your home card. No wallet, no top-up, no minimum.
            Just a normal card charge in your home currency.
          </p>
        </header>

        <section className="kp-welcome-card kp-welcome-rails">
          <div className="kp-welcome-card-label">Supported rails</div>
          <ul className="kp-rails-list">
            {RAILS.map((r) => (
              <li key={r.code} className="kp-rails-item">
                <span className="kp-rails-left">
                  <span className="kp-rails-logo" aria-hidden="true"><RailLogo code={r.code} /></span>
                  <span className="kp-rails-code">{r.code}</span>
                </span>
                <span className="kp-rails-country">{r.country}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="kp-welcome-card kp-welcome-how">
          <div className="kp-welcome-card-label">How it works</div>
          <ol className="kp-how-list">
            <li><span className="kp-how-num">1</span> Link your Visa, Mastercard or Amex, once.</li>
            <li><span className="kp-how-num">2</span> Scan a merchant QR at checkout.</li>
            <li><span className="kp-how-num">3</span> Confirm the amount. Your card is charged in your home currency, the merchant is paid on their local rail.</li>
          </ol>
        </section>

        <section className="kp-welcome-card kp-welcome-legal">
          <div className="kp-welcome-card-label">Before you start</div>
          <p className="kp-welcome-legal-line">
            By continuing you accept the{' '}
            <button className="kp-inline-link" onClick={() => openLegalModal('terms')}>Terms of Service</button>,{' '}
            <button className="kp-inline-link" onClick={() => openLegalModal('privacy')}>Privacy Policy</button>,{' '}
            <button className="kp-inline-link" onClick={() => openLegalModal('aup')}>Acceptable Use</button>, and{' '}
            <button className="kp-inline-link" onClick={() => openLegalModal('disclaimer')}>Disclaimer</button>.
            Cookies are governed by our{' '}
            <button className="kp-inline-link" onClick={() => openLegalModal('cookie')}>Cookie Policy</button>.
          </p>
        </section>

        <PoweredByStripe className="kp-welcome-stripe" />
      </div>
    </div>
  );
}
