import { create } from 'zustand';

// ─── Auth helpers ────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('kuro_token') || ''; }
function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-KURO-Token': getToken(),
      ...opts.headers,
    },
  }).then(r => r.ok ? r.json() : Promise.reject(r));
}

// ─── SSE reader helper ──────────────────────────────────────────────────────
// Reads an SSE stream via fetch + getReader(), calling onData for each parsed
// `data:` JSON line. Returns a promise that resolves when the stream ends.
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        onData(parsed);
      } catch { /* skip malformed */ }
    }
  }
  // flush remaining
  if (buffer.startsWith('data:')) {
    try {
      const parsed = JSON.parse(buffer.slice(5).trim());
      onData(parsed);
    } catch { /* skip */ }
  }
}

// ─── localStorage keys ──────────────────────────────────────────────────────
const LS_ROUNDUP = 'kuro_pay_roundups_enabled';
const LS_CONTACTS = 'kuro_pay_recent_contacts';

// ─── Store ───────────────────────────────────────────────────────────────────
export const usePayStore = create((set, get) => ({
  // Summary (from GET /api/pay/accounts/summary)
  summary: null,
  summaryLoading: false,
  summaryUpdatedAt: null,

  // Unified activity feed (from GET /api/pay/accounts/history)
  feed: [],
  feedLoading: false,
  feedPage: 0,
  feedHasMore: true,

  // Vaults (from GET /api/pay/vaults)
  vaults: [],
  vaultsLoading: false,

  // Round-ups
  roundUpsEnabled: localStorage.getItem(LS_ROUNDUP) === 'true',
  pendingRoundUpCents: 0,

  // Market prices (extracted from summary)
  prices: {},
  sparklines: {},

  // AI Intelligence
  latestInsight: null,
  insightLoading: false,
  insightStreamText: '',

  // Session awareness
  sessionStats: { txns: 0, spend_aud: 0, should_surface: false },

  // Active operation (SSE stage tracking)
  activeOp: null, // { type, stages: [{label, status: 'pending'|'active'|'complete'|'failed', detail}] }

  // NLP parse result
  parsedInstruction: null,

  // Quote
  quote: null,
  quoteLoading: false,

  // Payees (server-side persistent)
  payees: [],
  payeesLoading: false,

  // Contacts (localStorage, not server — legacy compat)
  recentContacts: [],

  // SSE
  sseConnected: false,
  _eventSource: null,

  // Audit
  auditPage: [],
  auditOffset: 0,
  auditTotal: 0,
  chainValid: null,

  // UI navigation
  activeSheet: null,   // 'send'|'convert'|'add'|'settings'|'vault'|'tx'|null
  sheetData: null,     // context data for the active sheet
  selectedTxId: null,

  // ─── Actions ─────────────────────────────────────────────────────────────────

  fetchSummary: async (sessionId) => {
    set({ summaryLoading: true });
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const data = await api(`/api/pay/accounts/summary${qs}`);
      const patch = {
        summary: data,
        summaryLoading: false,
        summaryUpdatedAt: Date.now(),
      };
      // Extract market prices + sparklines from summary if present
      if (data.prices) patch.prices = data.prices;
      if (data.sparklines) patch.sparklines = data.sparklines;
      // Extract session stats if the server bundled them
      if (data.session_stats) patch.sessionStats = data.session_stats;
      set(patch);
    } catch {
      set({ summaryLoading: false });
    }
  },

  fetchFeed: async (reset = false) => {
    const state = get();
    const offset = reset ? 0 : state.feedPage * 20;
    set({ feedLoading: true });
    try {
      const data = await api(`/api/pay/accounts/history?limit=20&offset=${offset}`);
      const items = data.items || data.history || [];
      set(s => ({
        feed: reset ? items : [...s.feed, ...items],
        feedPage: reset ? 1 : s.feedPage + 1,
        feedHasMore: items.length >= 20,
        feedLoading: false,
      }));
    } catch {
      set({ feedLoading: false });
    }
  },

  loadMoreFeed: () => {
    const { feedLoading, feedHasMore, fetchFeed } = get();
    if (feedLoading || !feedHasMore) return;
    fetchFeed(false);
  },

  fetchVaults: async () => {
    set({ vaultsLoading: true });
    try {
      const data = await api('/api/pay/vaults');
      set({ vaults: data.vaults || data || [], vaultsLoading: false });
    } catch {
      set({ vaultsLoading: false });
    }
  },

  createVault: async (name, emoji, currency, goal_minor, colour) => {
    await api('/api/pay/vaults', {
      method: 'POST',
      body: JSON.stringify({ name, emoji, currency, goal_minor, colour }),
    });
    await get().fetchVaults();
  },

  updateVault: async (id, updates) => {
    await api(`/api/pay/vaults/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    await get().fetchVaults();
  },

  deleteVault: async (id) => {
    await api(`/api/pay/vaults/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await get().fetchVaults();
  },

  depositToVault: async (vaultId, amount_minor) => {
    const data = await api(`/api/pay/vaults/${encodeURIComponent(vaultId)}/deposit`, {
      method: 'POST', body: JSON.stringify({ amount_minor }),
    });
    await get().fetchVaults();
    return data;
  },

  withdrawFromVault: async (vaultId, amount_minor) => {
    const data = await api(`/api/pay/vaults/${encodeURIComponent(vaultId)}/withdraw`, {
      method: 'POST', body: JSON.stringify({ amount_minor }),
    });
    await get().fetchVaults();
    return data;
  },

  // ─── Payees ───────────────────────────────────────────────────────
  fetchPayees: async () => {
    set({ payeesLoading: true });
    try {
      const data = await api('/api/pay/vaults/payees');
      set({ payees: data.payees || [], payeesLoading: false });
    } catch { set({ payeesLoading: false }); }
  },

  createPayee: async (payee) => {
    await api('/api/pay/vaults/payees', { method: 'POST', body: JSON.stringify(payee) });
    await get().fetchPayees();
  },

  updatePayee: async (id, updates) => {
    await api(`/api/pay/vaults/payees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await get().fetchPayees();
  },

  deletePayee: async (id) => {
    await api(`/api/pay/vaults/payees/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await get().fetchPayees();
  },

  togglePayeeFavourite: async (id) => {
    await api(`/api/pay/vaults/payees/${encodeURIComponent(id)}/favourite`, { method: 'POST' });
    await get().fetchPayees();
  },

  triggerRoundUp: async (sessionId) => {
    try {
      const data = await api('/api/pay/vaults/round-up-stack', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      set({ pendingRoundUpCents: data.pending_cents ?? 0 });
      return data;
    } catch {
      return null;
    }
  },

  getQuote: async (from, to, amount, sessionId) => {
    set({ quoteLoading: true, quote: null });
    try {
      const data = await api('/api/pay/ops/quote', {
        method: 'POST',
        body: JSON.stringify({ from, to, amount, sessionId }),
      });
      set({ quote: data, quoteLoading: false });
      return data;
    } catch {
      set({ quoteLoading: false });
      return null;
    }
  },

  parseNLP: async (instruction, sessionId) => {
    set({ parsedInstruction: null });
    try {
      const data = await api('/api/pay/ops/nlp', {
        method: 'POST',
        body: JSON.stringify({ instruction, sessionId }),
      });
      set({ parsedInstruction: data });
      return data;
    } catch {
      return null;
    }
  },

  executeOp: (endpoint, params, sessionId) => {
    return new Promise((resolve, reject) => {
      set({ activeOp: { type: endpoint, stages: [] } });

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KURO-Token': getToken(),
        },
        body: JSON.stringify({ ...params, sessionId }),
      })
        .then(async (res) => {
          let resolved = false;
          await readSSE(res, (parsed) => {
            if (resolved) return;

            if (parsed.stage) {
              set(s => ({
                activeOp: s.activeOp ? {
                  ...s.activeOp,
                  stages: upsertStage(s.activeOp.stages, parsed.stage),
                } : s.activeOp,
              }));
            }

            if (parsed.status === 'complete') {
              resolved = true;
              resolve(parsed);
            } else if (parsed.status === 'error' || parsed.error) {
              resolved = true;
              reject(new Error(parsed.error || 'Operation failed'));
            }
          });

          // Stream ended without explicit complete/error -- resolve gracefully
          if (!resolved) {
            resolve({ status: 'complete' });
          }
        })
        .catch((err) => {
          set({ activeOp: null });
          reject(err);
        });
    });
  },

  fetchInsight: async () => {
    set({ insightLoading: true });
    try {
      const data = await api('/api/pay/insights/latest');
      set({ latestInsight: data, insightLoading: false });
    } catch {
      set({ insightLoading: false });
    }
  },

  refreshInsight: async (sessionId) => {
    set({ insightLoading: true, insightStreamText: '' });
    try {
      const res = await fetch('/api/pay/insights/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KURO-Token': getToken(),
        },
        body: JSON.stringify({ sessionId }),
      });

      let fullText = '';
      await readSSE(res, (parsed) => {
        if (parsed.text) {
          fullText += parsed.text;
          set({ insightStreamText: fullText });
        }
        if (parsed.insight) {
          set({ latestInsight: parsed.insight, insightLoading: false });
        }
      });

      // If no final insight object arrived, just clear loading
      if (get().insightLoading) {
        set({ insightLoading: false });
      }
    } catch {
      set({ insightLoading: false });
    }
  },

  connectSSE: (sessionId) => {
    const existing = get()._eventSource;
    if (existing) existing.close();

    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const es = new EventSource(`/api/pay/insights/stream${qs}`);

    es.onopen = () => set({ sseConnected: true });
    es.onerror = () => set({ sseConnected: false });

    es.addEventListener('insight', (e) => {
      try { set({ latestInsight: JSON.parse(e.data) }); } catch { /* skip */ }
    });

    es.addEventListener('stats', (e) => {
      try { set({ sessionStats: JSON.parse(e.data) }); } catch { /* skip */ }
    });

    es.addEventListener('summary', (e) => {
      try { set({ summary: JSON.parse(e.data) }); } catch { /* skip */ }
    });

    set({ _eventSource: es, sseConnected: true });
  },

  disconnectSSE: () => {
    const es = get()._eventSource;
    if (es) es.close();
    set({ _eventSource: null, sseConnected: false });
  },

  fetchAudit: async (offset = 0) => {
    try {
      const data = await api(`/api/pay/audit?limit=20&offset=${offset}`);
      set({
        auditPage: data.items || data.entries || [],
        auditOffset: offset,
        auditTotal: data.total || 0,
      });
    } catch { /* ignore */ }
  },

  verifyChain: async () => {
    try {
      const data = await api('/api/pay/audit/verify');
      set({ chainValid: data.valid ?? null });
      return data;
    } catch {
      set({ chainValid: null });
      return null;
    }
  },

  // ─── UI Navigation ─────────────────────────────────────────────────────────

  openSheet: (name, data = null) => set({ activeSheet: name, sheetData: data }),
  closeSheet: () => set({ activeSheet: null, sheetData: null }),
  clearActiveOp: () => set({ activeOp: null }),

  // ─── Contacts (localStorage) ───────────────────────────────────────────────

  addRecentContact: (contact) => {
    set(s => {
      // Dedupe by address+currency, most-recent first
      const filtered = s.recentContacts.filter(
        c => !(c.address === contact.address && c.currency === contact.currency)
      );
      const updated = [{ ...contact, last_sent: Date.now() }, ...filtered].slice(0, 20);
      try { localStorage.setItem(LS_CONTACTS, JSON.stringify(updated)); } catch { /* quota */ }
      return { recentContacts: updated };
    });
  },

  loadRecentContacts: () => {
    try {
      const raw = localStorage.getItem(LS_CONTACTS);
      if (raw) set({ recentContacts: JSON.parse(raw) });
    } catch { /* corrupt data -- ignore */ }
  },
}));

// ─── Stage upsert helper ────────────────────────────────────────────────────
// If a stage with the same label exists, update it in-place; otherwise append.
function upsertStage(stages, incoming) {
  const idx = stages.findIndex(s => s.label === incoming.label);
  if (idx >= 0) {
    const copy = [...stages];
    copy[idx] = { ...copy[idx], ...incoming };
    return copy;
  }
  return [...stages, incoming];
}
