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

/* ─── Auth guard: redirect to /login if not authenticated ─────────── */
function RequireAuth({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return null; // blank until session check completes (no flash)
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* ─── Public guard: redirect authed users away from marketing pages ── */
function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return null;
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
