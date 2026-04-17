/**
 * KURO::PAY v2.0 — Up Bank-style vertical scroll feed
 *
 * Single scroll surface + push sheets. No tabs.
 * All CSS prefixed kp-. Dark glass aesthetic.
 */
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Settings, Plus, ArrowDown, ArrowUp, ArrowLeftRight,
  MoreHorizontal, Copy, Check, ChevronLeft, RefreshCw,
  X, Search, Send, Shield,
} from 'lucide-react';
import { usePayStore } from '../../stores/payStore';

/* ═══════════════════════════════════════════════════════════════════════════
   FORMAT HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const fmtAUD = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';

const fmtBTC = (sats) =>
  typeof sats === 'number' ? (sats / 1e8).toFixed(8) : '0.00000000';

const fmtXMR = (pico) =>
  typeof pico === 'number' ? (pico / 1e12).toFixed(4) : '0.0000';

const fmtTime = (iso) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.floor(m / 60) + 'h ago';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/* ═══════════════════════════════════════════════════════════════════════════
   DATA EXTRACTORS — pull values from the nested summary shape
═══════════════════════════════════════════════════════════════════════════ */
function extractAUD(summary) {
  try {
    const balances = summary?.data?.wise?.balances;
    if (!Array.isArray(balances)) return null;
    const aud = balances.find(b => b?.currency === 'AUD' || b?.amount?.currency === 'AUD');
    return aud?.amount?.value ?? null;
  } catch { return null; }
}

function extractBSB(summary) {
  try {
    const details = summary?.data?.wise?.account_details;
    if (!Array.isArray(details)) return null;
    for (const d of details) {
      if (d?.bsb) return { bsb: d.bsb, account: d.account_number || d.accountNumber };
      if (d?.details) {
        const inner = Array.isArray(d.details) ? d.details : [d.details];
        for (const i of inner) {
          if (i?.bsb) return { bsb: i.bsb, account: i.account_number || i.accountNumber };
        }
      }
    }
    return null;
  } catch { return null; }
}

function extractBTC(summary) {
  try {
    const accs = summary?.data?.independent_reserve?.accounts;
    if (!Array.isArray(accs)) return null;
    const btc = accs.find(a => a?.currency === 'BTC' || a?.CurrencyCode === 'Xbt');
    if (btc) return btc.balance ?? btc.TotalBalance ?? btc.available ?? null;
    return null;
  } catch { return null; }
}

function extractIRAUD(summary) {
  try {
    const accs = summary?.data?.independent_reserve?.accounts;
    if (!Array.isArray(accs)) return null;
    const aud = accs.find(a => a?.currency === 'AUD' || a?.CurrencyCode === 'Aud');
    if (aud) return aud.balance ?? aud.TotalBalance ?? aud.available ?? null;
    return null;
  } catch { return null; }
}

function extractXMR(summary) {
  try {
    return summary?.data?.xmr?.balance ?? null;
  } catch { return null; }
}

function extractXMRAddress(summary) {
  try {
    return summary?.data?.xmr?.primary_address ?? null;
  } catch { return null; }
}

function extractCBA(summary) {
  try {
    const accs = summary?.data?.basiq?.accounts;
    if (!Array.isArray(accs)) return null;
    const cba = accs.find(a =>
      /commonwealth/i.test(a?.institution || '') ||
      /cba/i.test(a?.institution || '') ||
      /commbank/i.test(a?.name || '')
    ) || accs[0];
    return cba?.balance ?? cba?.availableFunds ?? null;
  } catch { return null; }
}

function extractPrices(summary) {
  try {
    return summary?.data?.market?.crypto_prices ?? null;
  } catch { return null; }
}

function extractForex(summary) {
  try {
    return summary?.data?.market?.forex_rates?.rates ?? null;
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CATEGORY EMOJI MAP
═══════════════════════════════════════════════════════════════════════════ */
const CAT_EMOJI = {
  purchase: '\u{1F6D2}',
  conversion: '\u{1F4B1}',
  send: '\u{1F4E4}',
  receive: '\u{1F4E5}',
  deposit: '\u{1F4B0}',
  withdrawal: '\u{1F3E6}',
  trade: '\u{1F4B9}',
  roundup: '\u{26A1}',
  transfer: '\u{21C4}',
  default: '\u{1F4B3}',
};

function txEmoji(type) {
  return CAT_EMOJI[type?.toLowerCase()] || CAT_EMOJI.default;
}

function txIsInbound(tx) {
  const t = tx?.type?.toLowerCase() || '';
  return t === 'receive' || t === 'deposit' || tx?.direction === 'inbound';
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: HEADER (fixed, 44pt)
═══════════════════════════════════════════════════════════════════════════ */
const Header = memo(function Header() {
  const openSheet = usePayStore(s => s.openSheet);
  return (
    <div className="kp-header">
      <span className="kp-header-title">KUROPay</span>
      <button className="kp-header-btn" onClick={() => openSheet('settings')}>
        <Settings size={18} />
      </button>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   HOOK: COUNT-UP ANIMATION
═══════════════════════════════════════════════════════════════════════════ */
function useCountUp(target, duration = 600) {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current;
    const diff = target - start;
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(start + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
      else prev.current = target;
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: HERO BALANCE
═══════════════════════════════════════════════════════════════════════════ */
const HeroBalance = memo(function HeroBalance() {
  const summary = usePayStore(s => s.summary);
  const summaryLoading = usePayStore(s => s.summaryLoading);
  const summaryUpdatedAt = usePayStore(s => s.summaryUpdatedAt);
  const fetchSummary = usePayStore(s => s.fetchSummary);
  const fetchFeed = usePayStore(s => s.fetchFeed);
  const feed = usePayStore(s => s.feed);
  const openSheet = usePayStore(s => s.openSheet);

  const audBal = extractAUD(summary);
  const animatedBalance = useCountUp(audBal || 0);

  // Compute weekly delta from feed
  const weekDelta = React.useMemo(() => {
    if (!feed || feed.length === 0) return null;
    const weekAgo = Date.now() - 7 * 86400000;
    let delta = 0;
    for (const tx of feed) {
      if (!tx.created_at && !tx.timestamp) continue;
      const ts = new Date(tx.created_at || tx.timestamp).getTime();
      if (ts < weekAgo) continue;
      const amt = tx.amount_minor ?? tx.amount ?? 0;
      if (tx.currency && tx.currency !== 'AUD') continue;
      delta += txIsInbound(tx) ? Math.abs(amt) : -Math.abs(amt);
    }
    return delta;
  }, [feed]);

  const pills = [
    { icon: ArrowDown, label: 'Add Money', sheet: 'add' },
    { icon: ArrowUp, label: 'Pay / Send', sheet: 'send' },
    { icon: ArrowLeftRight, label: 'Convert', sheet: 'convert' },
    { icon: MoreHorizontal, label: 'More', sheet: 'settings' },
  ];

  return (
    <div className="kp-section kp-hero">
      <div className="kp-hero-gradient" />
      <div className="kp-hero-content">
        <span className="kp-hero-label">KURO FLOAT</span>
        <div className="kp-hero-balance">
          {summaryLoading && audBal === null
            ? <span className="kp-skeleton kp-skeleton-lg">&nbsp;</span>
            : audBal !== null
              ? <>AUD {fmtAUD(animatedBalance)}</>
              : <>&mdash;</>
          }
        </div>
        <div className={`kp-hero-delta ${weekDelta === null ? 'kp-muted' : weekDelta >= 0 ? 'kp-green' : 'kp-red'}`}>
          {weekDelta === null
            ? 'syncing...'
            : weekDelta >= 0
              ? `+$${fmtAUD(Math.abs(weekDelta))} this week`
              : `-$${fmtAUD(Math.abs(weekDelta))} this week`
          }
        </div>
        <div className="kp-hero-pills">
          {pills.map(p => (
            <button key={p.sheet} className="kp-pill" onClick={() => { try { navigator.vibrate?.([10]); } catch {} openSheet(p.sheet); }}>
              <p.icon size={16} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        <div className="kp-sync-chip" onClick={() => { navigator.vibrate?.([5]); fetchSummary(); fetchFeed(true); }}>
          {summaryLoading ? 'Syncing...' : summaryUpdatedAt ? `Synced ${fmtTime(new Date(summaryUpdatedAt).toISOString())}` : 'Tap to sync'}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: ACCOUNTS CAROUSEL
═══════════════════════════════════════════════════════════════════════════ */
const AccountsCarousel = memo(function AccountsCarousel() {
  const summary = usePayStore(s => s.summary);
  const openSheet = usePayStore(s => s.openSheet);
  const scrollRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const prices = extractPrices(summary);
  const audBal = extractAUD(summary);
  const btcBal = extractBTC(summary);
  const xmrBal = extractXMR(summary);
  const cbaBal = extractCBA(summary);
  const bsbInfo = extractBSB(summary);

  const btcAudPrice = prices?.bitcoin?.aud ?? null;
  const btcChange = prices?.bitcoin?.aud_24h_change ?? null;
  const xmrAudPrice = prices?.monero?.aud ?? null;

  const btcAudValue = btcBal != null && btcAudPrice != null ? btcBal * btcAudPrice : null;
  const xmrAudValue = xmrBal != null && xmrAudPrice != null ? (xmrBal / 1e12) * xmrAudPrice : null;

  const cards = [
    {
      id: 'aud',
      label: 'AUD Float',
      balance: audBal != null ? `$${fmtAUD(audBal)}` : '--',
      sub: 'Wise \u00B7 Available now',
      chip: bsbInfo ? `BSB ${bsbInfo.bsb}` : null,
      chipCopy: bsbInfo ? `${bsbInfo.bsb} / ${bsbInfo.account}` : null,
    },
    {
      id: 'btc',
      label: 'BTC',
      balance: btcBal != null ? `${fmtBTC(btcBal * 1e8)}` : '--',
      sub: btcAudValue != null ? `\u2248 AUD ${fmtAUD(btcAudValue)} \u00B7 IR Exchange` : 'IR Exchange',
      chip: btcChange != null ? `${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}%` : null,
      chipColor: btcChange >= 0 ? 'green' : 'red',
    },
    {
      id: 'xmr',
      label: 'XMR',
      balance: xmrBal != null ? fmtXMR(xmrBal) : '--',
      sub: xmrAudValue != null ? `\u2248 AUD ${fmtAUD(xmrAudValue)} \u00B7 Wallet` : 'Wallet',
      chip: xmrBal != null ? null : '\u25CF Offline',
      chipColor: 'amber',
    },
    {
      id: 'cba',
      label: 'CBA',
      balance: cbaBal != null ? `$${fmtAUD(cbaBal)}` : '--',
      sub: 'Commonwealth Bank \u00B7 Read only',
      muted: true,
    },
  ];

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = el.offsetWidth * 0.88;
    const idx = Math.round(el.scrollLeft / cardW);
    setActiveIdx(clamp(idx, 0, cards.length - 1));
  }, [cards.length]);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  return (
    <div className="kp-section">
      <div className="kp-carousel" ref={scrollRef} onScroll={handleScroll}>
        {cards.map((c, i) => (
          <div
            key={c.id}
            className={`kp-card-account ${c.muted ? 'kp-muted-card' : ''}`}
            onClick={() => openSheet('account', { type: c.id })}
          >
            <div className="kp-card-account-top">
              <span className="kp-card-account-label">{c.label}</span>
              {c.chip && (
                <button
                  className={`kp-chip kp-chip-${c.chipColor || 'default'}`}
                  onClick={(e) => { e.stopPropagation(); if (c.chipCopy) handleCopy(c.chipCopy); }}
                >
                  {c.chipCopy && (copied ? <Check size={10} /> : <Copy size={10} />)}
                  <span>{c.chip}</span>
                </button>
              )}
            </div>
            <div className="kp-card-account-balance">{c.balance}</div>
            <div className="kp-card-account-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="kp-dots">
        {cards.map((_, i) => (
          <div key={i} className={`kp-dot ${i === activeIdx ? 'kp-dot-active' : ''}`} />
        ))}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: VAULTS
═══════════════════════════════════════════════════════════════════════════ */
const VaultsSection = memo(function VaultsSection() {
  const vaults = usePayStore(s => s.vaults);
  const vaultsLoading = usePayStore(s => s.vaultsLoading);
  const openSheet = usePayStore(s => s.openSheet);

  return (
    <div className="kp-section">
      <div className="kp-section-header">
        <span className="kp-section-title">VAULTS</span>
        {vaults.length > 0 && (
          <button className="kp-link" onClick={() => openSheet('settings')}>Manage &rarr;</button>
        )}
      </div>
      {vaultsLoading && vaults.length === 0 ? (
        <div className="kp-vault-grid">
          <div className="kp-skeleton kp-skeleton-vault" />
          <div className="kp-skeleton kp-skeleton-vault" />
        </div>
      ) : vaults.length === 0 ? (
        <button className="kp-vault-empty" onClick={() => openSheet('newVault')}>
          <Plus size={24} />
          <span>Create your first vault</span>
        </button>
      ) : (
        <div className="kp-vault-grid">
          {vaults.map(v => {
            const pct = v.goal_minor && v.goal_minor > 0
              ? clamp((v.current_minor || 0) / v.goal_minor, 0, 1)
              : 0;
            return (
              <button key={v.id} className="kp-vault-card" onClick={() => openSheet('vault', { id: v.id })}>
                <span className="kp-vault-emoji">{v.emoji || '\u{1F4B0}'}</span>
                <span className="kp-vault-name">{v.name}</span>
                <VaultArc pct={pct} />
                <span className="kp-vault-amounts">
                  ${fmtAUD((v.current_minor || 0) / 100)}
                  {v.goal_minor > 0 && <> / ${fmtAUD(v.goal_minor / 100)}</>}
                </span>
              </button>
            );
          })}
          <button className="kp-vault-card kp-vault-new" onClick={() => openSheet('newVault')}>
            <Plus size={20} className="kp-accent" />
            <span className="kp-vault-name">New Vault</span>
          </button>
        </div>
      )}
    </div>
  );
});

function VaultArc({ pct }) {
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimPct(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);
  const r = 18, c = 2 * Math.PI * r;
  const offset = c - (c * Math.min(animPct * 100, 100) / 100);
  return (
    <svg className="kp-vault-arc" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--accent)" strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 22 22)"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
      <text x="22" y="24" textAnchor="middle" fill="var(--text-2)" fontSize="10" fontFamily="'SF Mono','Menlo',monospace">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: PULL-TO-STACK
═══════════════════════════════════════════════════════════════════════════ */
const PullToStack = memo(function PullToStack() {
  const triggerRoundUp = usePayStore(s => s.triggerRoundUp);
  const pendingCents = usePayStore(s => s.pendingRoundUpCents);
  const [pulling, setPulling] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [thresholdReached, setThresholdReached] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const startY = useRef(0);
  const sessionId = useRef(null);
  const hapticFired = useRef(false);

  const onTouchStart = useCallback((e) => {
    startY.current = e.touches[0].clientY;
    setPulling(true);
    setTriggered(false);
    setThresholdReached(false);
    setReleasing(false);
    hapticFired.current = false;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!pulling) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      const dampened = delta * 0.4;
      setPullY(Math.min(dampened, 60));
      if (dampened > 40 && !hapticFired.current) {
        hapticFired.current = true;
        setThresholdReached(true);
        try { navigator.vibrate?.([10, 30, 10]); } catch {}
      }
    }
  }, [pulling]);

  const onTouchEnd = useCallback(() => {
    if (pullY > 40) {
      setTriggered(true);
      triggerRoundUp(sessionId.current);
    }
    setPulling(false);
    setReleasing(true);
    setPullY(0);
    setTimeout(() => setReleasing(false), 400);
  }, [pullY, triggerRoundUp]);

  return (
    <div
      className={`kp-section kp-pull-strip ${thresholdReached && pulling ? 'kp-pull-ready' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: `translateY(${pullY}px)`,
        transition: releasing ? 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
      }}
    >
      <span className="kp-pull-label">
        {triggered ? 'STACKED' : thresholdReached && pulling ? '\u2193 RELEASE TO STACK' : '\u2193 PULL TO STACK SPARE CHANGE \u2192 BTC'}
      </span>
      <span className="kp-pull-icon">{'\u20BF'}</span>
      {pendingCents > 0 && (
        <span className="kp-pull-badge">{pendingCents}c</span>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: ACTIVITY FEED
═══════════════════════════════════════════════════════════════════════════ */
const FEED_FILTERS = ['All', 'Deposits', 'Sends', 'Conversions', 'Vaults'];
const FEED_FILTER_MAP = {
  All: null,
  Deposits: ['deposit', 'receive'],
  Sends: ['send', 'withdrawal'],
  Conversions: ['conversion', 'trade', 'convert'],
  Vaults: ['vault', 'roundup'],
};

const ActivityFeed = memo(function ActivityFeed() {
  const feed = usePayStore(s => s.feed);
  const feedLoading = usePayStore(s => s.feedLoading);
  const feedHasMore = usePayStore(s => s.feedHasMore);
  const loadMoreFeed = usePayStore(s => s.loadMoreFeed);
  const openSheet = usePayStore(s => s.openSheet);
  const sentinelRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && feedHasMore) loadMoreFeed(); },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [feedHasMore, loadMoreFeed]);

  // Filtered + searched feed
  const filteredFeed = React.useMemo(() => {
    let items = feed;
    // Apply type filter
    const types = FEED_FILTER_MAP[activeFilter];
    if (types) {
      items = items.filter(tx => {
        const t = (tx.type || '').toLowerCase();
        return types.some(ft => t.includes(ft));
      });
    }
    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(tx =>
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.external_id || '').toLowerCase().includes(q) ||
        (tx.type || '').toLowerCase().includes(q) ||
        (tx.to || '').toLowerCase().includes(q) ||
        (tx.from || '').toLowerCase().includes(q)
      );
    }
    return items;
  }, [feed, activeFilter, searchQuery]);

  // Group feed by date
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const tx of filteredFeed) {
      const d = new Date(tx.created_at || tx.timestamp || Date.now());
      const key = dateGroupLabel(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tx);
    }
    return [...map.entries()];
  }, [filteredFeed]);

  return (
    <div className="kp-section">
      <div className="kp-section-header">
        <span className="kp-section-title">ACTIVITY</span>
      </div>

      {/* Sticky search bar */}
      <div className="kp-activity-search">
        <Search size={14} className="kp-muted" />
        <input
          className="kp-activity-search-input"
          placeholder="Search transactions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="kp-activity-search-clear" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="kp-filter-pills">
        {FEED_FILTERS.map(f => (
          <button
            key={f}
            className={`kp-filter-pill ${activeFilter === f ? 'kp-filter-pill-active' : ''}`}
            onClick={() => setActiveFilter(f)}
          >{f}</button>
        ))}
      </div>

      {filteredFeed.length === 0 && !feedLoading && (
        <div className="kp-empty">{searchQuery || activeFilter !== 'All' ? 'No matching transactions' : 'No activity yet'}</div>
      )}
      {feed.length === 0 && feedLoading && (
        <div className="kp-tx-skeletons">
          {[0,1,2,3].map(i => <div key={i} className="kp-skeleton kp-skeleton-tx" />)}
        </div>
      )}
      {groups.map(([label, txs]) => (
        <div key={label} className="kp-date-group">
          <div className="kp-date-label">{label}</div>
          {txs.map(tx => (
            <TxRow key={tx.id || tx.hash || Math.random()} tx={tx} onTap={() => openSheet('tx', { id: tx.id, tx })} />
          ))}
        </div>
      ))}
      {feedLoading && feed.length > 0 && (
        <div className="kp-loading-more"><div className="kp-spinner" /></div>
      )}
      <div ref={sentinelRef} className="kp-sentinel" />
    </div>
  );
});

function dateGroupLabel(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today - target) / 86400000;
  if (diff < 1) return 'Today';
  if (diff < 2) return 'Yesterday';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function TxRow({ tx, onTap }) {
  const [pressed, setPressed] = useState(false);
  const inbound = txIsInbound(tx);
  const cur = (tx.currency || 'AUD').toUpperCase();
  const rawAmt = tx.amount_minor ?? tx.amount ?? 0;

  let display;
  if (cur === 'BTC') display = fmtBTC(Math.abs(rawAmt));
  else if (cur === 'XMR') display = fmtXMR(Math.abs(rawAmt));
  else display = '$' + fmtAUD(Math.abs(rawAmt) / 100);

  return (
    <div
      className={`kp-tx-row ${pressed ? 'kp-tx-pressed' : ''}`}
      onClick={onTap}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onTouchCancel={() => setPressed(false)}
    >
      <div className="kp-tx-icon">{txEmoji(tx.type)}</div>
      <div className="kp-tx-info">
        <span className="kp-tx-desc">{tx.description || tx.external_id || tx.type || 'Transaction'}</span>
        <span className="kp-tx-meta">
          {tx.type || 'tx'}
          {tx.status === 'pending' && <span className="kp-pulse-dot" />}
          {tx.created_at || tx.timestamp ? ` \u00B7 ${fmtTime(tx.created_at || tx.timestamp)}` : ''}
        </span>
      </div>
      <div className={`kp-tx-amount ${inbound ? 'kp-green' : 'kp-red'}`}>
        {inbound ? '+' : '-'}{display}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: INTELLIGENCE
═══════════════════════════════════════════════════════════════════════════ */
const IntelligenceSection = memo(function IntelligenceSection() {
  const latestInsight = usePayStore(s => s.latestInsight);
  const insightLoading = usePayStore(s => s.insightLoading);
  const refreshInsight = usePayStore(s => s.refreshInsight);

  const signals = latestInsight?.signals || latestInsight?.data?.signals || [];
  const marketCtx = latestInsight?.market_context || latestInsight?.data?.market_context || '';
  const riskNote = latestInsight?.risk_note || latestInsight?.data?.risk_note || '';
  const awarenessNote = latestInsight?.awareness_note || latestInsight?.data?.awareness_note || '';

  const signalColor = (sig) => {
    const s = (sig || '').toLowerCase();
    if (s === 'accumulate' || s === 'buy') return 'green';
    if (s === 'hold') return 'amber';
    if (s === 'reduce' || s === 'sell') return 'red';
    if (s === 'watch') return 'blue';
    return 'default';
  };

  return (
    <div className="kp-section">
      <div className="kp-section-header">
        <span className="kp-section-title">INTELLIGENCE</span>
        <span className="kp-badge-chip">DEEP SIGNAL</span>
      </div>

      {!latestInsight && insightLoading && (
        <div className="kp-insight-skeleton">
          <div className="kp-skeleton" style={{ height: 14, width: '90%', marginBottom: 8 }} />
          <div className="kp-skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
          <div className="kp-skeleton" style={{ height: 28, width: '100%' }} />
        </div>
      )}

      {!latestInsight && !insightLoading && (
        <div className="kp-empty">No insights yet</div>
      )}

      {latestInsight && (
        <div className="kp-insight-card">
          {marketCtx && <p className="kp-insight-ctx">{marketCtx}</p>}

          {signals.length > 0 && (
            <div className="kp-signals-scroll">
              {signals.map((sig, i) => (
                <div key={i} className="kp-signal-chip">
                  <span className="kp-signal-asset">{sig.asset || sig.name || '?'}</span>
                  <span className={`kp-signal-badge kp-chip-${signalColor(sig.signal || sig.action)}`}>
                    {sig.signal || sig.action || '?'}
                  </span>
                  {sig.confidence && <span className="kp-signal-conf">{sig.confidence}</span>}
                </div>
              ))}
            </div>
          )}

          {riskNote && <p className="kp-insight-risk">{riskNote}</p>}
          {awarenessNote && <div className="kp-insight-awareness">{awarenessNote}</div>}
        </div>
      )}

      <button className="kp-refresh-btn" onClick={() => refreshInsight()} disabled={insightLoading}>
        <RefreshCw size={14} className={insightLoading ? 'kp-spin' : ''} />
        <span>{insightLoading ? 'Refreshing...' : 'Refresh'}</span>
      </button>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION: MARKET TICKER
═══════════════════════════════════════════════════════════════════════════ */
const MarketTicker = memo(function MarketTicker() {
  const summary = usePayStore(s => s.summary);
  const prices = extractPrices(summary);
  const forex = extractForex(summary);

  const tickers = [];

  if (prices?.bitcoin) {
    tickers.push({
      pair: 'BTC/AUD',
      price: prices.bitcoin.aud,
      change: prices.bitcoin.aud_24h_change,
    });
  }
  if (prices?.monero) {
    tickers.push({
      pair: 'XMR/AUD',
      price: prices.monero.aud,
      change: prices.monero.aud_24h_change,
    });
  }
  if (forex?.USD) {
    tickers.push({
      pair: 'USD/AUD',
      price: 1 / forex.USD,
      change: null,
    });
  }
  if (forex?.EUR) {
    tickers.push({
      pair: 'EUR/AUD',
      price: 1 / forex.EUR,
      change: null,
    });
  }

  if (tickers.length === 0) return null;

  return (
    <div className="kp-section">
      <div className="kp-section-header">
        <span className="kp-section-title">LIVE RATES</span>
      </div>
      <div className="kp-ticker-scroll">
        {tickers.map(t => (
          <div key={t.pair} className="kp-ticker-card">
            <span className="kp-ticker-pair">{t.pair}</span>
            <span className="kp-ticker-price">
              {t.price != null ? fmtAUD(t.price) : '--'}
            </span>
            {t.change != null && (
              <span className={`kp-chip kp-chip-${t.change >= 0 ? 'green' : 'red'}`}>
                {t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%
              </span>
            )}
            <MiniSparkline positive={t.change == null || t.change >= 0} />
          </div>
        ))}
      </div>
    </div>
  );
});

function MiniSparkline({ positive }) {
  // Static decorative sparkline
  const pts = positive
    ? 'M0,20 L5,18 L10,19 L15,15 L20,16 L25,10 L30,12 L35,6 L40,4'
    : 'M0,4 L5,6 L10,5 L15,10 L20,8 L25,14 L30,16 L35,18 L40,20';
  return (
    <svg className="kp-sparkline" width="40" height="24" viewBox="0 0 40 24">
      <path d={pts} fill="none" stroke={positive ? 'var(--green)' : 'var(--red)'} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET OVERLAY + BOTTOM SHEET
═══════════════════════════════════════════════════════════════════════════ */
function SheetOverlay() {
  const activeSheet = usePayStore(s => s.activeSheet);
  const sheetData = usePayStore(s => s.sheetData);
  const closeSheet = usePayStore(s => s.closeSheet);

  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const sheetRef = useRef(null);

  // Haptic on sheet open
  useEffect(() => {
    try { navigator.vibrate?.([10]); } catch {}
  }, []);

  const onTouchStart = useCallback((e) => {
    // Only allow drag from top 48px (handle area)
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.touches[0].clientY - rect.top > 48) return;
    startY.current = e.touches[0].clientY;
    setDragging(true);
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!dragging) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) setDragY(delta);
  }, [dragging]);

  const onTouchEnd = useCallback(() => {
    if (dragY > 80) {
      closeSheet();
    }
    setDragY(0);
    setDragging(false);
  }, [dragY, closeSheet]);

  const renderContent = () => {
    switch (activeSheet) {
      case 'send': return <SendSheet />;
      case 'convert': return <ConvertSheet />;
      case 'add': return <AddSheet />;
      case 'vault': return <VaultDetailSheet data={sheetData} />;
      case 'newVault': return <NewVaultSheet />;
      case 'tx': return <TxDetailSheet data={sheetData} />;
      case 'settings': return <SettingsSheet />;
      case 'account': return <AccountSheet data={sheetData} />;
      default: return null;
    }
  };

  return (
    <div className="kp-sheet-overlay" onClick={closeSheet}>
      <div
        ref={sheetRef}
        className="kp-sheet"
        style={{ transform: `translateY(${dragY}px)` }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="kp-sheet-handle" />
        {renderContent()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: SEND
═══════════════════════════════════════════════════════════════════════════ */
/* ── Payee address validators ──────────────────────────────────────────── */
const VALIDATORS = {
  bsb: (bsb, acct) => {
    const bsbClean = (bsb || '').replace(/[-\s]/g, '');
    const acctClean = (acct || '').replace(/\s/g, '');
    return /^\d{6}$/.test(bsbClean) && /^\d{5,9}$/.test(acctClean);
  },
  payid: (v) => /@/.test(v || '') || /^\+61\d{9}$/.test((v || '').replace(/\s/g, '')),
  xmr: (v) => /^4/.test(v || '') && (v || '').length === 95,
  btc: (v) => /^(1|3|bc1)/.test(v || '') && (v || '').length >= 26 && (v || '').length <= 62,
};

const formatBSB = (v) => {
  const d = (v || '').replace(/\D/g, '').slice(0, 6);
  return d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
};

const feePreview = (currency) => {
  if (currency === 'AUD') return 'Wise transfer fee: ~$0.50-2.00';
  if (currency === 'BTC') return 'BTC network fee: ~0.00001 BTC';
  if (currency === 'XMR') return 'XMR network fee: ~0.00001 XMR';
  return '';
};

function SendSheet() {
  const recentContacts = usePayStore(s => s.recentContacts);
  const addRecentContact = usePayStore(s => s.addRecentContact);
  const executeOp = usePayStore(s => s.executeOp);
  const activeOp = usePayStore(s => s.activeOp);
  const clearActiveOp = usePayStore(s => s.clearActiveOp);
  const closeSheet = usePayStore(s => s.closeSheet);
  const payees = usePayStore(s => s.payees);
  const payeesLoading = usePayStore(s => s.payeesLoading);
  const fetchPayees = usePayStore(s => s.fetchPayees);
  const createPayee = usePayStore(s => s.createPayee);
  const togglePayeeFavourite = usePayStore(s => s.togglePayeeFavourite);

  const [address, setAddress] = useState('');
  const [bsb, setBsb] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [note, setNote] = useState('');
  const [step, setStep] = useState('form'); // form | confirm | executing | done | addPayee
  const [error, setError] = useState(null);
  const [selectedPayee, setSelectedPayee] = useState(null);
  const [savePayee, setSavePayee] = useState(false);
  const sessionId = useRef(crypto.randomUUID()).current;

  // New payee form state
  const [newPayeeName, setNewPayeeName] = useState('');
  const [newPayeeType, setNewPayeeType] = useState('bsb');
  const [newPayeeBsb, setNewPayeeBsb] = useState('');
  const [newPayeeAccount, setNewPayeeAccount] = useState('');
  const [newPayeePayid, setNewPayeePayid] = useState('');
  const [newPayeeCryptoAddr, setNewPayeeCryptoAddr] = useState('');
  const [payeeSaving, setPayeeSaving] = useState(false);

  const currencies = ['AUD', 'BTC', 'XMR'];

  useEffect(() => { fetchPayees(); }, [fetchPayees]);

  // Sort payees: favourites first, then alphabetical
  const sortedPayees = React.useMemo(() => {
    if (!payees || payees.length === 0) return [];
    return [...payees].sort((a, b) => {
      if (a.favourite && !b.favourite) return -1;
      if (!a.favourite && b.favourite) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [payees]);

  // Validate current address based on currency
  const addressValid = React.useMemo(() => {
    if (selectedPayee) return true;
    if (currency === 'AUD') {
      if (bsb || accountNumber) return VALIDATORS.bsb(bsb, accountNumber);
      return VALIDATORS.payid(address);
    }
    if (currency === 'BTC') return VALIDATORS.btc(address);
    if (currency === 'XMR') return VALIDATORS.xmr(address);
    return address.trim().length > 0;
  }, [address, bsb, accountNumber, currency, selectedPayee]);

  const selectPayee = (p) => {
    setSelectedPayee(p);
    if (p.type === 'bsb') {
      setBsb(p.bsb || '');
      setAccountNumber(p.account_number || '');
      setCurrency('AUD');
    } else if (p.type === 'payid') {
      setAddress(p.payid || '');
      setCurrency('AUD');
    } else if (p.type === 'xmr') {
      setAddress(p.crypto_address || '');
      setCurrency('XMR');
    } else if (p.type === 'btc') {
      setAddress(p.crypto_address || '');
      setCurrency('BTC');
    }
  };

  const resolvedAddress = () => {
    if (selectedPayee?.type === 'bsb') return `${bsb} / ${accountNumber}`;
    return address.trim();
  };

  const handlePreview = () => {
    if (!amount.trim()) return;
    if (!addressValid) { setError('Invalid address'); return; }
    setError(null);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    setStep('executing');
    setError(null);
    try {
      const payload = {
        to: resolvedAddress(),
        amount: parseFloat(amount),
        currency,
        note: note.trim() || undefined,
      };
      if (currency === 'AUD' && (bsb || accountNumber)) {
        payload.bsb = bsb.replace(/[-\s]/g, '');
        payload.account_number = accountNumber.replace(/\s/g, '');
      }
      await executeOp('/api/pay/ops/send', payload, sessionId);
      addRecentContact({ address: resolvedAddress(), currency, name: selectedPayee?.name || resolvedAddress().slice(0, 8) });
      if (savePayee && !selectedPayee) {
        try {
          const payeeData = { name: resolvedAddress().slice(0, 20), currency };
          if (currency === 'AUD' && bsb) {
            payeeData.type = 'bsb';
            payeeData.bsb = bsb.replace(/[-\s]/g, '');
            payeeData.account_number = accountNumber;
          } else if (currency === 'AUD') {
            payeeData.type = 'payid';
            payeeData.payid = address.trim();
          } else if (currency === 'XMR') {
            payeeData.type = 'xmr';
            payeeData.crypto_address = address.trim();
          } else if (currency === 'BTC') {
            payeeData.type = 'btc';
            payeeData.crypto_address = address.trim();
          }
          await createPayee(payeeData);
        } catch {}
      }
      setStep('done');
    } catch (e) {
      setError(e.message || 'Send failed');
      setStep('confirm');
    }
  };

  const handleSaveNewPayee = async () => {
    if (!newPayeeName.trim()) return;
    setPayeeSaving(true);
    try {
      const payeeData = { name: newPayeeName.trim(), type: newPayeeType, currency: newPayeeType === 'xmr' ? 'XMR' : newPayeeType === 'btc' ? 'BTC' : 'AUD' };
      if (newPayeeType === 'bsb') {
        payeeData.bsb = newPayeeBsb.replace(/[-\s]/g, '');
        payeeData.account_number = newPayeeAccount.replace(/\s/g, '');
      } else if (newPayeeType === 'payid') {
        payeeData.payid = newPayeePayid.trim();
      } else {
        payeeData.crypto_address = newPayeeCryptoAddr.trim();
      }
      await createPayee(payeeData);
      setStep('form');
      setNewPayeeName(''); setNewPayeeBsb(''); setNewPayeeAccount(''); setNewPayeePayid(''); setNewPayeeCryptoAddr('');
    } catch (e) {
      setError(e.message || 'Failed to save payee');
    }
    setPayeeSaving(false);
  };

  // Validate new payee fields
  const newPayeeValid = React.useMemo(() => {
    if (!newPayeeName.trim()) return false;
    if (newPayeeType === 'bsb') return VALIDATORS.bsb(newPayeeBsb, newPayeeAccount);
    if (newPayeeType === 'payid') return VALIDATORS.payid(newPayeePayid);
    if (newPayeeType === 'xmr') return VALIDATORS.xmr(newPayeeCryptoAddr);
    if (newPayeeType === 'btc') return VALIDATORS.btc(newPayeeCryptoAddr);
    return false;
  }, [newPayeeName, newPayeeType, newPayeeBsb, newPayeeAccount, newPayeePayid, newPayeeCryptoAddr]);

  if (activeOp && step === 'executing') {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Sending...</div>
        <OpStages stages={activeOp.stages} />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="kp-sheet-body kp-center">
        <div className="kp-done-check">&#10003;</div>
        <div className="kp-sheet-title">Sent</div>
        <p className="kp-muted">{amount} {currency} to {resolvedAddress().slice(0, 16)}...</p>
        <button className="kp-btn-primary" onClick={() => { clearActiveOp(); closeSheet(); }}>Done</button>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Confirm Send</div>
        <div className="kp-confirm-amount">{amount} {currency}</div>
        <div className="kp-confirm-to">To: {selectedPayee?.name || resolvedAddress()}</div>
        {note && <div className="kp-confirm-note">Note: {note}</div>}
        <div className="kp-muted" style={{ textAlign: 'center', fontSize: 12 }}>{feePreview(currency)}</div>
        {!selectedPayee && (
          <label className="kp-checkbox-row">
            <input type="checkbox" checked={savePayee} onChange={(e) => setSavePayee(e.target.checked)} />
            <span>Save this payee</span>
          </label>
        )}
        {error && <div className="kp-error">{error}</div>}
        <HoldToConfirm onComplete={handleConfirm} label="Hold to Send" />
        <button className="kp-btn-ghost" onClick={() => setStep('form')}>Back</button>
      </div>
    );
  }

  if (step === 'addPayee') {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Add New Payee</div>
        <input className="kp-input" placeholder="Name" value={newPayeeName} onChange={(e) => setNewPayeeName(e.target.value)} />
        <div className="kp-currency-pills">
          {['bsb', 'payid', 'xmr', 'btc'].map(t => (
            <button key={t} className={`kp-pill-sm ${newPayeeType === t ? 'kp-pill-active' : ''}`} onClick={() => setNewPayeeType(t)}>
              {t === 'bsb' ? 'BSB/Account' : t === 'payid' ? 'PayID' : t.toUpperCase()}
            </button>
          ))}
        </div>
        {newPayeeType === 'bsb' && (
          <>
            <div className="kp-input-with-dot">
              <input className="kp-input" placeholder="BSB (###-###)" value={newPayeeBsb} onChange={(e) => setNewPayeeBsb(formatBSB(e.target.value))} maxLength={7} inputMode="numeric" />
              <span className={`kp-validation-dot ${/^\d{3}-?\d{3}$/.test(newPayeeBsb.replace(/[-\s]/g, '').length === 6 ? newPayeeBsb : '') ? 'kp-vdot-green' : newPayeeBsb ? 'kp-vdot-red' : ''}`} />
            </div>
            <div className="kp-input-with-dot">
              <input className="kp-input" placeholder="Account Number" value={newPayeeAccount} onChange={(e) => setNewPayeeAccount(e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" />
              <span className={`kp-validation-dot ${/^\d{5,9}$/.test(newPayeeAccount) ? 'kp-vdot-green' : newPayeeAccount ? 'kp-vdot-red' : ''}`} />
            </div>
          </>
        )}
        {newPayeeType === 'payid' && (
          <div className="kp-input-with-dot">
            <input className="kp-input" placeholder="Email or +61..." value={newPayeePayid} onChange={(e) => setNewPayeePayid(e.target.value)} autoCapitalize="off" />
            <span className={`kp-validation-dot ${VALIDATORS.payid(newPayeePayid) ? 'kp-vdot-green' : newPayeePayid ? 'kp-vdot-red' : ''}`} />
          </div>
        )}
        {(newPayeeType === 'xmr' || newPayeeType === 'btc') && (
          <div className="kp-input-with-dot">
            <input className="kp-input" placeholder={newPayeeType === 'xmr' ? 'XMR address (starts with 4)' : 'BTC address'} value={newPayeeCryptoAddr} onChange={(e) => setNewPayeeCryptoAddr(e.target.value)} autoCapitalize="off" spellCheck={false} />
            <span className={`kp-validation-dot ${VALIDATORS[newPayeeType](newPayeeCryptoAddr) ? 'kp-vdot-green' : newPayeeCryptoAddr ? 'kp-vdot-red' : ''}`} />
          </div>
        )}
        {error && <div className="kp-error">{error}</div>}
        <button className="kp-btn-primary" onClick={handleSaveNewPayee} disabled={!newPayeeValid || payeeSaving}>
          {payeeSaving ? 'Saving...' : 'Save Payee'}
        </button>
        <button className="kp-btn-ghost" onClick={() => { setStep('form'); setError(null); }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="kp-sheet-body">
      <div className="kp-sheet-title">Pay / Send</div>

      {/* Saved payees list */}
      {(sortedPayees.length > 0 || payeesLoading) && (
        <div className="kp-payees-section">
          <span className="kp-add-section-label">SAVED PAYEES</span>
          {payeesLoading && sortedPayees.length === 0 && <div className="kp-skeleton" style={{ height: 48, marginBottom: 8 }} />}
          <div className="kp-payees-scroll">
            {sortedPayees.map(p => (
              <button
                key={p.id}
                className={`kp-payee-row ${selectedPayee?.id === p.id ? 'kp-payee-selected' : ''}`}
                onClick={() => selectPayee(p)}
              >
                <div className="kp-payee-avatar">{(p.name || '?').slice(0, 2).toUpperCase()}</div>
                <div className="kp-payee-info">
                  <span className="kp-payee-name">{p.name}{p.favourite ? ' *' : ''}</span>
                  <span className="kp-payee-type-badge">{(p.type || '').toUpperCase()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="kp-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('addPayee')}>
        <Plus size={14} /> Add New Payee
      </button>

      {/* Recent contacts fallback */}
      {recentContacts.length > 0 && sortedPayees.length === 0 && (
        <div className="kp-contacts-row">
          {recentContacts.slice(0, 8).map((c, i) => (
            <button key={i} className="kp-contact-circle" onClick={() => { setAddress(c.address); setCurrency(c.currency || 'AUD'); setSelectedPayee(null); }}>
              <span>{(c.name || c.address || '?').slice(0, 2).toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}

      {/* Address input with validation dot */}
      {currency === 'AUD' && !selectedPayee && (
        <>
          <div className="kp-input-with-dot">
            <input className="kp-input" placeholder="BSB (optional)" value={bsb} onChange={(e) => setBsb(formatBSB(e.target.value))} maxLength={7} inputMode="numeric" />
            <span className={`kp-validation-dot ${bsb && /^\d{3}-?\d{3}$/.test(bsb.replace(/\s/g, '')) ? 'kp-vdot-green' : bsb ? 'kp-vdot-red' : ''}`} />
          </div>
          {bsb && (
            <div className="kp-input-with-dot">
              <input className="kp-input" placeholder="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" />
              <span className={`kp-validation-dot ${/^\d{5,9}$/.test(accountNumber) ? 'kp-vdot-green' : accountNumber ? 'kp-vdot-red' : ''}`} />
            </div>
          )}
          {!bsb && (
            <div className="kp-input-with-dot">
              <input className="kp-input" placeholder="PayID (email or +61...)" value={address} onChange={(e) => setAddress(e.target.value)} autoCorrect="off" autoCapitalize="off" spellCheck={false} />
              <span className={`kp-validation-dot ${VALIDATORS.payid(address) ? 'kp-vdot-green' : address ? 'kp-vdot-red' : ''}`} />
            </div>
          )}
        </>
      )}
      {currency !== 'AUD' && !selectedPayee && (
        <div className="kp-input-with-dot">
          <input className="kp-input" placeholder={currency === 'XMR' ? 'XMR address (starts with 4)' : 'BTC address'} value={address} onChange={(e) => setAddress(e.target.value)} autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          <span className={`kp-validation-dot ${(currency === 'XMR' ? VALIDATORS.xmr(address) : VALIDATORS.btc(address)) ? 'kp-vdot-green' : address ? 'kp-vdot-red' : ''}`} />
        </div>
      )}

      {selectedPayee && (
        <div className="kp-selected-payee-banner">
          Sending to: <strong>{selectedPayee.name}</strong>
          <button className="kp-link" onClick={() => { setSelectedPayee(null); setAddress(''); setBsb(''); setAccountNumber(''); }} style={{ marginLeft: 8 }}>Change</button>
        </div>
      )}

      <input
        className="kp-input kp-input-amount"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        type="text"
      />

      <div className="kp-currency-pills">
        {currencies.map(c => (
          <button
            key={c}
            className={`kp-pill-sm ${currency === c ? 'kp-pill-active' : ''}`}
            onClick={() => { setCurrency(c); if (!selectedPayee) { setAddress(''); setBsb(''); setAccountNumber(''); } }}
          >{c}</button>
        ))}
      </div>

      <input
        className="kp-input kp-input-note"
        placeholder="Note (optional, 18 chars)"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 18))}
        maxLength={18}
      />

      <button className="kp-btn-primary" onClick={handlePreview} disabled={!addressValid || !amount.trim()}>
        Preview Send
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: CONVERT
═══════════════════════════════════════════════════════════════════════════ */
function QuoteCountdown({ expiresAt }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      if (diff <= 0) { setRemaining('Expired'); return; }
      setRemaining(`${diff}s`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [expiresAt]);
  return <span className={remaining === 'Expired' ? 'kp-red' : ''}>{remaining}</span>;
}

function ConvertSheet() {
  const getQuote = usePayStore(s => s.getQuote);
  const quote = usePayStore(s => s.quote);
  const quoteLoading = usePayStore(s => s.quoteLoading);
  const executeOp = usePayStore(s => s.executeOp);
  const activeOp = usePayStore(s => s.activeOp);
  const clearActiveOp = usePayStore(s => s.clearActiveOp);
  const closeSheet = usePayStore(s => s.closeSheet);

  const [fromCur, setFromCur] = useState('AUD');
  const [toCur, setToCur] = useState('BTC');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState('form'); // form | confirm | executing | done
  const [error, setError] = useState(null);
  const sessionId = useRef(crypto.randomUUID()).current;
  const debounceRef = useRef(null);

  const allCur = ['AUD', 'BTC', 'XMR', 'USD', 'EUR'];

  // Debounced quote
  useEffect(() => {
    if (!amount || isNaN(parseFloat(amount))) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      getQuote(fromCur, toCur, parseFloat(amount), sessionId);
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [amount, fromCur, toCur, getQuote, sessionId]);

  const swap = () => {
    setFromCur(toCur);
    setToCur(fromCur);
  };

  const handleConfirm = async () => {
    setStep('executing');
    setError(null);
    try {
      await executeOp('/api/pay/ops/convert', {
        from: fromCur,
        to: toCur,
        amount: parseFloat(amount),
      }, sessionId);
      setStep('done');
    } catch (e) {
      setError(e.message || 'Conversion failed');
      setStep('confirm');
    }
  };

  if (activeOp && step === 'executing') {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Converting...</div>
        <OpStages stages={activeOp.stages} />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="kp-sheet-body kp-center">
        <div className="kp-done-check">&#10003;</div>
        <div className="kp-sheet-title">Converted</div>
        <p className="kp-muted">{amount} {fromCur} &rarr; {toCur}</p>
        <button className="kp-btn-primary" onClick={() => { clearActiveOp(); closeSheet(); }}>Done</button>
      </div>
    );
  }

  if (step === 'confirm') {
    const isCryptoConvert = ['BTC', 'XMR'].includes(fromCur) || ['BTC', 'XMR'].includes(toCur);
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Confirm Conversion</div>
        <div className="kp-confirm-amount">{amount} {fromCur} &rarr; {toCur}</div>
        {quote && <div className="kp-muted">Estimated: {quote.estimated_output ?? '--'} {toCur}</div>}
        {quote?.fee != null && (
          <div className="kp-convert-fee-row">
            <span className="kp-muted">Fee:</span>
            <span>{typeof quote.fee === 'number' ? quote.fee.toFixed(4) : quote.fee} {quote.fee_currency || fromCur}</span>
          </div>
        )}
        {quote?.rate != null && (
          <div className="kp-convert-fee-row">
            <span className="kp-muted">Rate:</span>
            <span>1 {fromCur} = {typeof quote.rate === 'number' ? quote.rate.toFixed(6) : quote.rate} {toCur}</span>
          </div>
        )}
        {quote?.expires_at && (
          <div className="kp-convert-fee-row">
            <span className="kp-muted">Valid for:</span>
            <QuoteCountdown expiresAt={quote.expires_at} />
          </div>
        )}
        {isCryptoConvert && (
          <div className="kp-slippage-warning">
            Crypto conversions may incur slippage. Final amount may differ from estimate.
          </div>
        )}
        {error && <div className="kp-error">{error}</div>}
        <HoldToConfirm onComplete={handleConfirm} label="Hold to Convert" />
        <button className="kp-btn-ghost" onClick={() => setStep('form')}>Back</button>
      </div>
    );
  }

  return (
    <div className="kp-sheet-body">
      <div className="kp-sheet-title">Convert</div>

      <div className="kp-convert-row">
        <span className="kp-convert-label">FROM</span>
        <select className="kp-select" value={fromCur} onChange={(e) => setFromCur(e.target.value)}>
          {allCur.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <input
        className="kp-input kp-input-amount-lg"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        type="text"
      />

      <button className="kp-swap-btn" onClick={swap}>
        <ArrowLeftRight size={18} />
      </button>

      <div className="kp-convert-row">
        <span className="kp-convert-label">TO</span>
        <select className="kp-select" value={toCur} onChange={(e) => setToCur(e.target.value)}>
          {allCur.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="kp-quote-display">
        {quoteLoading
          ? <span className="kp-muted">Getting quote...</span>
          : quote
            ? (
              <>
                <span>Estimated: {quote.estimated_output ?? '--'} {toCur}</span>
                {quote.rate != null && (
                  <div className="kp-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Rate: 1 {fromCur} = {typeof quote.rate === 'number' ? quote.rate.toFixed(6) : quote.rate} {toCur}
                    {quote.fee != null && <> | Fee: {typeof quote.fee === 'number' ? quote.fee.toFixed(4) : quote.fee} {quote.fee_currency || fromCur}</>}
                  </div>
                )}
              </>
            )
            : <span className="kp-muted">Enter amount for quote</span>
        }
      </div>

      <button className="kp-btn-primary" onClick={() => setStep('confirm')} disabled={!amount || !quote}>
        Convert
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: ADD MONEY
═══════════════════════════════════════════════════════════════════════════ */
function AddSheet() {
  const summary = usePayStore(s => s.summary);
  const bsbInfo = extractBSB(summary);
  const xmrAddr = extractXMRAddress(summary);
  const [copiedField, setCopiedField] = useState(null);

  const handleCopy = (text, field) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <div className="kp-sheet-body">
      <div className="kp-sheet-title">Add Money</div>

      <div className="kp-add-section">
        <span className="kp-add-section-label">BANK TRANSFER</span>
        {bsbInfo ? (
          <>
            <CopyCell label="BSB" value={bsbInfo.bsb} copied={copiedField === 'bsb'} onCopy={() => handleCopy(bsbInfo.bsb, 'bsb')} />
            <CopyCell label="Account" value={bsbInfo.account} copied={copiedField === 'acct'} onCopy={() => handleCopy(bsbInfo.account, 'acct')} />
          </>
        ) : (
          <div className="kp-muted" style={{ padding: '12px 0' }}>Bank details unavailable</div>
        )}
      </div>

      <div className="kp-add-section">
        <span className="kp-add-section-label">CRYPTO</span>
        {xmrAddr ? (
          <CopyCell
            label="XMR Address"
            value={xmrAddr.slice(0, 16) + '...' + xmrAddr.slice(-8)}
            fullValue={xmrAddr}
            copied={copiedField === 'xmr'}
            onCopy={() => handleCopy(xmrAddr, 'xmr')}
          />
        ) : (
          <div className="kp-muted" style={{ padding: '12px 0' }}>No crypto addresses available</div>
        )}
      </div>
    </div>
  );
}

function CopyCell({ label, value, fullValue, copied, onCopy }) {
  return (
    <button className="kp-copy-cell" onClick={() => { try { navigator.vibrate?.([5]); } catch {} onCopy(); }}>
      <div className="kp-copy-cell-inner">
        <span className="kp-copy-label">{label}</span>
        <span className="kp-copy-value">{value}</span>
      </div>
      {copied ? <Check size={16} className="kp-green" /> : <Copy size={16} className="kp-muted" />}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: VAULT DETAIL
═══════════════════════════════════════════════════════════════════════════ */
function VaultDetailSheet({ data }) {
  const vaults = usePayStore(s => s.vaults);
  const depositToVault = usePayStore(s => s.depositToVault);
  const withdrawFromVault = usePayStore(s => s.withdrawFromVault);
  const feed = usePayStore(s => s.feed);
  const vault = vaults.find(v => v.id === data?.id);

  const [action, setAction] = useState(null); // null | 'deposit' | 'withdraw'
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState('input'); // input | confirm | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!vault) return <div className="kp-sheet-body"><div className="kp-muted">Vault not found</div></div>;

  const pct = vault.goal_minor > 0 ? clamp((vault.current_minor || 0) / vault.goal_minor, 0, 1) : 0;
  const cur = (vault.currency || 'AUD').toUpperCase();

  const fmtVaultAmount = (minor) => {
    if (cur === 'BTC') return fmtBTC(minor);
    if (cur === 'XMR') return fmtXMR(minor);
    return '$' + fmtAUD(minor / 100);
  };

  const parseToMinor = (str) => {
    const n = parseFloat(str);
    if (isNaN(n) || n <= 0) return 0;
    if (cur === 'BTC') return Math.round(n * 1e8);
    if (cur === 'XMR') return Math.round(n * 1e12);
    return Math.round(n * 100);
  };

  // Vault transaction history from feed
  const vaultTxs = React.useMemo(() => {
    if (!feed || !vault) return [];
    return feed.filter(tx =>
      tx.metadata?.vault_id === vault.id || tx.vault_id === vault.id
    ).slice(0, 10);
  }, [feed, vault]);

  const handleExecute = async () => {
    setBusy(true);
    setError(null);
    try {
      const minor = parseToMinor(amount);
      if (minor <= 0) { setError('Enter a valid amount'); setBusy(false); return; }
      if (action === 'deposit') {
        await depositToVault(vault.id, minor);
      } else {
        await withdrawFromVault(vault.id, minor);
      }
      try { navigator.vibrate?.([10, 30, 10]); } catch {}
      setStep('done');
    } catch (e) {
      setError(e.message || 'Operation failed');
    }
    setBusy(false);
  };

  if (step === 'done') {
    return (
      <div className="kp-sheet-body kp-center">
        <div className="kp-done-check">&#10003;</div>
        <div className="kp-sheet-title">{action === 'deposit' ? 'Deposited' : 'Withdrawn'}</div>
        <p className="kp-muted">{amount} {cur} {action === 'deposit' ? 'into' : 'from'} {vault.name}</p>
        <button className="kp-btn-primary" onClick={() => { setAction(null); setAmount(''); setStep('input'); }}>Done</button>
      </div>
    );
  }

  if (action && step === 'confirm') {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">Confirm {action === 'deposit' ? 'Deposit' : 'Withdrawal'}</div>
        <div className="kp-confirm-amount">{amount} {cur}</div>
        <div className="kp-confirm-to">{action === 'deposit' ? 'Into' : 'From'}: {vault.name}</div>
        {error && <div className="kp-error">{error}</div>}
        <HoldToConfirm onComplete={handleExecute} label={`Hold to ${action === 'deposit' ? 'Deposit' : 'Withdraw'}`} />
        <button className="kp-btn-ghost" onClick={() => setStep('input')}>Back</button>
      </div>
    );
  }

  if (action) {
    return (
      <div className="kp-sheet-body">
        <div className="kp-sheet-title">{action === 'deposit' ? 'Deposit to' : 'Withdraw from'} {vault.name}</div>
        <input
          className="kp-input kp-input-amount"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          type="text"
          autoFocus
        />
        <div className="kp-muted" style={{ textAlign: 'center', fontSize: 13 }}>
          {cur === 'BTC' ? 'Amount in BTC (e.g. 0.001)' : cur === 'XMR' ? 'Amount in XMR (e.g. 0.5)' : 'Amount in AUD (e.g. 50.00)'}
        </div>
        {error && <div className="kp-error">{error}</div>}
        <button className="kp-btn-primary" onClick={() => { if (parseToMinor(amount) > 0) setStep('confirm'); else setError('Enter a valid amount'); }} disabled={busy}>
          Preview
        </button>
        <button className="kp-btn-ghost" onClick={() => { setAction(null); setAmount(''); setError(null); }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="kp-sheet-body kp-center">
      <span className="kp-vault-detail-emoji">{vault.emoji || '\u{1F4B0}'}</span>
      <div className="kp-sheet-title">{vault.name}</div>
      <VaultArc pct={pct} />
      <div className="kp-vault-detail-amounts">
        <span className="kp-vault-detail-current">{fmtVaultAmount(vault.current_minor || 0)}</span>
        {vault.goal_minor > 0 && (
          <span className="kp-muted"> of {fmtVaultAmount(vault.goal_minor)}</span>
        )}
      </div>
      <div className="kp-vault-detail-bar">
        <div className="kp-vault-detail-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="kp-vault-actions">
        <button className="kp-btn-primary" style={{ flex: 1 }} onClick={() => setAction('deposit')}>Deposit</button>
        <button className="kp-btn-ghost" style={{ flex: 1 }} onClick={() => setAction('withdraw')}>Withdraw</button>
      </div>
      {vaultTxs.length > 0 && (
        <div style={{ width: '100%', marginTop: 8 }}>
          <span className="kp-section-title" style={{ display: 'block', marginBottom: 8 }}>HISTORY</span>
          {vaultTxs.map(tx => (
            <TxRow key={tx.id || tx.hash || Math.random()} tx={tx} onTap={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: NEW VAULT
═══════════════════════════════════════════════════════════════════════════ */
function NewVaultSheet() {
  const createVault = usePayStore(s => s.createVault);
  const closeSheet = usePayStore(s => s.closeSheet);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('\u{1F3AF}');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const emojis = ['\u{1F3AF}', '\u{2708}', '\u{1F3E0}', '\u{1F697}', '\u{1F393}', '\u{1F4BB}', '\u{1F381}', '\u{1F48E}', '\u{1F4B0}', '\u{26A1}'];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createVault(name.trim(), emoji, 'AUD', goal ? Math.round(parseFloat(goal) * 100) : 0);
      closeSheet();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="kp-sheet-body">
      <div className="kp-sheet-title">New Vault</div>

      <div className="kp-emoji-picker">
        {emojis.map(e => (
          <button key={e} className={`kp-emoji-btn ${emoji === e ? 'kp-emoji-active' : ''}`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>

      <input
        className="kp-input"
        placeholder="Vault name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <input
        className="kp-input"
        placeholder="Goal amount (optional)"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        inputMode="decimal"
        type="text"
      />

      <button className="kp-btn-primary" onClick={handleCreate} disabled={!name.trim() || saving}>
        {saving ? 'Creating...' : 'Create Vault'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: TX DETAIL
═══════════════════════════════════════════════════════════════════════════ */
function TxDetailSheet({ data }) {
  const tx = data?.tx;
  if (!tx) return <div className="kp-sheet-body"><div className="kp-muted">Transaction not found</div></div>;

  const inbound = txIsInbound(tx);
  const cur = (tx.currency || 'AUD').toUpperCase();
  const rawAmt = tx.amount_minor ?? tx.amount ?? 0;
  let display;
  if (cur === 'BTC') display = fmtBTC(Math.abs(rawAmt));
  else if (cur === 'XMR') display = fmtXMR(Math.abs(rawAmt));
  else display = '$' + fmtAUD(Math.abs(rawAmt) / 100);

  const [hashCopied, setHashCopied] = useState(false);
  const copyHash = () => {
    if (!tx.hash) return;
    navigator.clipboard?.writeText(tx.hash);
    setHashCopied(true);
    setTimeout(() => setHashCopied(false), 1500);
  };

  return (
    <div className="kp-sheet-body kp-center">
      <div className="kp-tx-detail-dir">{inbound ? '\u2193' : '\u2191'}</div>
      <div className={`kp-tx-detail-amount ${inbound ? 'kp-green' : 'kp-red'}`}>
        {inbound ? '+' : '-'}{display}
      </div>
      <div className="kp-tx-detail-currency">{cur}</div>

      <div className="kp-tx-detail-rows">
        <TxDetailRow label="Type" value={tx.type || '--'} />
        <TxDetailRow label="Description" value={tx.description || tx.external_id || '--'} />
        {tx.from && <TxDetailRow label="From" value={tx.from} />}
        {tx.to && <TxDetailRow label="To" value={tx.to} />}
        {tx.ai_memo && <TxDetailRow label="AI Memo" value={tx.ai_memo} />}
        <TxDetailRow label="Time" value={tx.created_at || tx.timestamp ? fmtTime(tx.created_at || tx.timestamp) : '--'} />
        <TxDetailRow label="Status" value={tx.status || 'complete'} badge />
      </div>

      {tx.hash && (
        <button className="kp-hash-chip" onClick={copyHash}>
          {hashCopied ? <Check size={12} /> : <Shield size={12} />}
          <span>{tx.hash.slice(0, 8)}...</span>
        </button>
      )}
    </div>
  );
}

function TxDetailRow({ label, value, badge }) {
  return (
    <div className="kp-tx-detail-row">
      <span className="kp-tx-detail-label">{label}</span>
      {badge
        ? <span className={`kp-status-badge kp-status-${(value || '').toLowerCase()}`}>{value}</span>
        : <span className="kp-tx-detail-value">{value}</span>
      }
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: SETTINGS
═══════════════════════════════════════════════════════════════════════════ */
function SettingsSheet() {
  const summary = usePayStore(s => s.summary);
  const chainValid = usePayStore(s => s.chainValid);
  const verifyChain = usePayStore(s => s.verifyChain);
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    await verifyChain();
    setVerifying(false);
  };

  const sources = [
    { name: 'Wise', connected: !!summary?.data?.wise },
    { name: 'Basiq (CBA)', connected: !!summary?.data?.basiq },
    { name: 'Independent Reserve', connected: !!summary?.data?.independent_reserve },
    { name: 'XMR Wallet', connected: !!summary?.data?.xmr },
  ];

  return (
    <div className="kp-sheet-body">
      <div className="kp-sheet-title">Settings</div>

      <div className="kp-settings-group">
        <span className="kp-settings-group-label">ACCOUNTS</span>
        {sources.map(s => (
          <div key={s.name} className="kp-settings-row">
            <span>{s.name}</span>
            <span className={`kp-status-dot ${s.connected ? 'kp-dot-green' : 'kp-dot-amber'}`} />
            <span className="kp-muted">{s.connected ? 'Connected' : 'Mock'}</span>
          </div>
        ))}
      </div>

      <div className="kp-settings-group">
        <span className="kp-settings-group-label">INTELLIGENCE</span>
        <div className="kp-settings-row">
          <span>Refresh interval</span>
          <span className="kp-muted">Real-time SSE</span>
        </div>
      </div>

      <div className="kp-settings-group">
        <span className="kp-settings-group-label">SECURITY</span>
        <div className="kp-settings-row">
          <span>Audit chain</span>
          {chainValid === true && <span className="kp-green">Valid</span>}
          {chainValid === false && <span className="kp-red">Invalid</span>}
          {chainValid === null && <span className="kp-muted">Unchecked</span>}
        </div>
        <button className="kp-btn-ghost" onClick={handleVerify} disabled={verifying}>
          <Shield size={14} />
          <span>{verifying ? 'Verifying...' : 'Verify Chain'}</span>
        </button>
      </div>

      <div className="kp-settings-group">
        <span className="kp-settings-group-label">ABOUT</span>
        <div className="kp-settings-row">
          <span>Version</span>
          <span className="kp-muted">2.0.0</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEET: ACCOUNT (tap from carousel)
═══════════════════════════════════════════════════════════════════════════ */
function AccountSheet({ data }) {
  const summary = usePayStore(s => s.summary);
  const type = data?.type;

  const info = React.useMemo(() => {
    switch (type) {
      case 'aud': {
        const bal = extractAUD(summary);
        const bsb = extractBSB(summary);
        return { title: 'AUD Float', balance: bal != null ? `$${fmtAUD(bal)}` : '--', provider: 'Wise', bsb };
      }
      case 'btc': {
        const bal = extractBTC(summary);
        return { title: 'Bitcoin', balance: bal != null ? `${fmtBTC(bal * 1e8)} BTC` : '--', provider: 'Independent Reserve' };
      }
      case 'xmr': {
        const bal = extractXMR(summary);
        return { title: 'Monero', balance: bal != null ? `${fmtXMR(bal)} XMR` : '--', provider: 'Wallet' };
      }
      case 'cba': {
        const bal = extractCBA(summary);
        return { title: 'CBA', balance: bal != null ? `$${fmtAUD(bal)}` : '--', provider: 'Commonwealth Bank (read only)' };
      }
      default:
        return { title: 'Account', balance: '--', provider: '' };
    }
  }, [type, summary]);

  const [copiedField, setCopiedField] = useState(null);
  const handleCopy = (text, field) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <div className="kp-sheet-body kp-center">
      <div className="kp-sheet-title">{info.title}</div>
      <div className="kp-account-sheet-balance">{info.balance}</div>
      <div className="kp-muted">{info.provider}</div>
      {info.bsb && (
        <div style={{ marginTop: 16, width: '100%' }}>
          <CopyCell label="BSB" value={info.bsb.bsb} copied={copiedField === 'bsb'} onCopy={() => handleCopy(info.bsb.bsb, 'bsb')} />
          <CopyCell label="Account" value={info.bsb.account} copied={copiedField === 'acct'} onCopy={() => handleCopy(info.bsb.account, 'acct')} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOLD-TO-CONFIRM
═══════════════════════════════════════════════════════════════════════════ */
function HoldToConfirm({ onComplete, label = 'Hold to Confirm' }) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const intervalRef = useRef(null);
  const startRef = useRef(0);

  const start = useCallback(() => {
    setHolding(true);
    startRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(elapsed / 2500, 1);
      setProgress(p);
      if (p >= 1) {
        clearInterval(intervalRef.current);
        setHolding(false);
        try { navigator.vibrate?.([10, 30, 10]); } catch {}
        onComplete();
      }
    }, 16);
  }, [onComplete]);

  const cancel = useCallback(() => {
    clearInterval(intervalRef.current);
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - progress);

  return (
    <button
      className={`kp-hold-btn ${holding ? 'kp-hold-active' : ''}`}
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
    >
      <svg className="kp-hold-svg" width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke="var(--accent)" strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="kp-hold-label">{label}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   OP STAGES (SSE execution feedback)
═══════════════════════════════════════════════════════════════════════════ */
function OpStages({ stages = [] }) {
  return (
    <div className="kp-op-stages">
      {stages.map((s, i) => (
        <div key={i} className={`kp-op-stage kp-op-${s.status}`} style={{ animationDelay: `${i * 100}ms` }}>
          <span className="kp-op-dot" />
          <span className="kp-op-label">{s.label}</span>
          {s.status === 'complete' && <span className="kp-op-check">&#10003;</span>}
          {s.detail && <span className="kp-op-detail">{s.detail}</span>}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════════════════ */
export default function KuroPayApp() {
  const fetchSummary = usePayStore(s => s.fetchSummary);
  const fetchFeed = usePayStore(s => s.fetchFeed);
  const fetchVaults = usePayStore(s => s.fetchVaults);
  const fetchInsight = usePayStore(s => s.fetchInsight);
  const fetchPayees = usePayStore(s => s.fetchPayees);
  const loadRecentContacts = usePayStore(s => s.loadRecentContacts);
  const connectSSE = usePayStore(s => s.connectSSE);
  const disconnectSSE = usePayStore(s => s.disconnectSSE);
  const activeSheet = usePayStore(s => s.activeSheet);
  const summary = usePayStore(s => s.summary);
  const feed = usePayStore(s => s.feed);
  const scrollRef = useRef(null);
  const sessionId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    fetchSummary(sessionId);
    fetchFeed(true);
    fetchVaults();
    fetchInsight();
    fetchPayees();
    loadRecentContacts();
    connectSSE(sessionId);
    return () => disconnectSSE();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Staggered section reveal on scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !e.target.classList.contains('kp-revealed')) {
          e.target.classList.add('kp-revealed');
          io.unobserve(e.target);
        }
      });
    }, { root: el, threshold: 0.1 });
    el.querySelectorAll('.kp-section').forEach(s => io.observe(s));
    return () => io.disconnect();
  }, [summary, feed.length]);

  return (
    <div className="kp">
      <Header />
      <div className="kp-feed" ref={scrollRef}>
        <HeroBalance />
        <AccountsCarousel />
        <VaultsSection />
        <PullToStack />
        <ActivityFeed />
        <IntelligenceSection />
        <MarketTicker />
        <div className="kp-bottom-safe" />
      </div>
      {activeSheet && <SheetOverlay />}
      <PayStyles />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════════════════════ */
function PayStyles() {
  return (
    <style>{`
/* ── Tokens ────────────────────────────────────────────────────────────── */
.kp {
  --bg: #000;
  --surface: rgba(28,28,30,1);
  --surface-2: rgba(44,44,46,1);
  --separator: rgba(255,255,255,0.06);
  --text: rgba(255,255,255,0.92);
  --text-2: rgba(255,255,255,0.55);
  --text-3: rgba(255,255,255,0.30);
  --accent: #a855f7;
  --green: #22c55e;
  --red: #ef4444;
  --amber: #f59e0b;
  --teal: #14b8a6;
  --blue: #3b82f6;
  --glass: rgba(255,255,255,0.04);
  --glass-border: rgba(255,255,255,0.06);
  --mono: 'SF Mono','Menlo','Fira Code',monospace;
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  position: relative;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', 'Helvetica Neue', sans-serif;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}

/* ── Header ────────────────────────────────────────────────────────────── */
.kp-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 0.5px solid var(--separator);
}
.kp-header-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
}
.kp-header-btn {
  background: none;
  border: none;
  color: var(--text-2);
  padding: 8px;
  cursor: pointer;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kp-header-btn:active { opacity: 0.6; }

/* ── Feed scroll ───────────────────────────────────────────────────────── */
.kp-feed {
  overflow-y: auto;
  overflow-x: hidden;
  height: calc(100% - 44px);
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.kp-feed::-webkit-scrollbar { display: none; }

/* ── Sections ──────────────────────────────────────────────────────────── */
.kp-section {
  padding: 0 16px;
  margin-bottom: 24px;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.kp-section.kp-revealed {
  opacity: 1;
  transform: translateY(0);
}
/* First section (hero) should be visible immediately */
.kp-section:first-child {
  opacity: 1;
  transform: none;
}
.kp-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 12px;
}
.kp-section-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-2);
}

/* ── Hero ──────────────────────────────────────────────────────────────── */
.kp-hero {
  position: relative;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: var(--glass);
  border-bottom: 0.5px solid var(--glass-border);
  overflow: hidden;
  margin-bottom: 24px;
}
.kp-hero-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(168,85,247,0.15) 0%, transparent 60%);
  pointer-events: none;
}
.kp-hero-content {
  position: relative;
  z-index: 1;
  padding: 24px 16px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.kp-hero-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-3);
  align-self: flex-start;
  margin-bottom: 8px;
}
.kp-hero-balance {
  font-family: var(--mono);
  font-size: 44px;
  font-weight: 700;
  text-align: center;
  line-height: 1.1;
  margin-bottom: 6px;
}
.kp-hero-delta {
  font-size: 14px;
  margin-bottom: 20px;
}
.kp-hero-pills {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  width: 100%;
  justify-content: center;
  flex-wrap: wrap;
}
.kp-hero-pills::-webkit-scrollbar { display: none; }

/* ── Pills ─────────────────────────────────────────────────────────────── */
.kp-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border-radius: 20px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.15s var(--spring);
}
.kp-pill:active { transform: scale(0.95); }

.kp-pill-sm {
  padding: 6px 14px;
  border-radius: 14px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.kp-pill-active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* ── Accounts Carousel ─────────────────────────────────────────────────── */
.kp-carousel {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding: 0 6%;
}
.kp-carousel::-webkit-scrollbar { display: none; }
.kp-card-account {
  flex: 0 0 88%;
  scroll-snap-align: center;
  min-height: 130px;
  padding: 16px;
  border-radius: 16px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transition: transform 0.2s var(--spring);
}
.kp-card-account:active { transform: scale(0.97); }
.kp-muted-card { opacity: 0.6; }
.kp-card-account-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.kp-card-account-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-2);
}
.kp-card-account-balance {
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 600;
  margin: 8px 0 4px;
}
.kp-card-account-sub {
  font-size: 13px;
  color: var(--text-3);
}

/* ── Dots ──────────────────────────────────────────────────────────────── */
.kp-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 12px 0 4px;
}
.kp-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-3);
  transition: background 0.2s;
}
.kp-dot-active { background: var(--accent); }

/* ── Chips ─────────────────────────────────────────────────────────────── */
.kp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text-2);
  cursor: pointer;
}
.kp-chip-green { background: rgba(34,197,94,0.12); color: var(--green); border-color: rgba(34,197,94,0.2); }
.kp-chip-red { background: rgba(239,68,68,0.12); color: var(--red); border-color: rgba(239,68,68,0.2); }
.kp-chip-amber { background: rgba(245,158,11,0.12); color: var(--amber); border-color: rgba(245,158,11,0.2); }
.kp-chip-blue { background: rgba(59,130,246,0.12); color: var(--blue); border-color: rgba(59,130,246,0.2); }

/* ── Badge chip ────────────────────────────────────────────────────────── */
.kp-badge-chip {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(168,85,247,0.15);
  color: var(--accent);
  border: 0.5px solid rgba(168,85,247,0.25);
}

/* ── Vaults ─────────────────────────────────────────────────────────────── */
.kp-vault-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.kp-vault-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px;
  border-radius: 16px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.2s var(--spring);
}
.kp-vault-card:active { transform: scale(0.96); }
.kp-vault-new {
  border-style: dashed;
  border-color: var(--text-3);
  background: transparent;
}
.kp-vault-emoji { font-size: 24px; }
.kp-vault-name { font-size: 14px; font-weight: 600; text-align: center; }
.kp-vault-arc { margin: 4px 0; }
.kp-vault-amounts {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-2);
}
.kp-vault-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  width: 100%;
  border-radius: 16px;
  border: 1px dashed var(--text-3);
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
}
.kp-vault-empty:active { opacity: 0.7; }

/* ── Pull-to-stack ─────────────────────────────────────────────────────── */
.kp-pull-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  margin: 0 16px 24px;
  border-radius: 12px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  transition: transform 0.2s ease;
  user-select: none;
  touch-action: none;
}
.kp-pull-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--text-3);
}
.kp-pull-icon {
  font-size: 14px;
  color: var(--amber);
}
.kp-pull-badge {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(168,85,247,0.15);
  color: var(--accent);
}

/* ── Activity feed ─────────────────────────────────────────────────────── */
.kp-date-group { margin-bottom: 4px; }
.kp-date-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  padding: 8px 0 4px;
}
.kp-tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--separator);
  cursor: pointer;
  transition: transform 0.15s var(--spring);
}
.kp-tx-pressed { transform: scale(0.97); }
.kp-tx-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.kp-tx-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kp-tx-desc {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp-tx-meta {
  font-size: 11px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 4px;
}
.kp-tx-amount {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Pulse dot ─────────────────────────────────────────────────────────── */
.kp-pulse-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--amber);
  animation: kpPulse 1.5s ease-in-out infinite;
}
@keyframes kpPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
  50% { box-shadow: 0 0 0 4px rgba(245,158,11,0); }
}

/* ── Empty / loading ───────────────────────────────────────────────────── */
.kp-empty {
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
  padding: 32px 0;
}
.kp-loading-more {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
.kp-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--separator);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: kpSpin 0.7s linear infinite;
}
@keyframes kpSpin { to { transform: rotate(360deg); } }
.kp-spin { animation: kpSpin 0.7s linear infinite; }
.kp-sentinel { height: 1px; }

/* ── Skeletons ─────────────────────────────────────────────────────────── */
.kp-skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: kpShimmer 1.5s ease-in-out infinite;
  border-radius: 8px;
}
@keyframes kpShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.kp-skeleton-lg { display: block; height: 44px; width: 240px; margin: 0 auto; }
.kp-skeleton-vault { height: 120px; }
.kp-tx-skeletons { display: flex; flex-direction: column; gap: 8px; }
.kp-skeleton-tx { height: 52px; }

/* ── Intelligence ──────────────────────────────────────────────────────── */
.kp-insight-card {
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  border-radius: 16px;
  padding: 16px;
}
.kp-insight-ctx {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.5;
  margin: 0 0 12px;
}
.kp-signals-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 8px;
}
.kp-signals-scroll::-webkit-scrollbar { display: none; }
.kp-signal-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--surface);
  border: 0.5px solid var(--glass-border);
  white-space: nowrap;
  flex-shrink: 0;
}
.kp-signal-asset { font-size: 13px; font-weight: 600; }
.kp-signal-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 6px;
}
.kp-signal-conf { font-size: 11px; color: var(--text-3); }
.kp-insight-risk {
  font-size: 12px;
  font-style: italic;
  color: var(--text-3);
  margin: 8px 0 0;
}
.kp-insight-awareness {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(245,158,11,0.06);
  border: 0.5px solid rgba(245,158,11,0.15);
  font-size: 13px;
  color: var(--amber);
}
.kp-insight-skeleton { padding: 16px; }
.kp-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.kp-refresh-btn:disabled { opacity: 0.5; }
.kp-refresh-btn:active { opacity: 0.7; }

/* ── Ticker ────────────────────────────────────────────────────────────── */
.kp-ticker-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.kp-ticker-scroll::-webkit-scrollbar { display: none; }
.kp-ticker-card {
  flex: 0 0 auto;
  min-width: 140px;
  scroll-snap-align: start;
  padding: 14px;
  border-radius: 16px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kp-ticker-pair {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  letter-spacing: 0.5px;
}
.kp-ticker-price {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 600;
}
.kp-sparkline { margin-top: 4px; }

/* ── Sheet overlay ─────────────────────────────────────────────────────── */
.kp-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0,0,0,0.5);
  animation: kpFadeIn 0.2s ease;
}
@keyframes kpFadeIn { from { opacity: 0; } to { opacity: 1; } }
.kp-sheet {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 92dvh;
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  overflow-y: auto;
  animation: kpSlideUp 0.35s var(--spring);
  scrollbar-width: none;
}
.kp-sheet::-webkit-scrollbar { display: none; }
@keyframes kpSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
.kp-sheet-handle {
  width: 32px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.25);
  margin: 10px auto 8px;
}
.kp-sheet-body {
  padding: 8px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kp-sheet-title {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
}
.kp-center { align-items: center; }

/* ── Send sheet ────────────────────────────────────────────────────────── */
.kp-contacts-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 4px 0;
}
.kp-contacts-row::-webkit-scrollbar { display: none; }
.kp-contact-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
}
.kp-contact-circle:active { opacity: 0.7; }

/* ── Inputs ────────────────────────────────────────────────────────────── */
.kp-input {
  width: 100%;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 0.5px solid var(--glass-border);
  color: var(--text);
  font-size: 16px;
  outline: none;
  box-sizing: border-box;
}
.kp-input::placeholder { color: var(--text-3); }
.kp-input:focus { border-color: var(--accent); }
.kp-input-amount {
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 600;
  text-align: center;
}
.kp-input-amount-lg {
  font-family: var(--mono);
  font-size: 32px;
  font-weight: 600;
  text-align: center;
}
.kp-input-note { font-size: 14px; }

/* ── Currency pills ────────────────────────────────────────────────────── */
.kp-currency-pills {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* ── Select ────────────────────────────────────────────────────────────── */
.kp-select {
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 0.5px solid var(--glass-border);
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  outline: none;
  appearance: none;
  cursor: pointer;
}

/* ── Convert ───────────────────────────────────────────────────────────── */
.kp-convert-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.kp-convert-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--text-3);
  width: 44px;
}
.kp-swap-btn {
  align-self: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.kp-swap-btn:active { opacity: 0.7; }
.kp-quote-display {
  font-family: var(--mono);
  font-size: 14px;
  text-align: center;
  padding: 8px 0;
}

/* ── Buttons ───────────────────────────────────────────────────────────── */
.kp-btn-primary {
  width: 100%;
  padding: 16px;
  border-radius: 14px;
  background: var(--accent);
  border: none;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.kp-btn-primary:disabled { opacity: 0.4; cursor: default; }
.kp-btn-primary:active:not(:disabled) { opacity: 0.8; }
.kp-btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  border-radius: 12px;
  background: transparent;
  border: 0.5px solid var(--glass-border);
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
}
.kp-btn-ghost:disabled { opacity: 0.4; }
.kp-btn-ghost:active:not(:disabled) { opacity: 0.7; }

/* ── Confirm ───────────────────────────────────────────────────────────── */
.kp-confirm-amount {
  font-family: var(--mono);
  font-size: 32px;
  font-weight: 700;
  text-align: center;
}
.kp-confirm-to, .kp-confirm-note {
  font-size: 14px;
  color: var(--text-2);
  text-align: center;
}
.kp-error {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(239,68,68,0.1);
  border: 0.5px solid rgba(239,68,68,0.2);
  color: var(--red);
  font-size: 13px;
  text-align: center;
}
.kp-done-check {
  font-size: 48px;
  color: var(--green);
}

/* ── Hold-to-confirm ───────────────────────────────────────────────────── */
.kp-hold-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  align-self: center;
}
.kp-hold-svg { display: block; }
.kp-hold-label { font-size: 13px; color: var(--text-2); font-weight: 500; }
.kp-hold-active .kp-hold-label { color: var(--accent); }

/* ── Op stages ─────────────────────────────────────────────────────────── */
.kp-op-stages { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
.kp-op-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--glass);
  animation: kpStageIn 0.3s var(--spring) both;
}
@keyframes kpStageIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.kp-op-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-3);
  flex-shrink: 0;
}
.kp-op-active .kp-op-dot { background: var(--accent); animation: kpPulse 1.2s infinite; }
.kp-op-complete .kp-op-dot { background: var(--green); }
.kp-op-failed .kp-op-dot { background: var(--red); }
.kp-op-label { font-size: 14px; flex: 1; }
.kp-op-check { color: var(--green); font-size: 14px; }
.kp-op-detail { font-size: 11px; color: var(--text-3); }

/* ── Add money / Copy cells ────────────────────────────────────────────── */
.kp-add-section { padding: 4px 0; }
.kp-add-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text-3);
  display: block;
  margin-bottom: 8px;
}
.kp-copy-cell {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  cursor: pointer;
  margin-bottom: 6px;
}
.kp-copy-cell:active { opacity: 0.7; }
.kp-copy-cell-inner { flex: 1; display: flex; flex-direction: column; gap: 2px; text-align: left; }
.kp-copy-label { font-size: 11px; color: var(--text-3); }
.kp-copy-value { font-family: var(--mono); font-size: 16px; font-weight: 500; color: var(--text); }

/* ── TX detail sheet ───────────────────────────────────────────────────── */
.kp-tx-detail-dir { font-size: 28px; color: var(--text-2); }
.kp-tx-detail-amount {
  font-family: var(--mono);
  font-size: 36px;
  font-weight: 700;
}
.kp-tx-detail-currency {
  font-size: 14px;
  color: var(--text-3);
  margin-bottom: 8px;
}
.kp-tx-detail-rows { width: 100%; }
.kp-tx-detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 0.5px solid var(--separator);
}
.kp-tx-detail-label { font-size: 13px; color: var(--text-3); }
.kp-tx-detail-value { font-size: 14px; color: var(--text); max-width: 60%; text-align: right; word-break: break-all; }
.kp-hash-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  margin-top: 8px;
}
.kp-hash-chip:active { opacity: 0.7; }

/* ── Status badges ─────────────────────────────────────────────────────── */
.kp-status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 8px;
  text-transform: capitalize;
}
.kp-status-complete { background: rgba(34,197,94,0.12); color: var(--green); }
.kp-status-pending { background: rgba(245,158,11,0.12); color: var(--amber); }
.kp-status-failed { background: rgba(239,68,68,0.12); color: var(--red); }

/* ── Settings ──────────────────────────────────────────────────────────── */
.kp-settings-group {
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  border-radius: 14px;
  padding: 14px 16px;
}
.kp-settings-group-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: var(--text-3);
  display: block;
  margin-bottom: 10px;
}
.kp-settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 14px;
  border-bottom: 0.5px solid var(--separator);
}
.kp-settings-row:last-child { border-bottom: none; }
.kp-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.kp-dot-green { background: var(--green); }
.kp-dot-amber { background: var(--amber); }

/* ── Vault detail ──────────────────────────────────────────────────────── */
.kp-vault-detail-emoji { font-size: 48px; }
.kp-vault-detail-amounts {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 600;
  margin-top: 8px;
}
.kp-vault-detail-current { color: var(--text); }
.kp-vault-detail-bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--glass);
  overflow: hidden;
  margin-top: 8px;
}
.kp-vault-detail-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.4s ease;
}

/* ── Emoji picker ──────────────────────────────────────────────────────── */
.kp-emoji-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}
.kp-emoji-btn {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  font-size: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kp-emoji-active {
  border-color: var(--accent);
  background: rgba(168,85,247,0.15);
}

/* ── Account sheet ─────────────────────────────────────────────────────── */
.kp-account-sheet-balance {
  font-family: var(--mono);
  font-size: 32px;
  font-weight: 700;
  margin: 8px 0;
}

/* ── Utility ───────────────────────────────────────────────────────────── */
.kp-green { color: var(--green); }
.kp-red { color: var(--red); }
.kp-muted { color: var(--text-3); }
.kp-accent { color: var(--accent); }
.kp-link {
  font-size: 13px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  font-weight: 500;
}
.kp-link:active { opacity: 0.7; }
.kp-bottom-safe { height: env(safe-area-inset-bottom, 24px); min-height: 24px; }

/* ── Vault actions ────────────────────────────────────────────────────── */
.kp-vault-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 16px;
}

/* ── Pull-to-stack ready state ────────────────────────────────────────── */
.kp-pull-ready {
  border-color: var(--accent) !important;
  background: rgba(168,85,247,0.08) !important;
}

/* ── Activity search + filters ────────────────────────────────────────── */
.kp-activity-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 0.5px solid var(--glass-border);
  margin-bottom: 10px;
}
.kp-activity-search-input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.kp-activity-search-input::placeholder { color: var(--text-3); }
.kp-activity-search-clear {
  background: none;
  border: none;
  color: var(--text-3);
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.kp-filter-pills {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 10px;
}
.kp-filter-pills::-webkit-scrollbar { display: none; }
.kp-filter-pill {
  padding: 6px 14px;
  border-radius: 14px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.15s;
}
.kp-filter-pill-active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* ── Payee system ─────────────────────────────────────────────────────── */
.kp-payees-section { margin-bottom: 8px; }
.kp-payees-scroll {
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: none;
}
.kp-payees-scroll::-webkit-scrollbar { display: none; }
.kp-payee-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  cursor: pointer;
  margin-bottom: 6px;
  width: 100%;
  transition: border-color 0.15s;
}
.kp-payee-row:active { opacity: 0.7; }
.kp-payee-selected {
  border-color: var(--accent);
  background: rgba(168,85,247,0.08);
}
.kp-payee-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  flex-shrink: 0;
}
.kp-payee-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.kp-payee-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp-payee-type-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--glass);
  border: 0.5px solid var(--glass-border);
  color: var(--text-3);
  flex-shrink: 0;
}
.kp-selected-payee-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(168,85,247,0.08);
  border: 0.5px solid rgba(168,85,247,0.2);
  font-size: 14px;
  color: var(--text-2);
  display: flex;
  align-items: center;
}

/* ── Input with validation dot ────────────────────────────────────────── */
.kp-input-with-dot {
  position: relative;
  width: 100%;
}
.kp-input-with-dot .kp-input { padding-right: 36px; }
.kp-validation-dot {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
}
.kp-vdot-green { background: var(--green); }
.kp-vdot-red { background: var(--red); }

/* ── Checkbox row ─────────────────────────────────────────────────────── */
.kp-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-2);
  cursor: pointer;
}
.kp-checkbox-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}

/* ── Convert fee rows ─────────────────────────────────────────────────── */
.kp-convert-fee-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 0.5px solid var(--separator);
}
.kp-slippage-warning {
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(245,158,11,0.06);
  border: 0.5px solid rgba(245,158,11,0.15);
  font-size: 12px;
  color: var(--amber);
}

/* ── Sync chip ─────────────────────────────────────────────────────────── */
.kp-sync-chip {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  padding: 6px 0;
  cursor: pointer;
}
.kp-sync-chip:active { opacity: 0.5; }

/* ── Price card glow ───────────────────────────────────────────────────── */
@keyframes kpPriceGlow {
  0% { box-shadow: 0 0 0 0 rgba(168,85,247,0.3); }
  50% { box-shadow: 0 0 12px 2px rgba(168,85,247,0.15); }
  100% { box-shadow: 0 0 0 0 rgba(168,85,247,0.3); }
}
.kp-ticker-card.kp-price-updated {
  animation: kpPriceGlow 1.5s ease;
}

/* ── TX row press enhancement ──────────────────────────────────────────── */
.kp-tx-row:active, .kp-tx-pressed {
  transform: scale(0.97);
  background: rgba(168,85,247,0.06);
  transition: transform 0.1s ease, background 0.1s ease;
}

/* ── Sheet backdrop blur ───────────────────────────────────────────────── */
.kp-sheet-overlay {
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
`}</style>
  );
}
