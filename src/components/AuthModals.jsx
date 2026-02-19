/**
 * KURO::AUTH Modals v1.0
 * AuthModal (login/signup), VerifyModal (OTP), UpgradeModal (tier comparison)
 * Liquid Glass design language
 */
import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MODAL — Login / Signup
// ═══════════════════════════════════════════════════════════════════════════
export function AuthModal() {
  const { showAuth, authTab, error, login, signup, closeAuth, clearError } = useAuthStore();
  const [tab, setTab] = useState(authTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { setTab(authTab); }, [authTab]);
  useEffect(() => { if (showAuth) { clearError(); emailRef.current?.focus(); } }, [showAuth]);

  if (!showAuth) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (tab === 'login') await login(email, password);
      else await signup(email, password, name || undefined);
    } catch (err) {}
    setSubmitting(false);
  };

  return (
    <div className="kuro-modal-overlay" onClick={closeAuth}>
      <div className="kuro-modal auth-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-logo">
          <div className="auth-logo-icon">K</div>
          <div className="auth-logo-text">KURO OS</div>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); clearError(); }}>Sign In</button>
          <button className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => { setTab('signup'); clearError(); }}>Create Account</button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {tab === 'signup' && (
            <input type="text" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)}
              className="auth-input" autoComplete="name" />
          )}
          <input ref={emailRef} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="auth-input" autoComplete="email" required />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="auth-input" autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            required minLength={8} />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? '...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button className="auth-close" onClick={closeAuth}>✕</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFY MODAL — OTP Input
// ═══════════════════════════════════════════════════════════════════════════
export function VerifyModal() {
  const { showVerify, error, verifyEmail, resendOTP, closeVerify, clearError, user } = useAuthStore();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (showVerify) inputRef.current?.focus(); }, [showVerify]);

  if (!showVerify) return null;

  const handleVerify = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try { await verifyEmail(code); } catch (err) {}
    setSubmitting(false);
  };

  const handleResend = async () => {
    clearError();
    try {
      await resendOTP();
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch (err) {}
  };

  return (
    <div className="kuro-modal-overlay" onClick={closeVerify}>
      <div className="kuro-modal verify-modal" onClick={e => e.stopPropagation()}>
        <div className="auth-logo">
          <div className="auth-logo-icon">✉</div>
          <div className="auth-logo-text">Verify Email</div>
        </div>

        <p className="verify-desc">Enter the 6-digit code sent to <strong>{user?.email}</strong></p>

        <form onSubmit={handleVerify} className="auth-form">
          <input ref={inputRef} type="text" placeholder="000000" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="auth-input otp-input" maxLength={6} inputMode="numeric" autoComplete="one-time-code" />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={submitting || code.length !== 6}>
            {submitting ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        <button className="auth-link" onClick={handleResend} disabled={resent}>
          {resent ? 'Code sent!' : 'Resend code'}
        </button>

        <button className="auth-close" onClick={closeVerify}>✕</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UPGRADE MODAL — Tier Comparison
// ═══════════════════════════════════════════════════════════════════════════
const TIERS = [
  {
    id: 'free', name: 'Free', price: '$0', period: 'forever',
    features: ['25 messages/week', '1 AI agent', '1 image sample', 'Web desktop'],
    highlight: false
  },
  {
    id: 'pro', name: 'Pro', price: '$19', period: '/month',
    features: ['200 messages/day', '2 AI agents', '20 images/day', 'Files & Browser', 'Vision analysis'],
    highlight: true
  },
  {
    id: 'sovereign', name: 'Sovereign', price: '$49', period: '/month',
    features: ['500 messages/day', 'All AI agents', '50 images/day', 'Terminal & exec', 'LiveEdit & DEV mode', 'Full sovereignty'],
    highlight: false
  }
];

const TIER_LEVEL = { free: 0, pro: 1, sovereign: 2 };

export function UpgradeModal() {
  const { showUpgrade, upgradeContext, user, startCheckout, closeUpgrade } = useAuthStore();

  if (!showUpgrade) return null;

  const userTier = user?.tier || 'free';
  const featureName = upgradeContext?.feature || 'this feature';
  const requiredTier = upgradeContext?.requiredTier || 'pro';

  return (
    <div className="kuro-modal-overlay" onClick={closeUpgrade}>
      <div className="kuro-modal upgrade-modal" onClick={e => e.stopPropagation()}>
        <div className="upgrade-header">
          <div className="upgrade-lock">🔒</div>
          <h2 className="upgrade-title">{featureName} requires {requiredTier === 'sovereign' ? 'Sovereign' : 'Pro'}</h2>
          <p className="upgrade-subtitle">Upgrade to unlock the full KURO experience</p>
        </div>

        <div className="tier-grid">
          {TIERS.map(tier => {
            const isCurrent = tier.id === userTier;
            const isTarget = TIER_LEVEL[tier.id] > TIER_LEVEL[userTier] && TIER_LEVEL[tier.id] >= TIER_LEVEL[requiredTier];
            return (
              <div key={tier.id} className={`tier-card ${tier.highlight ? 'featured' : ''} ${isCurrent ? 'current' : ''}`}>
                {tier.highlight && <div className="tier-badge">Most Popular</div>}
                <div className="tier-name">{tier.name}</div>
                <div className="tier-price">{tier.price}<span className="tier-period">{tier.period}</span></div>
                <ul className="tier-features">
                  {tier.features.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                {isCurrent && <div className="tier-current-badge">Current Plan</div>}
                {isTarget && (
                  <button className="tier-upgrade-btn" onClick={() => startCheckout(tier.id)}>
                    Upgrade to {tier.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button className="auth-close" onClick={closeUpgrade}>✕</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES — Injected globally
// ═══════════════════════════════════════════════════════════════════════════
export function AuthStyles() {
  return <style>{`
/* MODAL OVERLAY */
.kuro-modal-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* MODAL BASE */
.kuro-modal {
  position: relative; width: 90%; max-width: 380px; padding: 32px;
  background: rgba(18,18,22,0.92);
  backdrop-filter: blur(50px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1);
  animation: slideUp 0.25s ease;
}
@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

.upgrade-modal { max-width: 720px; }

/* CLOSE BUTTON */
.auth-close {
  position: absolute; top: 12px; right: 12px;
  background: none; border: none; color: rgba(255,255,255,0.3);
  font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px;
}
.auth-close:hover { color: #fff; background: rgba(255,255,255,0.08); }

/* LOGO */
.auth-logo { text-align: center; margin-bottom: 24px; }
.auth-logo-icon {
  display: inline-flex; width: 48px; height: 48px; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #9333ea, #6366f1);
  border-radius: 14px; font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 8px;
}
.auth-logo-text { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.5); letter-spacing: 2px; }

/* TABS */
.auth-tabs {
  display: flex; gap: 2px; background: rgba(255,255,255,0.04); border-radius: 10px;
  padding: 3px; margin-bottom: 20px;
}
.auth-tab {
  flex: 1; padding: 8px; border: none; background: none;
  color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 500;
  border-radius: 8px; cursor: pointer; transition: all 0.2s;
}
.auth-tab.active { background: rgba(255,255,255,0.08); color: #fff; }

/* FORM */
.auth-form { display: flex; flex-direction: column; gap: 12px; }
.auth-input {
  width: 100%; padding: 12px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #fff; font-size: 15px; outline: none; transition: border-color 0.2s;
  box-sizing: border-box;
}
.auth-input:focus { border-color: rgba(147,51,234,0.5); }
.auth-input::placeholder { color: rgba(255,255,255,0.25); }

.otp-input { text-align: center; font-size: 28px; letter-spacing: 12px; font-family: monospace; }

.auth-error {
  padding: 8px 12px; border-radius: 8px; font-size: 13px;
  background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171;
}

.auth-submit {
  padding: 12px; border-radius: 10px; border: none; font-size: 15px; font-weight: 600;
  background: linear-gradient(135deg, #9333ea, #6366f1); color: #fff;
  cursor: pointer; transition: opacity 0.2s;
}
.auth-submit:hover { opacity: 0.9; }
.auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.auth-link {
  display: block; width: 100%; margin-top: 12px; padding: 8px;
  background: none; border: none; color: rgba(147,51,234,0.8);
  font-size: 13px; cursor: pointer; text-align: center;
}
.auth-link:hover { color: #a855f7; }
.auth-link:disabled { color: rgba(255,255,255,0.3); }

/* VERIFY DESC */
.verify-desc { text-align: center; color: rgba(255,255,255,0.5); font-size: 14px; margin-bottom: 16px; }
.verify-desc strong { color: rgba(255,255,255,0.8); }

/* UPGRADE MODAL */
.upgrade-header { text-align: center; margin-bottom: 24px; }
.upgrade-lock { font-size: 36px; margin-bottom: 8px; }
.upgrade-title { font-size: 18px; font-weight: 600; color: #fff; margin: 0 0 4px; }
.upgrade-subtitle { font-size: 13px; color: rgba(255,255,255,0.4); margin: 0; }

.tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 600px) { .tier-grid { grid-template-columns: 1fr; } }

.tier-card {
  padding: 20px 16px; border-radius: 14px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; align-items: center; position: relative;
}
.tier-card.featured { border-color: rgba(147,51,234,0.4); background: rgba(147,51,234,0.06); }
.tier-card.current { border-color: rgba(255,255,255,0.15); }

.tier-badge {
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  padding: 2px 10px; border-radius: 8px; font-size: 10px; font-weight: 600;
  background: linear-gradient(135deg, #9333ea, #6366f1); color: #fff; white-space: nowrap;
}
.tier-name { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 4px; }
.tier-price { font-size: 28px; font-weight: 700; color: #fff; }
.tier-period { font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.4); }
.tier-features {
  list-style: none; padding: 0; margin: 16px 0; text-align: left; width: 100%;
}
.tier-features li {
  font-size: 12px; color: rgba(255,255,255,0.6); padding: 4px 0;
}
.tier-features li::before { content: '✓ '; color: #22c55e; }
.tier-current-badge {
  padding: 6px 16px; border-radius: 8px; font-size: 12px;
  background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.4);
}
.tier-upgrade-btn {
  width: 100%; padding: 10px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
  background: linear-gradient(135deg, #9333ea, #6366f1); color: #fff;
  transition: opacity 0.2s;
}
.tier-upgrade-btn:hover { opacity: 0.9; }
  `}</style>;
}
