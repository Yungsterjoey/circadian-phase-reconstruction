/**
 * KURO :: Cookie Banner — SPA version
 * Matches landing cookie banner exactly
 * Shows if kuro_cookies not in localStorage
 */
import { useState, useEffect } from 'react';

export default function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('kuro_cookies')) {
      setTimeout(() => setShow(true), 800);
    }
  }, []);

  const accept = (level) => {
    const consent = { level, version: '1.0', timestamp: new Date().toISOString() };
    localStorage.setItem('kuro_cookies', JSON.stringify(consent));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="ck-banner" style={{ animation: 'ckIn .3s ease both' }}>
      <p className="ck-text">
        We use essential cookies for authentication and security (Cloudflare). No advertising or tracking cookies.{' '}
        <a href="/?modal=cookie" target="_blank" rel="noopener" className="ck-link">Cookie Policy</a>
      </p>
      <div className="ck-btns">
        <button className="ck-btn ck-ess" onClick={() => accept('essential')}>Essential Only</button>
        <button className="ck-btn ck-all" onClick={() => accept('all')}>Accept All</button>
      </div>

      <style>{`
.ck-banner{position:fixed;bottom:max(12px,env(safe-area-inset-bottom,12px));left:50%;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center;padding:14px 20px;background:rgba(10,10,14,.95);border:1px solid rgba(255,255,255,.06);border-radius:16px;backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);box-shadow:0 8px 32px rgba(0,0,0,.5);max-width:560px;width:calc(100% - 24px)}
@keyframes ckIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.ck-text{font-size:12px;color:rgba(255,255,255,.5);line-height:1.5;margin:0;flex:1;min-width:200px}
.ck-link{color:rgba(147,51,234,.6);text-decoration:none}
.ck-link:hover{color:rgba(147,51,234,.8)}
.ck-btns{display:flex;gap:8px;flex-shrink:0}
.ck-btn{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all .15s;touch-action:manipulation;-webkit-tap-highlight-color:transparent;border:none}
.ck-ess{background:rgba(255,255,255,.05);color:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.06)}
.ck-ess:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,.7)}
.ck-all{background:rgba(147,51,234,.15);color:#c084fc;border:1px solid rgba(147,51,234,.25)}
.ck-all:hover{background:rgba(147,51,234,.25)}
      `}</style>
    </div>
  );
}
