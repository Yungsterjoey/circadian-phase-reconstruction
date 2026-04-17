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
                <span className="kp-rails-code">{r.code}</span>
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
