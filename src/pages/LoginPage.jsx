/**
 * KURO OS — Login Page ("/login")
 * Centered glass panel on dark background. Reuses AuthGate form logic.
 * Conceptual artifact framing: build/edition placard.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import DesktopBackground from '../components/DesktopBackground';
import CookieBanner from '../components/CookieBanner';

/* ─── Icons ─────────────────────────────────────────────────────────── */
const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
);
const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
);
const KeyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
);

/* ─── Legal data (shared with AuthGate) ────────────────────────────── */
const LEGAL = {
  terms: {
    title: 'Terms of Service',
    date: '14 February 2026 · v1.0',
    items: [
      ['Operator', 'KURO OS is operated by Henry George Lowe trading as KURO Technologies, ABN 45 340 322 909, Melbourne, Victoria, Australia.'],
      ['Acceptance', 'By accessing KURO OS you agree to these Terms. You must be at least 18 years of age.'],
      ['Service', '"Sovereign" means AI models run on dedicated hardware, not shared with training pipelines. Infrastructure: Cloudflare (CDN/security), Stripe (payments), TensorDock (compute).'],
      ['Accounts', 'Access is via token-based authentication. You are responsible for your token\'s confidentiality.'],
      ['AI Outputs', 'AI outputs are probabilistic and may contain errors. They do not constitute professional advice (legal, medical, financial, etc).'],
      ['Data', 'Conversations are not used to train AI models. Data processed on US inference servers. See Privacy Policy.'],
      ['Billing', 'Paid plans billed monthly via Stripe. Cancel anytime — no partial refunds after the billing period starts.'],
      ['Australian Consumer Law', 'Nothing in these Terms excludes rights under the Australian Consumer Law (CCA 2010).'],
      ['Liability', 'Aggregate liability is limited to fees paid in the preceding 12 months.'],
      ['Law', 'Governed by the laws of Victoria, Australia. Contact: hi@kuroglass.net'],
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    date: '14 February 2026 · v1.0',
    items: [
      ['Controller', 'Henry George Lowe trading as KURO Technologies, ABN 45 340 322 909, Melbourne, Australia. hi@kuroglass.net'],
      ['What We Collect', 'Access tokens (auth), email address (token delivery), conversation data (inference service), payment metadata (via Stripe), IP/request data (via Cloudflare).'],
      ['What We Don\'t Do', 'We do not sell your data, use conversations to train AI models, or use advertising or tracking cookies.'],
      ['Storage', 'AI inference and conversation data on dedicated GPU servers in the United States (TensorDock). Payments via Stripe (global). CDN/security via Cloudflare (global).'],
      ['Third Parties', 'Cloudflare (CDN/DDoS/SSL), Stripe (payments), Brevo (transactional email). No data brokers or advertisers.'],
      ['Retention', 'Conversations: 90 days. Billing records: 7 years (ATO requirements). Access tokens: until revoked.'],
      ['Your Rights', 'Australian Privacy Act 1988: access, correct, or delete your data. Email hi@kuroglass.net. Response within 30 days.'],
      ['Complaints', 'Contact the OAIC at oaic.gov.au or 1300 363 992 if you believe we have breached the Australian Privacy Principles.'],
    ]
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   LEGAL VIEWER — inline document viewer
   ═══════════════════════════════════════════════════════════════════════ */
function LegalViewer({ doc, onBack, onSwitch }) {
  const d = LEGAL[doc] || LEGAL.terms;
  const otherDoc = doc === 'terms' ? 'privacy' : 'terms';
  return (
    <div className="lp-legal">
      <div className="lp-legal-nav">
        <button onClick={onBack}>← Back</button>
        <button className="lp-legal-switch" onClick={onSwitch}>{otherDoc === 'terms' ? 'Terms' : 'Privacy'} →</button>
      </div>
      <h2 className="lp-legal-title">{d.title}</h2>
      <p className="lp-legal-date">{d.date}</p>
      <div className="lp-legal-body">
        {d.items.map(([h, t], i) => (
          <div key={i} className="lp-legal-item"><strong>{h}.</strong> {t}</div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOGIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */
export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signup, login, verifyEmail, forgotPassword, resetPassword, tokenLogin, authError, clearAuthError, user, loading: authLoading } = useAuthStore();

  // Redirect to /app if already authenticated
  useEffect(() => {
    if (user && !authLoading) navigate('/app', { replace: true });
  }, [user, authLoading, navigate]);

  // Check for ?doc param to open legal viewer directly
  const initialDoc = searchParams.get('doc');
  const redirectTo = searchParams.get('redirect') || '/app';

  const [view, setView] = useState(initialDoc ? 'legal' : 'form'); // 'form' | 'legal'
  const [legalDoc, setLegalDoc] = useState(initialDoc || 'terms');
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', code: '', newPassword: '', token: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const inputRef = useRef(null);
  const submittingRef = useRef(false);

  useEffect(() => { if (view === 'form') setTimeout(() => inputRef.current?.focus(), 150); }, [mode, view]);

  const reset = () => { setError(''); setMessage(''); };
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const switchMode = (m) => { setMode(m); reset(); };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    reset(); setBusy(true);
    if (['signup', 'token'].includes(mode) && !agreeTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      setBusy(false); submittingRef.current = false; return;
    }
    try {
      if (mode === 'token') {
        if (!form.token.trim()) { setError('Enter your access token.'); setBusy(false); submittingRef.current = false; return; }
        const r = await tokenLogin(form.token.trim());
        if (r.success) { navigate(redirectTo, { replace: true }); } else setError(r.error || 'Invalid token.');
      } else if (mode === 'reset') {
        const r = await resetPassword(form.email, form.code, form.newPassword);
        if (r.success) { setMode('login'); setError(''); setMessage('Password reset — sign in with your new password.'); }
        else setError(r.error);
      } else if (mode === 'forgot') {
        const r = await forgotPassword(form.email);
        r.success ? (setMessage('Check email for reset code.'), setMode('reset')) : setError(r.error);
      } else if (mode === 'otp') {
        const r = await verifyEmail(form.code);
        if (r.success) navigate(redirectTo, { replace: true }); else setError(r.error);
      } else if (mode === 'signup') {
        const r = await signup(form.email, form.password, form.name);
        if (r.success) { if (r.devToken) setAccessToken(r.devToken); setMode('email-sent'); setMessage(''); }
        else setError(r.error);
      } else {
        const r = await login(form.email, form.password);
        if (r.success) navigate(redirectTo, { replace: true }); else setError(r.error);
      }
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    setBusy(false); submittingRef.current = false;
  };

  const onKey = e => { if (e.key === 'Enter') submit(); };
  const showOAuth = ['signup', 'login'].includes(mode);
  const showAgree = ['signup', 'token'].includes(mode);

  /* ── Legal view ── */
  if (view === 'legal') return (
    <div className="lp-root">
      <DesktopBackground />
      <CookieBanner />
      <div className="lp-center">
        <div className="lp-panel lp-panel-legal">
          <LegalViewer
            doc={legalDoc}
            onBack={() => setView('form')}
            onSwitch={() => setLegalDoc(d => d === 'terms' ? 'privacy' : 'terms')}
          />
        </div>
        <Link to="/" className="lp-back">← kuroglass.net</Link>
      </div>
      <LoginStyles />
    </div>
  );

  return (
    <div className="lp-root">
      <DesktopBackground />
      <CookieBanner />
      <div className="lp-center">
        <div className="lp-panel">
          {/* Header */}
          <div className="lp-header">
            <span className="lp-wordmark">KURO OS</span>
            <span className="lp-build">Build 0.9.x</span>
          </div>

          {/* OAuth error from redirect */}
          {authError && (
            <div className="lp-oauth-error">
              {authError === 'oauth_not_configured' ? 'Social login not enabled — use email.' : `Auth failed: ${authError.replace(/_/g, ' ')}`}
              <button onClick={clearAuthError}>✕</button>
            </div>
          )}

          {/* Email sent / token display */}
          {mode === 'email-sent' && (
            <div className="lp-email-sent">
              {accessToken ? (
                <>
                  <h3>Your access token</h3>
                  <p className="lp-hint">Email delivery unavailable — copy your token now:</p>
                  <div className="lp-token-display">
                    <span className="lp-token-value">{accessToken}</span>
                    <button className="lp-token-copy" onClick={() => navigator.clipboard?.writeText(accessToken)} title="Copy">⌘</button>
                  </div>
                  <button className="lp-submit" onClick={() => { upd('token', accessToken); switchMode('token'); }}>Sign in with this token →</button>
                </>
              ) : (
                <>
                  <h3>Check your email</h3>
                  <p className="lp-hint">We sent your KURO access token to <strong>{form.email}</strong></p>
                  <button className="lp-submit" onClick={() => switchMode('token')}>Enter access token →</button>
                </>
              )}
              <button className="lp-nav-link" onClick={() => switchMode('login')}>← Back to sign in</button>
            </div>
          )}

          {/* Auth form */}
          {mode !== 'email-sent' && (
            <div className="lp-form">
              {showOAuth && (
                <>
                  <button className="lp-oauth" onClick={() => window.location.href = '/api/auth/google'} disabled={busy}>
                    <GoogleIcon /> Continue with Google
                  </button>
                  <button className="lp-oauth" onClick={() => window.location.href = '/api/auth/github'} disabled={busy}>
                    <GitHubIcon /> Continue with GitHub
                  </button>
                  <div className="lp-divider"><span>or</span></div>
                </>
              )}

              {mode === 'token' && <p className="lp-hint">Enter the KURO access token from your email or subscription.</p>}

              {mode === 'signup' && (
                <input type="text" placeholder="Full name" value={form.name} ref={inputRef}
                  onChange={e => upd('name', e.target.value)} className="lp-input" autoComplete="name" onKeyDown={onKey} />
              )}
              {['signup', 'login', 'forgot'].includes(mode) && (
                <input type="email" placeholder="Email address" value={form.email}
                  ref={mode !== 'signup' ? inputRef : null}
                  onChange={e => upd('email', e.target.value)} className="lp-input" autoComplete="email" onKeyDown={onKey} />
              )}
              {['signup', 'login'].includes(mode) && (
                <input type="password" placeholder={mode === 'signup' ? 'Create password (8+ chars)' : 'Password'}
                  value={form.password} onChange={e => upd('password', e.target.value)}
                  className="lp-input" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} onKeyDown={onKey} />
              )}
              {mode === 'token' && (
                <input type="password" placeholder="Access token" value={form.token} ref={inputRef}
                  onChange={e => upd('token', e.target.value)} className="lp-input lp-mono"
                  autoComplete="off" autoCapitalize="off" spellCheck="false" onKeyDown={onKey} />
              )}
              {mode === 'otp' && (
                <>
                  <p className="lp-hint">6-digit code sent to <strong>{form.email}</strong></p>
                  <input type="text" inputMode="numeric" placeholder="000000" value={form.code} maxLength={6} ref={inputRef}
                    onChange={e => upd('code', e.target.value.replace(/\D/g, ''))}
                    className="lp-input lp-otp" autoComplete="one-time-code" onKeyDown={onKey} />
                </>
              )}
              {mode === 'forgot' && <p className="lp-hint">We'll send a reset code to your email.</p>}
              {mode === 'reset' && (
                <>
                  {form.email && <p className="lp-hint">Code sent to <strong>{form.email}</strong></p>}
                  <input type="text" placeholder="Reset code" value={form.code} maxLength={6} ref={inputRef}
                    onChange={e => upd('code', e.target.value.replace(/\D/g, ''))} className="lp-input" onKeyDown={onKey} />
                  <input type="password" placeholder="New password (8+ chars)" value={form.newPassword}
                    onChange={e => upd('newPassword', e.target.value)} className="lp-input" autoComplete="new-password" onKeyDown={onKey} />
                </>
              )}

              {showAgree && (
                <label className="lp-check">
                  <input type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                  <span>
                    I agree to the{' '}
                    <button type="button" className="lp-check-link" onClick={() => { setLegalDoc('terms'); setView('legal'); }}>Terms</button>
                    {' '}and{' '}
                    <button type="button" className="lp-check-link" onClick={() => { setLegalDoc('privacy'); setView('legal'); }}>Privacy Policy</button>
                  </span>
                </label>
              )}

              <button className="lp-submit" onClick={submit} disabled={busy}>
                {busy
                  ? <><span className="lp-spinner" /><span className="lp-busy-label">{
                      mode === 'signup' ? 'Creating account…' :
                      mode === 'reset'  ? 'Updating credentials…' :
                      mode === 'forgot' ? 'Sending code…' : ''
                    }</span></>
                  : mode === 'signup'  ? 'Create Account'
                  : mode === 'login'   ? 'Sign In'
                  : mode === 'token'   ? 'Launch KURO'
                  : mode === 'otp'     ? 'Verify Email'
                  : mode === 'forgot'  ? 'Send Reset Code'
                  :                     'Reset Password'}
              </button>

              {error   && <div className="lp-error">{error}</div>}
              {message && <div className="lp-msg">{message}</div>}

              <div className="lp-nav">
                {mode === 'signup' && (
                  <>
                    <button onClick={() => switchMode('login')}>Already have an account? <strong>Sign in</strong></button>
                    <button onClick={() => switchMode('token')} className="lp-token-link"><KeyIcon /> Have an access token?</button>
                  </>
                )}
                {mode === 'login' && (
                  <>
                    <button onClick={() => switchMode('signup')}>Need an account? <strong>Sign up</strong></button>
                    <button onClick={() => switchMode('forgot')}>Forgot password?</button>
                    <button onClick={() => switchMode('token')} className="lp-token-link"><KeyIcon /> Have an access token?</button>
                  </>
                )}
                {mode === 'token' && <button onClick={() => switchMode('signup')}>← Back to create account</button>}
                {['forgot', 'reset', 'otp'].includes(mode) && <button onClick={() => switchMode('login')}>← Back to sign in</button>}
              </div>
            </div>
          )}
        </div>
        <Link to="/" className="lp-back">← kuroglass.net</Link>
      </div>
      <LoginStyles />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */
function LoginStyles() {
  return (
    <style>{`
.lp-root {
  width: 100%; min-height: 100vh; min-height: 100dvh;
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
  position: relative; overflow: hidden;
}
.lp-center {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  width: 100%; max-width: 400px; padding: 24px;
}
.lp-panel {
  width: 100%;
  padding: 32px 28px;
  background: var(--kuro-hero-bg);
  border: 1px solid var(--kuro-hero-border);
  border-radius: 20px;
  backdrop-filter: blur(50px) saturate(1.4) brightness(1.02);
  -webkit-backdrop-filter: blur(50px) saturate(1.4) brightness(1.02);
  box-shadow:
    0 1px 3px rgba(0,0,0,0.3),
    0 12px 40px -8px rgba(0,0,0,0.35),
    inset 0 0.5px 0 var(--kuro-hero-highlight);
  animation: lp-in 350ms cubic-bezier(0, 0, 0.2, 1) both;
}
.lp-panel-legal {
  max-height: 80vh; overflow-y: auto;
}
@keyframes lp-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

/* Header */
.lp-header { text-align: center; margin-bottom: 24px; }
.lp-wordmark {
  display: block;
  font-size: 20px; font-weight: 300; letter-spacing: 4px;
  color: rgba(255,255,255,0.92);
}
.lp-build {
  display: block;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px; color: rgba(255,255,255,0.22);
  margin-top: 4px;
}

/* OAuth error */
.lp-oauth-error {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; margin-bottom: 8px;
  background: rgba(255,165,0,0.06); border: 1px solid rgba(255,165,0,0.12);
  border-radius: 8px; color: rgba(255,165,0,0.85); font-size: 11px;
}
.lp-oauth-error button { background: none; border: none; color: rgba(255,165,0,0.5); cursor: pointer; font-size: 13px; }

/* Form */
.lp-form { display: flex; flex-direction: column; gap: 9px; }

.lp-oauth {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 12px; min-height: 44px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px; color: rgba(255,255,255,0.88);
  font-size: 13px; font-weight: 500; font-family: inherit;
  cursor: pointer; transition: background 150ms, border-color 150ms;
}
.lp-oauth:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); }
.lp-oauth:active { transform: scale(0.985); }
.lp-oauth:disabled { opacity: 0.5; cursor: not-allowed; }

.lp-divider {
  display: flex; align-items: center; gap: 10px;
  color: rgba(255,255,255,0.18); font-size: 11px;
}
.lp-divider::before, .lp-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.05); }

.lp-input {
  width: 100%; padding: 12px 14px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px; color: rgba(255,255,255,0.9);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 150ms, box-shadow 150ms;
}
.lp-input:focus { border-color: var(--kuro-entry-accent-focus); box-shadow: 0 0 0 3px var(--kuro-entry-accent-glow); }
.lp-input::placeholder { color: rgba(255,255,255,0.16); }
.lp-mono { font-family: 'SF Mono', ui-monospace, monospace; letter-spacing: 0.5px; }
.lp-otp { text-align: center; font-size: 24px; letter-spacing: 8px; font-family: 'SF Mono', ui-monospace, monospace; }

.lp-hint { font-size: 12px; color: rgba(255,255,255,0.4); text-align: center; line-height: 1.4; margin: 0; }
.lp-hint strong { color: rgba(255,255,255,0.8); font-weight: 600; }

/* Terms checkbox */
.lp-check { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; color: rgba(255,255,255,0.4); cursor: pointer; user-select: none; }
.lp-check input { width: 15px; height: 15px; accent-color: var(--kuro-entry-accent); margin-top: 1px; flex-shrink: 0; }
.lp-check-link { background: none; border: none; color: var(--kuro-entry-accent-link); cursor: pointer; font-size: 12px; font-family: inherit; padding: 0; text-decoration: underline; }
.lp-check-link:hover { color: var(--kuro-entry-accent); }

/* Submit */
.lp-submit {
  width: 100%; padding: 12px; min-height: 44px;
  background: var(--kuro-entry-accent-glass); border: 1px solid var(--kuro-entry-accent-border);
  border-radius: 12px; color: rgba(255,255,255,0.9);
  font-size: 14px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: background 200ms, transform 150ms;
}
.lp-submit:hover { background: var(--kuro-entry-accent-hover); transform: translateY(-1px); }
.lp-submit:active { transform: scale(0.985); }
.lp-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.lp-spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%; animation: lpSpin 0.7s linear infinite; vertical-align: middle; }
@keyframes lpSpin { to { transform: rotate(360deg); } }
.lp-busy-label { margin-left: 8px; font-size: 13px; vertical-align: middle; opacity: 0.7; }

/* Error / success */
.lp-error { padding: 8px 12px; background: rgba(255,55,95,0.05); border: 1px solid rgba(255,55,95,0.1); border-radius: 8px; color: #ff375f; font-size: 12px; text-align: center; }
.lp-msg   { padding: 8px 12px; background: rgba(48,209,88,0.05); border: 1px solid rgba(48,209,88,0.1); border-radius: 8px; color: #30d158; font-size: 12px; text-align: center; }

/* Nav links */
.lp-nav { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 4px; }
.lp-nav button { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 12px; font-family: inherit; cursor: pointer; transition: color 150ms; display: inline-flex; align-items: center; gap: 5px; }
.lp-nav button:hover { color: rgba(255,255,255,0.55); }
.lp-nav button strong { color: var(--kuro-entry-accent-link); font-weight: 600; }
.lp-token-link { color: var(--kuro-entry-accent-muted) !important; opacity: 0.55; }
.lp-token-link:hover { color: var(--kuro-entry-accent-link) !important; opacity: 1; }

/* Email sent */
.lp-email-sent { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.lp-email-sent h3 { font-size: 17px; font-weight: 500; color: #fff; margin: 0; }
.lp-token-display { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.35); border: 1px solid var(--kuro-entry-accent-border); border-radius: 12px; padding: 10px 14px; width: 100%; }
.lp-token-value { flex: 1; font-family: 'SF Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 2px; word-break: break-all; text-align: left; }
.lp-token-copy { background: var(--kuro-entry-accent-glow); border: 1px solid var(--kuro-entry-accent-border); border-radius: 6px; color: var(--kuro-entry-accent-link); cursor: pointer; font-size: 15px; padding: 4px 8px; flex-shrink: 0; transition: background 150ms; }
.lp-token-copy:hover { background: var(--kuro-entry-accent-glass); }
.lp-nav-link { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 12px; cursor: pointer; font-family: inherit; transition: color 150ms; }
.lp-nav-link:hover { color: rgba(255,255,255,0.5); }

/* Back to homepage */
.lp-back {
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
  font-size: 11px; color: rgba(255,255,255,0.2);
  text-decoration: none; transition: color 150ms;
}
.lp-back:hover { color: rgba(255,255,255,0.4); }

/* Legal viewer */
.lp-legal { padding: 4px 0; }
.lp-legal-nav { display: flex; justify-content: space-between; margin-bottom: 16px; }
.lp-legal-nav button { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 12px; font-family: inherit; cursor: pointer; transition: color 150ms; padding: 0; }
.lp-legal-nav button:hover { color: rgba(255,255,255,0.7); }
.lp-legal-switch { color: var(--kuro-entry-accent-muted) !important; }
.lp-legal-switch:hover { color: var(--kuro-entry-accent-link) !important; }
.lp-legal-title { font-size: 17px; font-weight: 500; color: #fff; margin: 0 0 4px; }
.lp-legal-date { font-size: 11px; color: rgba(255,255,255,0.28); margin: 0 0 16px; }
.lp-legal-body { }
.lp-legal-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.6; }
.lp-legal-item strong { color: rgba(255,255,255,0.85); margin-right: 3px; }

/* ─── MOBILE ─────────────────────────────────────────────────────── */
@media (max-width: 480px) {
  .lp-center { padding: 16px; }
  .lp-panel { padding: 24px 20px; border-radius: 16px; }
  .lp-input { font-size: 16px; /* prevent iOS zoom */ }
}

/* ─── REDUCED MOTION ─────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .lp-panel { animation: none !important; }
}
    `}</style>
  );
}
