import { create } from 'zustand';

const API = '/api/auth';

// Fetch with timeout (prevents indefinite hangs)
function tfetch(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

export const useAuthStore = create((set, get) => ({
  user: null,
  subscription: null,
  authenticated: false,
  loading: true,
  authMethod: null,

  // Init: check session, handle OAuth redirects (RT-09: retry on ?auth=success)
  init: async () => {
    const params = new URLSearchParams(window.location.search);

    // Handle OAuth callback states
    if (params.get('auth') === 'success') {
      // RT-09: Cookie may not be set yet — retry with delay
      window.history.replaceState({}, '', window.location.pathname);
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, attempt * 500));
        const result = await get()._fetchMe();
        if (result) return;
      }
      set({ loading: false });
      return;
    }

    if (params.get('auth') === 'link') {
      // OAuth account needs linking — show link confirmation
      set({ loading: false, pendingLink: { provider: params.get('provider'), state: params.get('state') } });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (params.get('auth') === 'error') {
      set({ loading: false, authError: params.get('reason') || 'Authentication failed' });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    // Normal init — check existing session
    await get()._fetchMe();
  },

  _fetchMe: async () => {
    try {
      const r = await tfetch(`${API}/me`, { credentials: 'include' });
      const d = await r.json();
      if (d.authenticated) {
        set({ user: d.user, subscription: d.subscription, authenticated: true, loading: false, authMethod: d.authMethod });
        return true;
      }
    } catch(e) {}
    set({ user: null, authenticated: false, loading: false });
    return false;
  },

  signup: async (email, password, name) => {
    try {
      const r = await tfetch(`${API}/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ email, password, name })
      });
      const d = await r.json();
      if (d.success) {
        return { success: true, tokenSent: d.tokenSent, devToken: d.devToken };
      }
      return { success: false, error: d.error || 'Signup failed' };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  login: async (email, password) => {
    try {
      const r = await tfetch(`${API}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (d.success) {
        set({ user: d.user, authenticated: true, loading: false });
        return { success: true };
      }
      return { success: false, error: d.error || 'Invalid credentials' };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  logout: async () => {
    try {
      await tfetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
    } catch(e) {}
    // Clear persistent client state
    try { localStorage.removeItem('kuro_token'); localStorage.removeItem('kuro_projects_v72'); localStorage.removeItem('kuro_sid'); } catch(e) {}
    set({ user: null, authenticated: false, subscription: null, authMethod: null });
  },

  verifyEmail: async (code) => {
    try {
      const r = await tfetch(`${API}/verify-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ code })
      });
      const d = await r.json();
      if (d.success) {
        set(s => ({ user: { ...s.user, emailVerified: true } }));
        return { success: true };
      }
      return { success: false, error: d.error };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  forgotPassword: async (email) => {
    try {
      const r = await tfetch(`${API}/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const d = await r.json();
      return { success: d.success, devCode: d.devCode, error: d.error };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  resetPassword: async (email, code, newPassword) => {
    try {
      const r = await tfetch(`${API}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword })
      });
      const d = await r.json();
      return { success: d.success, error: d.error };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  tokenLogin: async (token) => {
    try {
      const r = await tfetch(`${API}/token-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ token })
      });
      const d = await r.json();
      if (d.success) {
        set({ user: d.user, authenticated: true, authMethod: 'token' });
        return { success: true };
      }
      return { success: false, error: d.error || 'Invalid token' };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  linkOAuth: async (state, password) => {
    try {
      const r = await tfetch(`${API}/link-oauth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ state, password })
      });
      const d = await r.json();
      if (d.success) {
        set({ user: d.user, authenticated: true, pendingLink: null });
        return { success: true };
      }
      return { success: false, error: d.error };
    } catch(e) { return { success: false, error: 'Network error' }; }
  },

  // Reactive helpers
  pendingLink: null,
  authError: null,
  clearAuthError: () => set({ authError: null }),
}));
