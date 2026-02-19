/**
 * KURO :: AUTH GATE v9.1
 * Two-stage auth inside an OS window (not a full-screen overlay).
 * Stage 1: Continue + Terms/Privacy links
 * Stage 2: signup/login + required "I agree" checkbox
 */
import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

/* ═══ Cube — same .gcf gradient + transforms as landing ═══ */
const GlassCube = () => (
  <div className="ag-gcube">
    <div className="ag-gcube-inner">
      <div className="ag-gcf ft" /><div className="ag-gcf bk" />
      <div className="ag-gcf rt" /><div className="ag-gcf lt" />
      <div className="ag-gcf tp" /><div className="ag-gcf bt" />
    </div>
  </div>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
);
const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
);
const KeyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
);

export default function AuthGate() {
  const [stage, setStage] = useState(1); // 1 = welcome, 2 = auth form
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

  useEffect(() => { if (stage === 2) setTimeout(() => inputRef.current?.focus(), 150); }, [mode, stage]);

  const reset = () => { setError(''); setMessage(''); };
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const switchMode = (m) => { setMode(m); reset(); };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    reset(); setLoading(true);
    // Require terms agreement for signup and token modes
    if (['signup', 'token'].includes(mode) && !agreeTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      setLoading(false);
      return;
    }
    try {
      if (mode === 'token') {
        if (!form.token.trim()) { setError('Enter your access token.'); setLoading(false); return; }
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
        if (r.success) {
          if (r.devToken) setAccessToken(r.devToken);
          setMode('email-sent');
          setMessage('');
        } else {
          setError(r.error);
        }
      } else {
        const r = await login(form.email, form.password);
        r.success ? window.location.reload() : setError(r.error);
      }
    } catch (e) { setError(e.message || 'Something went wrong.'); }
    setLoading(false);
    submittingRef.current = false;
  };

  const onKey = e => { if (e.key === 'Enter') submit(); };
  const showOAuth = ['signup', 'login'].includes(mode);
  const showAgree = ['signup', 'token'].includes(mode);

  // ═══ STAGE 1: Welcome ═══
  if (stage === 1) {
    return (
      <div className="ag-inner">
        <div className="ag-hero">
          <GlassCube />
          <h1 className="ag-title">KURO</h1>
          <p className="ag-os">.OS</p>
          <p className="ag-sub">SOVEREIGN INTELLIGENCE PLATFORM</p>
        </div>
        <div className="ag-body">
          {authError && (
            <div className="ag-oauth-error">
              {authError === 'oauth_not_configured'
                ? 'Social login is not enabled. Please use email.'
                : `Sign in failed: ${authError.replace(/_/g, ' ')}`}
              <button onClick={clearAuthError}>&#x2715;</button>
            </div>
          )}
          <button className="ag-btn ag-submit" onClick={() => { setMode('signup'); setStage(2); }}>
            Create Account
          </button>
          <button className="ag-btn ag-oauth" onClick={() => { setMode('login'); setStage(2); }}>
            Sign In
          </button>
          <div className="ag-footer-inline">
            <span className="ag-legal">By continuing you agree to our</span>
            <a href="/?modal=terms" target="_blank" rel="noopener">Terms of Service</a>
            <span className="ag-legal">&</span>
            <a href="/?modal=privacy" target="_blank" rel="noopener">Privacy Policy</a>
          </div>
        </div>
        <AuthGateStyles />
      </div>
    );
  }

  // ═══ STAGE 2: Auth form ═══
  return (
    <div className="ag-inner">
      <div className="ag-hero ag-hero-sm">
        <GlassCube />
        <h1 className="ag-title">KURO</h1>
        <p className="ag-os">.OS</p>
      </div>

      <div className="ag-body">
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

        {mode === 'token' && (
          <p className="ag-hint">Enter the KURO access token from your email or subscription.</p>
        )}

        {mode === 'email-sent' && (
          <div className="ag-email-sent">
            {accessToken ? (
              <>
                <div className="ag-sent-icon">&#x26A1;</div>
                <h3 className="ag-sent-title">Your access token</h3>
                <p className="ag-sent-sub" style={{marginBottom:4}}>Email delivery unavailable — copy your token now:</p>
                <div className="ag-token-display">
                  <span className="ag-token-value">{accessToken}</span>
                  <button className="ag-token-copy" onClick={() => { navigator.clipboard?.writeText(accessToken); }} title="Copy">&#x2398;</button>
                </div>
                <button className="ag-btn ag-submit" onClick={() => { upd('token', accessToken); switchMode('token'); }}>
                  Sign in with this token &#x2192;
                </button>
              </>
            ) : (
              <>
                <div className="ag-sent-icon">&#x2709;</div>
                <h3 className="ag-sent-title">Check your email</h3>
                <p className="ag-sent-sub">We sent your KURO access token to<br /><strong>{form.email}</strong></p>
                <button className="ag-btn ag-submit" onClick={() => switchMode('token')}>
                  Enter access token &#x2192;
                </button>
              </>
            )}
            <button onClick={() => switchMode('login')} className="ag-nav-link">&#x2190; Back to sign in</button>
          </div>
        )}

        {mode !== 'email-sent' && <div className="ag-form">
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
              <span>I agree to the <a href="/?modal=terms" target="_blank" rel="noopener">Terms</a> and <a href="/?modal=privacy" target="_blank" rel="noopener">Privacy Policy</a></span>
            </label>
          )}

          <button className="ag-btn ag-submit" onClick={submit} disabled={loading}>
            {loading ? <span className="ag-spinner" /> :
              mode === 'signup' ? 'Create Account' :
              mode === 'login' ? 'Sign In' :
              mode === 'token' ? 'Launch KURO' :
              mode === 'otp' ? 'Verify Email' :
              mode === 'forgot' ? 'Send Reset Code' : 'Reset Password'}
          </button>

          {error && <div className="ag-error">{error}</div>}
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
            {mode === 'token' && (
              <button onClick={() => switchMode('signup')}>{'\u2190'} Back to create account</button>
            )}
            {['forgot', 'reset', 'otp'].includes(mode) && (
              <button onClick={() => switchMode('login')}>{'\u2190'} Back to sign in</button>
            )}
            <button onClick={() => { setStage(1); reset(); }} className="ag-back-welcome">{'\u2190'} Back</button>
          </div>
        </div>}
      </div>
      <AuthGateStyles />
    </div>
  );
}

function AuthGateStyles() {
  return (
    <style>{`
/* ═══ AUTHGATE v9.1 — windowed (no fixed overlay) ═══ */
.ag-inner { padding: 24px 24px 16px; }
.ag-inner *,.ag-inner *::before,.ag-inner *::after { box-sizing: border-box; }

/* ═══ Cube ═══ */
.ag-gcube { perspective: 600px; width: 72px; height: 72px; margin: 0 auto 10px; }
.ag-gcube-inner { width: 48px; height: 48px; position: relative; transform-style: preserve-3d; animation: agRot 20s linear infinite; margin: 12px auto; }
@keyframes agRot { from { transform: rotateX(-20deg) rotateY(-30deg); } to { transform: rotateX(-20deg) rotateY(330deg); } }
.ag-gcf { position: absolute; width: 48px; height: 48px; background: linear-gradient(135deg,rgba(91,33,182,.35),rgba(76,29,149,.25) 50%,rgba(49,10,101,.45)); border: 1px solid rgba(139,92,246,.25); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.ag-gcf.ft { transform: translateZ(24px); } .ag-gcf.bk { transform: rotateY(180deg) translateZ(24px); }
.ag-gcf.rt { transform: rotateY(90deg) translateZ(24px); } .ag-gcf.lt { transform: rotateY(-90deg) translateZ(24px); }
.ag-gcf.tp { transform: rotateX(90deg) translateZ(24px); } .ag-gcf.bt { transform: rotateX(-90deg) translateZ(24px); }

/* ═══ Typography ═══ */
.ag-hero { text-align: center; margin-bottom: 18px; }
.ag-hero-sm .ag-gcube { width: 56px; height: 56px; margin-bottom: 6px; }
.ag-hero-sm .ag-gcube-inner { width: 36px; height: 36px; margin: 10px auto; }
.ag-hero-sm .ag-gcf { width: 36px; height: 36px; }
.ag-hero-sm .ag-gcf.ft { transform: translateZ(18px); } .ag-hero-sm .ag-gcf.bk { transform: rotateY(180deg) translateZ(18px); }
.ag-hero-sm .ag-gcf.rt { transform: rotateY(90deg) translateZ(18px); } .ag-hero-sm .ag-gcf.lt { transform: rotateY(-90deg) translateZ(18px); }
.ag-hero-sm .ag-gcf.tp { transform: rotateX(90deg) translateZ(18px); } .ag-hero-sm .ag-gcf.bt { transform: rotateX(-90deg) translateZ(18px); }
.ag-title { font-size: 26px; font-weight: 200; letter-spacing: 12px; margin: 0; color: #fff; text-indent: 12px; }
.ag-os { font-size: 16px; font-weight: 500; letter-spacing: 6px; color: #a855f7; margin: 2px 0 0; text-indent: 6px; }
.ag-sub { font-size: 9px; font-weight: 500; letter-spacing: 3.5px; text-transform: uppercase; color: rgba(255,255,255,.28); margin: 8px 0 0; }

/* ═══ Form ═══ */
.ag-body { display: flex; flex-direction: column; gap: 10px; }
.ag-btn { touch-action: manipulation; -webkit-tap-highlight-color: transparent; font-family: inherit; cursor: pointer; border: none; }
.ag-oauth { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 11px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06)!important; border-radius: 10px; color: rgba(255,255,255,.88); font-size: 14px; font-weight: 500; transition: all .15s; }
.ag-oauth:hover { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.1)!important; }
.ag-oauth:active { transform: scale(.985); }
.ag-oauth:disabled { opacity: .5; cursor: not-allowed; }
.ag-divider { display: flex; align-items: center; gap: 10px; color: rgba(255,255,255,.18); font-size: 12px; margin: 2px 0; }
.ag-divider::before,.ag-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.05); }
.ag-form { display: flex; flex-direction: column; gap: 10px; }
.ag-input { width: 100%; padding: 11px 14px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 10px; color: rgba(255,255,255,.9); font-size: 14px; font-family: inherit; outline: none; transition: border-color .15s, box-shadow .15s; box-sizing: border-box; touch-action: manipulation; }
.ag-input:focus { border-color: rgba(147,51,234,.4); box-shadow: 0 0 0 3px rgba(147,51,234,.06); }
.ag-input::placeholder { color: rgba(255,255,255,.16); }
.ag-mono { font-family: 'SF Mono', ui-monospace, monospace; letter-spacing: .5px; }
.ag-otp { text-align: center; font-size: 24px; letter-spacing: 8px; font-family: 'SF Mono', ui-monospace, monospace; }
.ag-hint { font-size: 12px; color: rgba(255,255,255,.4); text-align: center; line-height: 1.4; margin: 0; }
.ag-hint strong { color: rgba(255,255,255,.8); font-weight: 600; }
.ag-check { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; color: rgba(255,255,255,.4); cursor: pointer; user-select: none; touch-action: manipulation; }
.ag-check input { width: 16px; height: 16px; accent-color: #9333ea; margin-top: 1px; flex-shrink: 0; }
.ag-check a { color: #a855f7; text-decoration: none; }
.ag-check a:hover { text-decoration: underline; }

/* ═══ Submit ═══ */
.ag-submit { width: 100%; padding: 12px; background: linear-gradient(135deg,rgba(147,51,234,.9),rgba(91,33,182,.9)); color: #fff; border-radius: 10px; font-size: 14px; font-weight: 600; transition: all .2s; box-shadow: 0 0 24px rgba(147,51,234,.12), 0 4px 16px rgba(0,0,0,.25); }
.ag-submit:hover { transform: translateY(-1px); box-shadow: 0 0 32px rgba(147,51,234,.2), 0 6px 24px rgba(0,0,0,.3); }
.ag-submit:active { transform: scale(.985); }
.ag-submit:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.ag-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; animation: agSpin .7s linear infinite; }
@keyframes agSpin { to { transform: rotate(360deg); } }

/* ═══ Messages ═══ */
.ag-error { padding: 8px 12px; background: rgba(255,55,95,.05); border: 1px solid rgba(255,55,95,.1); border-radius: 8px; color: #ff375f; font-size: 12px; text-align: center; }
.ag-msg { padding: 8px 12px; background: rgba(48,209,88,.05); border: 1px solid rgba(48,209,88,.1); border-radius: 8px; color: #30d158; font-size: 12px; text-align: center; }

/* ═══ Nav links ═══ */
.ag-nav { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 2px; }
.ag-nav button { background: none; border: none; color: rgba(255,255,255,.3); font-size: 12px; font-family: inherit; cursor: pointer; transition: color .15s; display: inline-flex; align-items: center; gap: 5px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.ag-nav button:hover { color: rgba(255,255,255,.5); }
.ag-nav button strong { color: #a855f7; font-weight: 600; }
.ag-token-link { color: rgba(147,51,234,.4)!important; }
.ag-token-link:hover { color: rgba(147,51,234,.65)!important; }
.ag-back-welcome { color: rgba(255,255,255,.2)!important; font-size: 11px!important; margin-top: 4px; }

/* ═══ Stage 1 footer ═══ */
.ag-footer-inline { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px; font-size: 11px; margin-top: 8px; }
.ag-legal { color: rgba(255,255,255,.2); }
.ag-footer-inline a { color: rgba(255,255,255,.35); text-decoration: none; }
.ag-footer-inline a:hover { color: rgba(255,255,255,.5); text-decoration: underline; }

@media (prefers-reduced-motion: reduce) { .ag-gcube-inner { animation: none; transform: rotateX(-20deg) rotateY(-30deg); } }

/* ═══ OAuth error banner ═══ */
.ag-oauth-error { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 14px; background:rgba(255,165,0,0.08); border:1px solid rgba(255,165,0,0.15); border-radius:10px; color:rgba(255,165,0,0.9); font-size:12px; }
.ag-oauth-error button { background:none; border:none; color:rgba(255,165,0,0.6); cursor:pointer; font-size:14px; padding:0 2px; }

/* ═══ Email sent screen ═══ */
.ag-email-sent { display:flex; flex-direction:column; align-items:center; gap:12px; padding:8px 0; text-align:center; }
.ag-sent-icon { font-size:36px; margin-bottom:4px; }
.ag-sent-title { font-size:18px; font-weight:500; color:#fff; margin:0; }
.ag-sent-sub { font-size:13px; color:rgba(255,255,255,0.45); margin:0; line-height:1.6; }
.ag-sent-sub strong { color:rgba(255,255,255,0.7); }
.ag-nav-link { background:none; border:none; color:rgba(255,255,255,0.3); font-size:12px; cursor:pointer; font-family:inherit; transition:color 0.15s; margin-top:4px; }
.ag-nav-link:hover { color:rgba(255,255,255,0.5); }
.ag-token-display { display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.35); border:1px solid rgba(168,85,247,0.25); border-radius:10px; padding:10px 14px; width:100%; box-sizing:border-box; }
.ag-token-value { flex:1; font-family:'SF Mono',ui-monospace,monospace; font-size:13px; font-weight:700; color:#fff; letter-spacing:2px; word-break:break-all; text-align:left; }
.ag-token-copy { background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.2); border-radius:6px; color:#a855f7; cursor:pointer; font-size:16px; padding:4px 8px; flex-shrink:0; transition:background 0.15s; }
.ag-token-copy:hover { background:rgba(168,85,247,0.2); }
    `}</style>
  );
}
