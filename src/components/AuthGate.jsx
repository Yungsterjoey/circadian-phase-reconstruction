/**
 * KURO :: AUTH GATE v9.2 — Integrated Landing + Auth
 * stage: 'landing' → marketing hero with auth CTAs (KURO/PS1 aesthetic)
 *        'auth'    → signup / login / token / forgot / reset / otp
 *        'legal'   → inline Terms or Privacy (compact)
 *
 * Auth logic unchanged from v9.1. Only presentation layer updated.
 */
import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

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

/* ─── 3D Cube ─────────────────────────────────────────────────────────── */
const GlassCube = ({ size = 48 }) => (
  <div className="ag-cube-wrap" style={{ width: size, height: size, perspective: 600 }}>
    <div className="ag-cube-inner" style={{ width: size, height: size }}>
      {['ft','bk','rt','lt','tp','bt'].map(f => (
        <div key={f} className={`ag-cf ${f}`} style={{ width: size, height: size, '--h': `${size/2}px` }} />
      ))}
    </div>
  </div>
);

/* ─── Pricing tiers (compact) ─────────────────────────────────────────── */
const TIERS = [
  { id: 'free',      label: 'FREE', price: '$0',  period: '',    quota: '25/wk',    stripe: null,                                                                featured: false },
  { id: 'pro',       label: 'PRO',  price: '$19', period: '/mo', quota: '1,400/wk', stripe: 'https://buy.stripe.com/cNi5kDepSaFPaCyeJd5sA00', featured: true  },
  { id: 'sovereign', label: 'SOV',  price: '$49', period: '/mo', quota: '3,500/wk', stripe: 'https://buy.stripe.com/cNi8wPgy0bJTdOK44z5sA01', featured: false },
];

/* ─── Legal summaries (full docs in About app post-login) ─────────────── */
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
   LANDING STAGE — Marketing hero + auth CTAs
   KURO/Sony PS1 aesthetic: monochrome base, purple accent, scanline separators
   ═══════════════════════════════════════════════════════════════════════ */
function LandingStage({ onAuth, onLegal, authError, clearAuthError }) {
  return (
    <div className="ag-landing">
      {/* Hero row: cube + wordmark */}
      <div className="ag-l-hero">
        <GlassCube size={46} />
        <div className="ag-l-wordmark">
          <span className="ag-l-kuro">KURO</span>
          <span className="ag-l-os">.OS</span>
        </div>
      </div>
      <p className="ag-l-tag">SOVEREIGN INTELLIGENCE PLATFORM</p>

      {/* Feature list */}
      <div className="ag-scanline" />
      <ul className="ag-l-features">
        <li><span>▸</span>12-LAYER COGNITIVE PIPELINE</li>
        <li><span>▸</span>DEDICATED GPU · NO SHARING</li>
        <li><span>▸</span>ED25519 CRYPTOGRAPHIC AUDIT</li>
        <li><span>▸</span>CONVERSATIONS NEVER TRAIN AI</li>
      </ul>
      <div className="ag-scanline" />

      {/* Compare strip */}
      <div className="ag-l-compare">
        <div className="ag-l-col ag-l-col-them">
          <div className="ag-l-col-label">CLOUD LLMS</div>
          <div className="ag-l-col-item">Your data trains models</div>
          <div className="ag-l-col-item">Rate limits imposed</div>
          <div className="ag-l-col-item">No audit trail</div>
        </div>
        <div className="ag-l-col-vs">VS</div>
        <div className="ag-l-col ag-l-col-us">
          <div className="ag-l-col-label">KURO OS</div>
          <div className="ag-l-col-item">Dedicated inference</div>
          <div className="ag-l-col-item">No data harvesting</div>
          <div className="ag-l-col-item">Signed audit chain</div>
        </div>
      </div>
      <div className="ag-scanline" />

      {/* Pricing grid */}
      <div className="ag-l-tiers">
        {TIERS.map(t => (
          <div key={t.id} className={`ag-l-tier${t.featured ? ' ag-l-tier-pro' : ''}`}>
            <div className="ag-l-tier-label">{t.label}</div>
            <div className="ag-l-tier-price">{t.price}<span>{t.period}</span></div>
            <div className="ag-l-tier-quota">{t.quota}</div>
            {t.stripe ? (
              <a className="ag-l-tier-link" href={t.stripe} target="_blank" rel="noopener">Subscribe</a>
            ) : (
              <button className="ag-l-tier-link" onClick={() => onAuth('signup')}>Try Free</button>
            )}
          </div>
        ))}
      </div>
      <div className="ag-scanline" />

      {/* OAuth error */}
      {authError && (
        <div className="ag-oauth-error">
          {authError === 'oauth_not_configured' ? 'Social login not enabled — use email.' : `Auth failed: ${authError.replace(/_/g, ' ')}`}
          <button onClick={clearAuthError}>✕</button>
        </div>
      )}

      {/* CTAs */}
      <div className="ag-l-ctas">
        <button className="ag-btn ag-l-primary" onClick={() => onAuth('signup')}>Create Account</button>
        <button className="ag-btn ag-l-secondary" onClick={() => onAuth('login')}>Sign In</button>
      </div>

      {/* Legal footer */}
      <div className="ag-l-legal">
        <button onClick={() => onLegal('terms')}>Terms</button>
        <span>·</span>
        <button onClick={() => onLegal('privacy')}>Privacy</button>
        <span>·</span>
        <span className="ag-l-entity">KURO Technologies · ABN 45 340 322 909</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LEGAL STAGE — Compact inline document viewer
   ═══════════════════════════════════════════════════════════════════════ */
function LegalStage({ doc, otherDoc, onBack, onSwitch }) {
  const d = LEGAL[doc] || LEGAL.terms;
  return (
    <div className="ag-legal-view">
      <div className="ag-legal-nav">
        <button className="ag-legal-back" onClick={onBack}>← Back</button>
        <button className="ag-legal-switch" onClick={onSwitch}>{otherDoc === 'terms' ? 'Terms' : 'Privacy'} →</button>
      </div>
      <div className="ag-legal-head">
        <h2>{d.title}</h2>
        <p className="ag-legal-date">{d.date}</p>
      </div>
      <div className="ag-legal-body">
        {d.items.map(([h, t], i) => (
          <div key={i} className="ag-legal-item">
            <strong>{h}.</strong> {t}
          </div>
        ))}
        <div className="ag-legal-note">
          Full legal documents are available in the KURO About app after signing in.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function AuthGate() {
  const [stage, setStage] = useState('landing');  // 'landing' | 'auth' | 'legal'
  const [legalDoc, setLegalDoc] = useState('terms');
  const [mode, setMode] = useState('signup');
  const [form, setForm] = useState({ name: '', email: '', password: '', code: '', newPassword: '', token: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const { signup, login, verifyEmail, forgotPassword, resetPassword, tokenLogin, authError, clearAuthError } = useAuthStore();

  useEffect(() => { if (stage === 'auth') setTimeout(() => inputRef.current?.focus(), 150); }, [mode, stage]);

  const reset = () => { setError(''); setMessage(''); };
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const switchMode = (m) => { setMode(m); reset(); };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    reset(); setLoading(true);
    if (['signup', 'token'].includes(mode) && !agreeTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      setLoading(false); submittingRef.current = false; return;
    }
    try {
      if (mode === 'token') {
        if (!form.token.trim()) { setError('Enter your access token.'); setLoading(false); submittingRef.current = false; return; }
        const r = await tokenLogin(form.token.trim());
        if (r.success) window.location.reload(); else setError(r.error || 'Invalid token.');
      } else if (mode === 'reset') {
        const r = await resetPassword(form.email, form.code, form.newPassword);
        r.success ? (setMessage('Password reset!'), switchMode('login')) : setError(r.error);
      } else if (mode === 'forgot') {
        const r = await forgotPassword(form.email);
        r.success ? (setMessage('Check email for reset code.'), setMode('reset')) : setError(r.error);
      } else if (mode === 'otp') {
        const r = await verifyEmail(form.code);
        r.success ? window.location.reload() : setError(r.error);
      } else if (mode === 'signup') {
        const r = await signup(form.email, form.password, form.name);
        if (r.success) { if (r.devToken) setAccessToken(r.devToken); setMode('email-sent'); setMessage(''); }
        else setError(r.error);
      } else {
        const r = await login(form.email, form.password);
        r.success ? window.location.reload() : setError(r.error);
      }
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    setLoading(false); submittingRef.current = false;
  };

  const onKey = e => { if (e.key === 'Enter') submit(); };
  const showOAuth = ['signup', 'login'].includes(mode);
  const showAgree = ['signup', 'token'].includes(mode);

  /* ── Landing ── */
  if (stage === 'landing') return (
    <>
      <LandingStage
        onAuth={(m) => { setMode(m); setStage('auth'); }}
        onLegal={(d) => { setLegalDoc(d); setStage('legal'); }}
        authError={authError}
        clearAuthError={clearAuthError}
      />
      <AuthGateStyles />
    </>
  );

  /* ── Legal ── */
  if (stage === 'legal') return (
    <>
      <LegalStage
        doc={legalDoc}
        otherDoc={legalDoc === 'terms' ? 'privacy' : 'terms'}
        onBack={() => setStage('landing')}
        onSwitch={() => setLegalDoc(d => d === 'terms' ? 'privacy' : 'terms')}
      />
      <AuthGateStyles />
    </>
  );

  /* ── Auth form ── */
  return (
    <div className="ag-inner">
      {/* Mini hero */}
      <div className="ag-auth-hero">
        <GlassCube size={32} />
        <div className="ag-l-wordmark ag-wm-sm">
          <span className="ag-l-kuro">KURO</span>
          <span className="ag-l-os">.OS</span>
        </div>
      </div>

      <div className="ag-body">
        {/* OAuth buttons */}
        {showOAuth && (
          <>
            <button className="ag-btn ag-oauth" onClick={() => window.location.href = '/api/auth/google'} disabled={loading}>
              <GoogleIcon /> Continue with Google
            </button>
            <button className="ag-btn ag-oauth" onClick={() => window.location.href = '/api/auth/github'} disabled={loading}>
              <GitHubIcon /> Continue with GitHub
            </button>
            <div className="ag-divider"><span>or</span></div>
          </>
        )}

        {/* Token hint */}
        {mode === 'token' && (
          <p className="ag-hint">Enter the KURO access token from your email or subscription.</p>
        )}

        {/* Email sent / token display */}
        {mode === 'email-sent' && (
          <div className="ag-email-sent">
            {accessToken ? (
              <>
                <div className="ag-sent-icon">⚡</div>
                <h3 className="ag-sent-title">Your access token</h3>
                <p className="ag-sent-sub" style={{ marginBottom: 4 }}>Email delivery unavailable — copy your token now:</p>
                <div className="ag-token-display">
                  <span className="ag-token-value">{accessToken}</span>
                  <button className="ag-token-copy" onClick={() => navigator.clipboard?.writeText(accessToken)} title="Copy">⌘</button>
                </div>
                <button className="ag-btn ag-submit" onClick={() => { upd('token', accessToken); switchMode('token'); }}>
                  Sign in with this token →
                </button>
              </>
            ) : (
              <>
                <div className="ag-sent-icon">✉</div>
                <h3 className="ag-sent-title">Check your email</h3>
                <p className="ag-sent-sub">We sent your KURO access token to<br /><strong>{form.email}</strong></p>
                <button className="ag-btn ag-submit" onClick={() => switchMode('token')}>
                  Enter access token →
                </button>
              </>
            )}
            <button onClick={() => switchMode('login')} className="ag-nav-link">← Back to sign in</button>
          </div>
        )}

        {/* Auth form fields */}
        {mode !== 'email-sent' && (
          <div className="ag-form">
            {mode === 'signup' && (
              <input type="text" placeholder="Full name" value={form.name} ref={inputRef}
                onChange={e => upd('name', e.target.value)} className="ag-input" autoComplete="name" onKeyDown={onKey} />
            )}
            {['signup', 'login', 'forgot'].includes(mode) && (
              <input type="email" placeholder="Email address" value={form.email}
                ref={mode !== 'signup' ? inputRef : null}
                onChange={e => upd('email', e.target.value)} className="ag-input" autoComplete="email" onKeyDown={onKey} />
            )}
            {['signup', 'login'].includes(mode) && (
              <input type="password" placeholder={mode === 'signup' ? 'Create password (8+ chars)' : 'Password'}
                value={form.password} onChange={e => upd('password', e.target.value)}
                className="ag-input" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} onKeyDown={onKey} />
            )}
            {mode === 'token' && (
              <input type="password" placeholder="Access token" value={form.token} ref={inputRef}
                onChange={e => upd('token', e.target.value)} className="ag-input ag-mono"
                autoComplete="off" autoCapitalize="off" spellCheck="false" onKeyDown={onKey} />
            )}
            {mode === 'otp' && (
              <>
                <p className="ag-hint">6-digit code sent to <strong>{form.email}</strong></p>
                <input type="text" inputMode="numeric" placeholder="000000" value={form.code} maxLength={6} ref={inputRef}
                  onChange={e => upd('code', e.target.value.replace(/\D/g, ''))}
                  className="ag-input ag-otp" autoComplete="one-time-code" onKeyDown={onKey} />
              </>
            )}
            {mode === 'forgot' && <p className="ag-hint">We'll send a reset code to your email.</p>}
            {mode === 'reset' && (
              <>
                <input type="text" placeholder="Reset code" value={form.code} maxLength={6} ref={inputRef}
                  onChange={e => upd('code', e.target.value.replace(/\D/g, ''))} className="ag-input" onKeyDown={onKey} />
                <input type="password" placeholder="New password (8+ chars)" value={form.newPassword}
                  onChange={e => upd('newPassword', e.target.value)} className="ag-input" autoComplete="new-password" onKeyDown={onKey} />
              </>
            )}

            {showAgree && (
              <label className="ag-check">
                <input type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <button type="button" className="ag-check-link" onClick={() => { setLegalDoc('terms'); setStage('legal'); }}>Terms</button>
                  {' '}and{' '}
                  <button type="button" className="ag-check-link" onClick={() => { setLegalDoc('privacy'); setStage('legal'); }}>Privacy Policy</button>
                </span>
              </label>
            )}

            <button className="ag-btn ag-submit" onClick={submit} disabled={loading}>
              {loading ? <span className="ag-spinner" /> :
                mode === 'signup'  ? 'Create Account' :
                mode === 'login'   ? 'Sign In' :
                mode === 'token'   ? 'Launch KURO' :
                mode === 'otp'     ? 'Verify Email' :
                mode === 'forgot'  ? 'Send Reset Code' : 'Reset Password'}
            </button>

            {error   && <div className="ag-error">{error}</div>}
            {message && <div className="ag-msg">{message}</div>}

            <div className="ag-nav">
              {mode === 'signup' && (
                <>
                  <button onClick={() => switchMode('login')}>Already have an account? <strong>Sign in</strong></button>
                  <button onClick={() => switchMode('token')} className="ag-token-link"><KeyIcon /> Have an access token?</button>
                </>
              )}
              {mode === 'login' && (
                <>
                  <button onClick={() => switchMode('signup')}>Need an account? <strong>Sign up</strong></button>
                  <button onClick={() => switchMode('forgot')}>Forgot password?</button>
                  <button onClick={() => switchMode('token')} className="ag-token-link"><KeyIcon /> Have an access token?</button>
                </>
              )}
              {mode === 'token' && <button onClick={() => switchMode('signup')}>← Back to create account</button>}
              {['forgot', 'reset', 'otp'].includes(mode) && <button onClick={() => switchMode('login')}>← Back to sign in</button>}
              <button onClick={() => { setStage('landing'); reset(); }} className="ag-back-landing">← Back to KURO</button>
            </div>
          </div>
        )}
      </div>
      <AuthGateStyles />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════ */
function AuthGateStyles() {
  return (
    <style>{`
/* ─── Base ───────────────────────────────────────────────────────────── */
.ag-inner, .ag-landing, .ag-legal-view {
  box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}
.ag-inner *, .ag-landing *, .ag-legal-view * { box-sizing: border-box; }
.ag-btn { touch-action: manipulation; -webkit-tap-highlight-color: transparent; font-family: inherit; cursor: pointer; border: none; }

/* ─── 3D Cube ─────────────────────────────────────────────────────────── */
.ag-cube-wrap { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ag-cube-inner { position: relative; transform-style: preserve-3d; animation: agcRot 20s linear infinite; }
@keyframes agcRot { from { transform: rotateX(-20deg) rotateY(-30deg); } to { transform: rotateX(-20deg) rotateY(330deg); } }
.ag-cf { position: absolute; background: linear-gradient(135deg, rgba(91,33,182,0.35), rgba(76,29,149,0.25) 50%, rgba(49,10,101,0.45)); border: 1px solid rgba(139,92,246,0.25); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.ag-cf.ft { transform: translateZ(var(--h)); }
.ag-cf.bk { transform: rotateY(180deg) translateZ(var(--h)); }
.ag-cf.rt { transform: rotateY(90deg) translateZ(var(--h)); }
.ag-cf.lt { transform: rotateY(-90deg) translateZ(var(--h)); }
.ag-cf.tp { transform: rotateX(90deg) translateZ(var(--h)); }
.ag-cf.bt { transform: rotateX(-90deg) translateZ(var(--h)); }
@media (prefers-reduced-motion: reduce) { .ag-cube-inner { animation: none; transform: rotateX(-20deg) rotateY(-30deg); } }

/* ═══ LANDING STAGE ═══════════════════════════════════════════════════ */
.ag-landing {
  padding: 20px 20px 14px;
  display: flex; flex-direction: column; gap: 0;
  overflow-y: auto; max-height: 100%;
}

/* Hero row */
.ag-l-hero { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
.ag-l-wordmark { display: flex; flex-direction: column; }
.ag-l-kuro { font-size: 32px; font-weight: 200; letter-spacing: 10px; color: rgba(255,255,255,0.95); line-height: 1; }
.ag-l-os { font-size: 16px; font-weight: 500; letter-spacing: 5px; color: #a855f7; line-height: 1.2; }
.ag-l-tag { font-size: 9px; font-weight: 500; letter-spacing: 3.5px; text-transform: uppercase; color: rgba(255,255,255,0.3); margin: 0 0 12px; }

/* Scanline separator — PS1 aesthetic: thin low-opacity rule */
.ag-scanline { height: 1px; background: rgba(255,255,255,0.06); margin: 10px 0; }

/* Feature list */
.ag-l-features { list-style: none; padding: 0; margin: 0 0 0; display: flex; flex-direction: column; gap: 5px; }
.ag-l-features li { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 500; letter-spacing: 1.5px; color: rgba(255,255,255,0.55); }
.ag-l-features li span { color: #a855f7; font-size: 9px; flex-shrink: 0; }

/* Compare strip */
.ag-l-compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; margin: 2px 0; align-items: start; }
.ag-l-col-vs { font-size: 9px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.18); text-align: center; padding-top: 18px; }
.ag-l-col-label { font-size: 9px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.35); margin-bottom: 5px; text-transform: uppercase; }
.ag-l-col-them .ag-l-col-label { color: rgba(255,100,100,0.5); }
.ag-l-col-us .ag-l-col-label { color: rgba(168,85,247,0.7); }
.ag-l-col-item { font-size: 10px; color: rgba(255,255,255,0.4); padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.ag-l-col-us .ag-l-col-item { color: rgba(255,255,255,0.65); }

/* Pricing tier grid */
.ag-l-tiers { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin: 2px 0; }
.ag-l-tier {
  padding: 10px 8px; border-radius: var(--lg-radius-sm, 12px);
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center;
}
.ag-l-tier-pro {
  background: rgba(147,51,234,0.07); border-color: rgba(147,51,234,0.22);
  box-shadow: 0 0 20px -8px rgba(147,51,234,0.3);
}
.ag-l-tier-label { font-size: 9px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.4); }
.ag-l-tier-pro .ag-l-tier-label { color: #a855f7; }
.ag-l-tier-price { font-size: 18px; font-weight: 200; color: rgba(255,255,255,0.9); line-height: 1.1; }
.ag-l-tier-price span { font-size: 10px; font-weight: 400; color: rgba(255,255,255,0.35); }
.ag-l-tier-quota { font-size: 9px; color: rgba(255,255,255,0.3); letter-spacing: 0.5px; }
.ag-l-tier-link {
  margin-top: 4px; font-size: 9px; font-weight: 600; letter-spacing: 0.5px;
  padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer;
  background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
  text-decoration: none; display: inline-block; transition: all 0.15s; font-family: inherit;
}
.ag-l-tier-pro .ag-l-tier-link { background: rgba(147,51,234,0.2); color: #c084fc; border: 1px solid rgba(147,51,234,0.25); }
.ag-l-tier-link:hover { background: rgba(255,255,255,0.1); color: #fff; }
.ag-l-tier-pro .ag-l-tier-link:hover { background: rgba(147,51,234,0.35); color: #fff; }

/* OAuth error */
.ag-oauth-error { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; background:rgba(255,165,0,0.06); border:1px solid rgba(255,165,0,0.12); border-radius: var(--lg-radius-xs,8px); color:rgba(255,165,0,0.85); font-size:11px; margin-bottom: 4px; }
.ag-oauth-error button { background:none; border:none; color:rgba(255,165,0,0.5); cursor:pointer; font-size:13px; }

/* CTA buttons */
.ag-l-ctas { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 0; }
.ag-l-primary {
  width: 100%; padding: 12px; border-radius: var(--lg-radius-sm, 12px);
  background: linear-gradient(135deg, rgba(147,51,234,0.92), rgba(91,33,182,0.92));
  color: #fff; font-size: 13px; font-weight: 600; letter-spacing: 0.5px;
  box-shadow: 0 0 24px rgba(147,51,234,0.15), 0 4px 16px rgba(0,0,0,0.25);
  transition: all 0.2s;
}
.ag-l-primary:hover { transform: translateY(-1px); box-shadow: 0 0 32px rgba(147,51,234,0.25), 0 6px 24px rgba(0,0,0,0.3); }
.ag-l-primary:active { transform: scale(0.985); }
.ag-l-secondary {
  width: 100%; padding: 11px; border-radius: var(--lg-radius-sm, 12px);
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500;
  transition: all 0.15s;
}
.ag-l-secondary:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.12); }
.ag-l-secondary:active { transform: scale(0.985); }

/* Legal links footer */
.ag-l-legal {
  display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 5px;
  margin-top: 10px; font-size: 10px;
}
.ag-l-legal button { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 10px; font-family: inherit; transition: color 0.15s; padding: 0; }
.ag-l-legal button:hover { color: rgba(255,255,255,0.55); }
.ag-l-legal span { color: rgba(255,255,255,0.15); }
.ag-l-entity { color: rgba(255,255,255,0.14); font-size: 9px; letter-spacing: 0.5px; }

/* ═══ AUTH STAGE ═══════════════════════════════════════════════════════ */
.ag-inner { padding: 20px 20px 14px; overflow-y: auto; }

/* Mini hero */
.ag-auth-hero { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ag-wm-sm .ag-l-kuro { font-size: 20px; letter-spacing: 7px; }
.ag-wm-sm .ag-l-os { font-size: 12px; letter-spacing: 4px; }

/* Body + form */
.ag-body { display: flex; flex-direction: column; gap: 8px; }
.ag-oauth {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 11px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06) !important;
  border-radius: var(--lg-radius-sm, 12px); color: rgba(255,255,255,0.88);
  font-size: 13px; font-weight: 500; transition: all 0.15s;
}
.ag-oauth:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1) !important; }
.ag-oauth:active { transform: scale(0.985); }
.ag-oauth:disabled { opacity: 0.5; cursor: not-allowed; }

.ag-divider { display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,0.18); font-size: 11px; }
.ag-divider::before,.ag-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.05); }

.ag-form { display: flex; flex-direction: column; gap: 9px; }
.ag-input {
  width: 100%; padding: 11px 14px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06); border-radius: var(--lg-radius-sm, 12px);
  color: rgba(255,255,255,0.9); font-size: 14px; font-family: inherit;
  outline: none; transition: border-color 0.15s, box-shadow 0.15s;
  touch-action: manipulation;
}
.ag-input:focus { border-color: rgba(147,51,234,0.4); box-shadow: 0 0 0 3px rgba(147,51,234,0.06); }
.ag-input::placeholder { color: rgba(255,255,255,0.16); }
.ag-mono { font-family: 'SF Mono', ui-monospace, monospace; letter-spacing: 0.5px; }
.ag-otp { text-align: center; font-size: 24px; letter-spacing: 8px; font-family: 'SF Mono', ui-monospace, monospace; }
.ag-hint { font-size: 12px; color: rgba(255,255,255,0.4); text-align: center; line-height: 1.4; margin: 0; }
.ag-hint strong { color: rgba(255,255,255,0.8); font-weight: 600; }

.ag-check { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; color: rgba(255,255,255,0.4); cursor: pointer; user-select: none; }
.ag-check input { width: 15px; height: 15px; accent-color: #9333ea; margin-top: 1px; flex-shrink: 0; }
.ag-check-link { background: none; border: none; color: #a855f7; cursor: pointer; font-size: 12px; font-family: inherit; padding: 0; text-decoration: underline; }
.ag-check-link:hover { color: #c084fc; }

.ag-submit {
  width: 100%; padding: 12px; background: linear-gradient(135deg, rgba(147,51,234,0.9), rgba(91,33,182,0.9));
  color: #fff; border-radius: var(--lg-radius-sm, 12px); font-size: 14px; font-weight: 600;
  transition: all 0.2s; box-shadow: 0 0 24px rgba(147,51,234,0.12), 0 4px 16px rgba(0,0,0,0.25);
}
.ag-submit:hover { transform: translateY(-1px); box-shadow: 0 0 32px rgba(147,51,234,0.2), 0 6px 24px rgba(0,0,0,0.3); }
.ag-submit:active { transform: scale(0.985); }
.ag-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.ag-spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%; animation: agSpin 0.7s linear infinite; }
@keyframes agSpin { to { transform: rotate(360deg); } }

.ag-error { padding: 8px 12px; background: rgba(255,55,95,0.05); border: 1px solid rgba(255,55,95,0.1); border-radius: 8px; color: #ff375f; font-size: 12px; text-align: center; }
.ag-msg   { padding: 8px 12px; background: rgba(48,209,88,0.05);  border: 1px solid rgba(48,209,88,0.1);  border-radius: 8px; color: #30d158; font-size: 12px; text-align: center; }

.ag-nav { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 2px; }
.ag-nav button { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 12px; font-family: inherit; cursor: pointer; transition: color 0.15s; display: inline-flex; align-items: center; gap: 5px; }
.ag-nav button:hover { color: rgba(255,255,255,0.55); }
.ag-nav button strong { color: #a855f7; font-weight: 600; }
.ag-token-link { color: rgba(147,51,234,0.45) !important; }
.ag-token-link:hover { color: rgba(147,51,234,0.7) !important; }
.ag-back-landing { color: rgba(255,255,255,0.2) !important; font-size: 11px !important; margin-top: 4px; }

.ag-email-sent { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 8px 0; text-align: center; }
.ag-sent-icon { font-size: 32px; }
.ag-sent-title { font-size: 17px; font-weight: 500; color: #fff; margin: 0; }
.ag-sent-sub { font-size: 12px; color: rgba(255,255,255,0.45); margin: 0; line-height: 1.6; }
.ag-sent-sub strong { color: rgba(255,255,255,0.7); }
.ag-nav-link { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 12px; cursor: pointer; font-family: inherit; transition: color 0.15s; }
.ag-nav-link:hover { color: rgba(255,255,255,0.5); }
.ag-token-display { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.35); border: 1px solid rgba(168,85,247,0.25); border-radius: var(--lg-radius-sm,12px); padding: 10px 14px; width: 100%; }
.ag-token-value { flex: 1; font-family: 'SF Mono', ui-monospace, monospace; font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 2px; word-break: break-all; text-align: left; }
.ag-token-copy { background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.2); border-radius: 6px; color: #a855f7; cursor: pointer; font-size: 15px; padding: 4px 8px; flex-shrink: 0; transition: background 0.15s; }
.ag-token-copy:hover { background: rgba(168,85,247,0.2); }

/* ═══ LEGAL VIEW ═══════════════════════════════════════════════════════ */
.ag-legal-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.ag-legal-nav { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); flex-shrink: 0; }
.ag-legal-back, .ag-legal-switch { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 12px; font-family: inherit; cursor: pointer; transition: color 0.15s; padding: 0; }
.ag-legal-back:hover, .ag-legal-switch:hover { color: rgba(255,255,255,0.7); }
.ag-legal-switch { color: rgba(147,51,234,0.5); }
.ag-legal-switch:hover { color: #a855f7; }
.ag-legal-head { padding: 14px 20px 6px; flex-shrink: 0; }
.ag-legal-head h2 { font-size: 17px; font-weight: 500; color: #fff; margin: 0 0 4px; }
.ag-legal-date { font-size: 11px; color: rgba(255,255,255,0.28); margin: 0; }
.ag-legal-body { flex: 1; overflow-y: auto; padding: 10px 20px 20px; }
.ag-legal-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.6; }
.ag-legal-item strong { color: rgba(255,255,255,0.85); margin-right: 3px; }
.ag-legal-note { margin-top: 16px; padding: 10px 12px; background: rgba(147,51,234,0.05); border: 1px solid rgba(147,51,234,0.12); border-radius: 8px; font-size: 11px; color: rgba(255,255,255,0.35); text-align: center; line-height: 1.5; }
    `}</style>
  );
}
