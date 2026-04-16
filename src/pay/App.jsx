import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { fetchCards } from './api.js';

import LinkCardScreen     from './LinkCardScreen.jsx';
import UnifiedSendScreen  from './UnifiedSendScreen.jsx';
import ConfirmingScreen   from './ConfirmingScreen.jsx';
import ReceiptScreen      from './ReceiptScreen.jsx';

function Shell() {
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { cards } = await fetchCards();
        if (cancelled) return;
        if (loc.pathname === '/' || loc.pathname === '') {
          nav(cards && cards.length > 0 ? '/send' : '/link-card', { replace: true });
        }
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) {
          window.location.href = '/?returnTo=/pay';
          return;
        }
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="kp-center kp-fullscreen">
        <div className="kp-spinner" />
        <div className="kp-dim kp-mt16">Loading KURO::PAY…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="kp-center kp-fullscreen kp-pad">
        <div className="kp-title">Couldn't load</div>
        <div className="kp-dim kp-mt8">{error}</div>
        <button className="kp-btn kp-mt24" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  return <Navigate to="/send" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/"            element={<Shell />}             />
      <Route path="/link-card"   element={<LinkCardScreen />}    />
      <Route path="/send"        element={<UnifiedSendScreen />} />
      <Route path="/confirming"  element={<ConfirmingScreen />}  />
      <Route path="/receipt"     element={<ReceiptScreen />}     />
      <Route path="*"            element={<Navigate to="/" replace />} />
    </Routes>
  );
}
