/**
 * KURO OS — Client-side Router
 * Three routes: / (home), /login (auth), /app (desktop OS)
 * Auth guard on /app redirects unauthenticated users to /login.
 * Authenticated users on / or /login are redirected to /app (LOCK 5).
 */
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import App from './App';

/* ─── Boot screen shown while session check is in flight ─────────── */
function BootScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#08080f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: '#a855f7',
        boxShadow: '0 0 12px rgba(168,85,247,0.8)',
        animation: 'bootPulse 1.2s ease-in-out infinite',
      }} />
      <style>{`@keyframes bootPulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}`}</style>
    </div>
  );
}

/* ─── Auth guard: redirect to /login if not authenticated ─────────── */
function RequireAuth({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <BootScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* ─── Public guard: redirect authed users away from marketing pages ── */
function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <BootScreen />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RedirectIfAuthed><HomePage /></RedirectIfAuthed>} />
      <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
      <Route path="/app" element={<RequireAuth><App /></RequireAuth>} />
      {/* Catch-all → home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
