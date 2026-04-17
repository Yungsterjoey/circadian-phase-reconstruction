import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import GlassCube from '../components/ui/GlassCube';
import DesktopBackground from '../components/DesktopBackground';
import LegalModal from '../components/legal/LegalModal';

import WelcomeScreen      from './WelcomeScreen.jsx';
import LinkCardScreen     from './LinkCardScreen.jsx';
import UnifiedSendScreen  from './UnifiedSendScreen.jsx';
import ConfirmingScreen   from './ConfirmingScreen.jsx';
import ReceiptScreen      from './ReceiptScreen.jsx';

import { PayNavProvider } from './nav/PayNavContext.jsx';
import PayNav from './nav/PayNav.jsx';

/**
 * On "/" the pay app historically tried fetchCards + redirected to /send or
 * /link-card. With WelcomeScreen now the entry point, "/" just forwards
 * there. Welcome then decides /link-card vs /send based on saved cards.
 */
function RootRedirect() {
  const nav = useNavigate();
  useEffect(() => { nav('/welcome', { replace: true }); }, [nav]);
  return null;
}

function KuroBar() {
  return (
    <div className="kp-kuro-bar">
      <a href="/" className="kp-kuro-brand" aria-label="Back to KURO">
        <GlassCube size="nav" />
        <span className="kp-kuro-word">KURO</span>
      </a>
      <span className="kp-kuro-tag">PAY</span>
    </div>
  );
}

export default function App() {
  return (
    <PayNavProvider>
      <div className="kp-app-shell">
        {/* Muted shared DesktopBackground: same component the OS uses, dimmed via CSS. */}
        <div className="kp-bg" aria-hidden="true">
          <DesktopBackground />
        </div>

        <KuroBar />

        <div className="kp-app-body">
          <Routes>
            <Route path="/"            element={<RootRedirect />}      />
            <Route path="/welcome"     element={<WelcomeScreen />}     />
            <Route path="/link-card"   element={<LinkCardScreen />}    />
            <Route path="/send"        element={<UnifiedSendScreen />} />
            <Route path="/scan"        element={<Navigate to="/send" replace />} />
            <Route path="/confirming"  element={<ConfirmingScreen />}  />
            <Route path="/receipt"     element={<ReceiptScreen />}     />
            <Route path="*"            element={<Navigate to="/welcome" replace />} />
          </Routes>
        </div>

        <PayNav />
        <LegalModal />
      </div>
    </PayNavProvider>
  );
}
