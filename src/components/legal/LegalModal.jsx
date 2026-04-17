/**
 * LegalModal — liquid-glass descriptor panel for Terms / Privacy / Disclaimer / AUP / Cookie.
 * Opens via openLegalModal(id) from legalBus. ESC + backdrop click + Close button dismiss.
 */
import React, { useEffect, useRef } from 'react';
import { LEGAL_SECTIONS } from './legalContent.jsx';
import { useLegalModalState, closeLegalModal } from './legalBus.js';

export default function LegalModal() {
  const currentId = useLegalModalState();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!currentId) return;
    const onKey = (e) => { if (e.key === 'Escape') closeLegalModal(); };
    window.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the dialog for screen readers + ESC.
    const t = setTimeout(() => dialogRef.current?.focus(), 30);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [currentId]);

  if (!currentId) return null;
  const section = LEGAL_SECTIONS[currentId];
  if (!section) return null;

  return (
    <div
      className="lgl-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lgl-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeLegalModal(); }}
    >
      <div className="lgl-panel" ref={dialogRef} tabIndex={-1}>
        <header className="lgl-header">
          <h2 id="lgl-title" className="lgl-title">{section.title}</h2>
          {section.meta && <p className="lgl-meta">{section.meta}</p>}
          <button
            type="button"
            className="lgl-close"
            aria-label="Close"
            onClick={closeLegalModal}
          >
            ×
          </button>
        </header>

        <div className="lgl-body">
          {section.body}
        </div>

        {section.footer === 'cookie-consent' ? <CookieFooter /> : <StandardFooter />}
      </div>

      <LegalModalStyles />
    </div>
  );
}

function StandardFooter() {
  return (
    <footer className="lgl-footer">
      <button type="button" className="lgl-btn lgl-btn-primary" onClick={closeLegalModal}>
        Close
      </button>
    </footer>
  );
}

function CookieFooter() {
  const setConsent = (level) => {
    try {
      localStorage.setItem(
        'kuro_cookies',
        JSON.stringify({ level, version: '1.0', timestamp: new Date().toISOString() })
      );
    } catch {}
    closeLegalModal();
  };
  return (
    <footer className="lgl-footer lgl-footer-cookie">
      <button type="button" className="lgl-btn lgl-btn-ghost" onClick={() => setConsent('essential')}>
        Essential Only
      </button>
      <button type="button" className="lgl-btn lgl-btn-primary" onClick={() => setConsent('all')}>
        Accept All
      </button>
      <button type="button" className="lgl-btn lgl-btn-text" onClick={closeLegalModal}>
        Close
      </button>
    </footer>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────── */
let stylesInjected = false;
function LegalModalStyles() {
  if (stylesInjected) return null;
  stylesInjected = true;
  return (
    <style>{`
.lgl-backdrop {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(4, 4, 8, 0.72);
  backdrop-filter: blur(28px) saturate(1.4);
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  animation: lglFade 200ms ease both;
}
@keyframes lglFade { from { opacity: 0; } to { opacity: 1; } }

.lgl-panel {
  width: 100%;
  max-width: 680px;
  max-height: calc(100vh - 48px);
  max-height: calc(100dvh - 48px);
  display: flex; flex-direction: column;
  background: rgba(14, 14, 20, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.55),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(60px) saturate(1.6);
  -webkit-backdrop-filter: blur(60px) saturate(1.6);
  color: rgba(255, 255, 255, 0.78);
  font-family: var(--kg-font, -apple-system, BlinkMacSystemFont, sans-serif);
  animation: lglRise 260ms cubic-bezier(.2,.9,.3,1.2) both;
  outline: none;
}
@keyframes lglRise {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.lgl-header {
  position: relative;
  padding: 28px 32px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.lgl-title {
  font-size: 22px; font-weight: 600; letter-spacing: -0.01em;
  color: #fff; margin: 0;
}
.lgl-meta {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  letter-spacing: 0.02em;
}
.lgl-close {
  position: absolute; top: 16px; right: 16px;
  width: 34px; height: 34px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.5);
  font-size: 22px; font-weight: 300; line-height: 1;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
}
.lgl-close:hover {
  background: rgba(168, 121, 255, 0.12);
  border-color: rgba(168, 121, 255, 0.28);
  color: #c4a8ff;
}

.lgl-body {
  flex: 1; overflow-y: auto;
  padding: 18px 32px 24px;
  font-size: 13.5px; line-height: 1.7;
  -webkit-overflow-scrolling: touch;
}
.lgl-body p { margin: 0 0 12px; }
.lgl-body strong { color: #fff; font-weight: 600; }
.lgl-body em { font-style: normal; color: rgba(255,255,255,0.5); }
.lgl-body a { color: rgba(168, 121, 255, 0.85); text-decoration: none; }
.lgl-body a:hover { color: #c4a8ff; text-decoration: underline; }
.lgl-body .lgl-indent { margin-left: 14px; }

.lgl-table {
  width: 100%; border-collapse: collapse;
  margin: 8px 0 16px;
  font-size: 12px;
}
.lgl-table th {
  text-align: left; font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  padding: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.lgl-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
}

.lgl-footer {
  display: flex; gap: 10px; flex-wrap: wrap;
  padding: 16px 32px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  justify-content: flex-end;
}
.lgl-footer-cookie { justify-content: flex-start; }

.lgl-btn {
  appearance: none; cursor: pointer; font-family: inherit; font-size: 13px;
  padding: 9px 18px; border-radius: 10px;
  transition: background 150ms, border-color 150ms, color 150ms, transform 80ms;
}
.lgl-btn:active { transform: scale(0.98); }
.lgl-btn-primary {
  background: rgba(168, 121, 255, 0.18);
  color: #c4a8ff;
  border: 1px solid rgba(168, 121, 255, 0.32);
}
.lgl-btn-primary:hover {
  background: rgba(168, 121, 255, 0.28);
  border-color: rgba(168, 121, 255, 0.5);
}
.lgl-btn-ghost {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.lgl-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.lgl-btn-text {
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  border: 1px solid transparent;
}
.lgl-btn-text:hover { color: rgba(255, 255, 255, 0.8); }

/* Mobile */
@media (max-width: 560px) {
  .lgl-backdrop { padding: 12px; }
  .lgl-panel { max-height: calc(100dvh - 24px); border-radius: 18px; }
  .lgl-header { padding: 22px 22px 14px; }
  .lgl-body { padding: 16px 22px 20px; font-size: 13px; }
  .lgl-footer { padding: 14px 22px 18px; }
}
    `}</style>
  );
}
