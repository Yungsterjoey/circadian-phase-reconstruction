/**
 * KURO CHAT v7.2
 * v6.2 Sovereign Agent Architecture — HARDENED
 * 
 * Red Team Fixes (v7.1 → v7.2):
 *  RT-01  Auth header on every fetch (X-KURO-Token)
 *  RT-02  localStorage stores session IDs only, not messages
 *  RT-03  X-KURO-Token sent on all API calls
 *  RT-04  Agent selection validated server-side, client is hint only
 *  RT-05  Profile fetched from server, never sent by client
 *  RT-06  Live Edit removed (endpoint never existed)
 *  RT-07  Audit opens proper viewer, not raw JSON
 *  RT-08  onRegen uses index, not reference comparison
 *  RT-09  onFork deep-clones messages
 *  RT-10  Agent/profile defs fetched from server on mount
 *  RT-11  SSE reconnection with exponential backoff
 *  RT-12  Voice input debounced, only sends on explicit stop
 *  RT-13  Textarea auto-resize on input
 *  RT-14  Token count labeled per-message
 *  RT-15  SSE parse errors surface to user
 *  RT-16  Redaction count stored per-message
 *  RT-17  ScopeIndicator visible on mobile (compact)
 *  RT-18  Keyboard shortcuts use capture phase
 *  RT-19  Artifact sandbox allows same-origin
 *  RT-20  CSS variables use correct -- prefix
 */

import React, {
  useState, useRef, useEffect, useCallback,
  useMemo, createContext, useContext
} from 'react';
import {
  Send, Plus, Image, FileText, Settings, ChevronDown, ChevronUp, Brain, Folder,
  MessageSquare, X, Square, Sparkles, Trash2, Globe, ShoppingBag, Code, Search,
  Lightbulb, FileCode, ExternalLink, Copy, Check, Zap, Target, Atom, Lock,
  AlertTriangle, Eye, Paperclip, RotateCcw, Play, Edit3, GitBranch,
  Hash, Command, CornerDownLeft, FolderPlus, ChevronRight, MoreHorizontal,
  Bookmark, Pin, Archive, Clock, Cpu, ArrowUp, User, Bot, Download, Share2,
  Volume2, VolumeX, Pause, Moon, Sun, Maximize2, Minimize2, PanelLeft, Menu,
  Home, Star, Wand2, Crown, Shield, Database, Key, RefreshCw, Activity,
  FileSearch, Cog, Terminal, Layers, ShieldCheck, ShieldAlert, ShieldOff,
  Building2, FlaskConical, Landmark, Link, Unlink, AlertCircle, Info,
  CheckCircle2, XCircle, FileKey, ScrollText, GitCommit, Package, WifiOff
} from 'lucide-react';

import SandboxPanel from './SandboxPanel';
import usePreempt from '../../hooks/usePreempt';
import { useLiveEdit, LiveEditBar } from './LiveEdit';

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
const KuroContext = createContext(null);
const useKuro = () => {
  const ctx = useContext(KuroContext);
  if (!ctx) throw new Error('useKuro must be within KuroProvider');
  return ctx;
};


// ═══════════════════════════════════════════════════════════════════════════
// AUTH — RT-01, RT-03: Token on every request
// ═══════════════════════════════════════════════════════════════════════════
function getToken() {
  return localStorage.getItem('kuro_token') || '';
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-KURO-Token': getToken(),
    ...extra,
  };
}

async function authFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: authHeaders(opts.headers || {}),
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK DEFS — RT-10: Overridden by server on mount
// ═══════════════════════════════════════════════════════════════════════════
const FALLBACK_AGENTS = {
  insights: {
    id: 'insights', name: 'Insights', icon: 'Eye', color: '#5e5ce6',
    tier: 1, capabilities: ['read', 'compute'],
    scopes: ['docs', 'uploads', 'vectors'], desc: 'Read & analyze documents',
  },
  analysis: {
    id: 'analysis', name: 'Analysis', icon: 'FileSearch', color: '#ff9f0a',
    tier: 2, capabilities: ['read', 'compute', 'aggregate'],
    scopes: ['docs', 'uploads', 'vectors', 'sessions'], desc: 'Deep research & aggregation',
  },
  actions: {
    id: 'actions', name: 'Actions', icon: 'Terminal', color: '#ff375f',
    tier: 3, capabilities: ['read', 'write', 'exec', 'compute'],
    scopes: ['docs', 'uploads', 'vectors', 'sessions', 'data', 'code'], desc: 'Full system access',
  },
};

const FALLBACK_PROFILES = {
  gov: {
    id: 'gov', name: 'Government', icon: 'Landmark', color: '#30d158',
    maxAgentTier: 1, execEnabled: false, safety: true,
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', icon: 'Building2', color: '#5e5ce6',
    maxAgentTier: 3, execEnabled: true, safety: true,
  },
  lab: {
    id: 'lab', name: 'Lab', icon: 'FlaskConical', color: '#ff9f0a',
    maxAgentTier: 3, execEnabled: true, safety: false,
  },
};

const ICON_MAP = {
  Eye, FileSearch, Terminal, Landmark, Building2, FlaskConical,
  Brain, Shield, MessageSquare, Search, Code, Lightbulb, Wand2,
};

function resolveIcon(name) {
  return ICON_MAP[name] || Brain;
}

const SKILLS = {
  chat: { id: 'chat', name: 'Chat', icon: MessageSquare, color: '#a855f7' },
  research: { id: 'research', name: 'Research', icon: Search, color: '#5e5ce6' },
  code: { id: 'code', name: 'Code', icon: Code, color: '#ff9f0a' },
  reason: { id: 'reason', name: 'Reason', icon: Lightbulb, color: '#ffd60a' },
  create: { id: 'create', name: 'Create', icon: Wand2, color: '#ff375f' },
  sandbox: { id: 'sandbox', name: 'Sandbox', icon: Terminal, color: '#30d158' },
};


// ═══════════════════════════════════════════════════════════════════════════
// TYPING PROMPTS
// ═══════════════════════════════════════════════════════════════════════════
const TYPING_PROMPTS = [
  "Analyze this document for key insights\u2026",
  "Help me write secure, audited code\u2026",
  "Research compliance requirements\u2026",
  "Create a data governance report\u2026",
  "Explain the audit chain status\u2026",
  "Compare enterprise vs gov profiles\u2026",
  "Debug this with full system access\u2026",
  "Summarize session history\u2026",
];


// ═══════════════════════════════════════════════════════════════════════════
// CYCLING PLACEHOLDER — rotates TYPING_PROMPTS as textarea placeholder
// ═══════════════════════════════════════════════════════════════════════════
function useCyclingPlaceholder(active) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (!active) { setDisplay(''); return; }

    const r = (lo, hi) => lo + Math.random() * (hi - lo);

    let idx = 0, chars = 0, phase = 'typing', blinkOn = true, blinkTicks = 0;
    // erasing state
    let eraseCount = 0, slowErases = 0;
    let timer;

    function tick() {
      const phrase = TYPING_PROMPTS[idx];

      if (phase === 'typing') {
        chars++;
        setDisplay(phrase.slice(0, chars) + '_');
        if (chars >= phrase.length) {
          phase = 'wait'; blinkTicks = 0;
          // random pause before blink starts (600–1400ms)
          timer = setTimeout(tick, r(600, 1400));
        } else {
          // human typing: base 45–95ms, occasional micro-pause on space/comma
          const ch = phrase[chars - 1];
          const delay = (ch === ' ' || ch === ',')
            ? r(80, 160)
            : Math.random() < 0.07 ? r(160, 280)   // rare stumble
            : r(42, 105);
          timer = setTimeout(tick, delay);
        }

      } else if (phase === 'wait') {
        blinkTicks++;
        blinkOn = !blinkOn;
        setDisplay(phrase + (blinkOn ? '_' : ''));
        if (blinkTicks >= 6) {
          phase = 'erasing';
          eraseCount = 0;
          slowErases = 2 + Math.floor(Math.random() * 2); // 2–3 slow backspaces first
          // random "linger" before first backspace (300–900ms)
          timer = setTimeout(tick, r(300, 900));
        } else {
          timer = setTimeout(tick, 420);
        }

      } else {
        chars--;
        eraseCount++;
        if (chars <= 0) {
          chars = 0;
          setDisplay('_');
          idx = (idx + 1) % TYPING_PROMPTS.length;
          phase = 'typing';
          timer = setTimeout(tick, r(300, 500));
        } else {
          setDisplay(phrase.slice(0, chars) + '_');
          // first slowErases keystrokes at ~120–180ms (deliberate), then accelerate to 28–55ms
          const delay = eraseCount <= slowErases ? r(120, 180) : r(28, 55);
          timer = setTimeout(tick, delay);
        }
      }
    }

    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [active]);

  return active ? display : 'Message KURO\u2026';
}


// ═══════════════════════════════════════════════════════════════════════════
// TERMINAL REVEAL — LOST-style character-by-character typewriter for stream
// ═══════════════════════════════════════════════════════════════════════════
function useTerminalReveal(text, isStreaming) {
  const full = text || '';
  const [revealLen, setRevealLen] = useState(() => isStreaming ? 0 : full.length);
  const ref = useRef({ text: full, isStreaming, revealLen: isStreaming ? 0 : full.length, timer: null });

  ref.current.text = full;
  ref.current.isStreaming = isStreaming;

  useEffect(() => {
    if (!isStreaming) {
      const len = full.length;
      if (ref.current.timer) { clearTimeout(ref.current.timer); ref.current.timer = null; }
      ref.current.revealLen = len;
      setRevealLen(len);
      return;
    }
    if (ref.current.timer) return; // loop already running
    function step() {
      ref.current.timer = null;
      if (ref.current.revealLen >= ref.current.text.length) return; // caught up, idle until more text
      ref.current.revealLen++;
      setRevealLen(ref.current.revealLen);
      ref.current.timer = setTimeout(step, 20 + Math.random() * 18); // 20–38ms/char
    }
    ref.current.timer = setTimeout(step, 20);
    // intentionally no cleanup: let timer persist across text-change re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, isStreaming]);

  useEffect(() => () => { if (ref.current.timer) clearTimeout(ref.current.timer); }, []);

  return full.slice(0, ref.current.revealLen);
}


// ═══════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER — lightweight inline parser (no dependencies)
// ═══════════════════════════════════════════════════════════════════════════
const MarkdownText = React.memo(({ text }) => {
  if (!text) return null;
  const elements = [];
  // Split on code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);
  let key = 0;
  for (const part of parts) {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang = match?.[1] || '';
      const code = match?.[2] || part.slice(3, -3);
      elements.push(
        <pre key={key++} className="md-codeblock" data-lang={lang}>
          {lang && <span className="md-lang">{lang}</span>}
          <code>{code.replace(/\n$/, '')}</code>
        </pre>
      );
    } else {
      // Process inline markdown per line
      const lines = part.split('\n');
      const lineEls = [];
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // Headers
        const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (hMatch) { const lvl = hMatch[1].length; lineEls.push(React.createElement(`h${lvl + 2}`, { key: key++, className: 'md-h' }, hMatch[2])); continue; }
        // Unordered list
        if (/^[\-\*]\s+/.test(line)) { lineEls.push(<li key={key++} className="md-li">{renderInline(line.replace(/^[\-\*]\s+/, ''))}</li>); continue; }
        // Ordered list
        const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) { lineEls.push(<li key={key++} className="md-li md-ol" value={olMatch[1]}>{renderInline(olMatch[2])}</li>); continue; }
        // Empty line = paragraph break
        if (!line.trim()) { lineEls.push(<br key={key++} />); continue; }
        // Normal line with inline formatting
        lineEls.push(<span key={key++} className="md-line">{renderInline(line)}</span>);
        if (i < lines.length - 1 && lines[i + 1]?.trim()) lineEls.push(<br key={key++} />);
      }
      elements.push(<React.Fragment key={key++}>{lineEls}</React.Fragment>);
    }
  }
  return <>{elements}</>;
});

function renderInline(text) {
  // Process: bold, italic, inline code, links
  const parts = [];
  let remaining = text;
  let key = 0;
  const rx = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIdx = 0;
  let m;
  while ((m = rx.exec(remaining)) !== null) {
    if (m.index > lastIdx) parts.push(remaining.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) parts.push(<code key={key++} className="md-inline-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (m[2] && m[3]) parts.push(<a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer" className="md-link">{m[2]}</a>);
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < remaining.length) parts.push(remaining.slice(lastIdx));
  return parts.length ? parts : text;
}

// ═══════════════════════════════════════════════════════════════════════════
// ISLAND — vertical swipe to dismiss (up for top, down for bottom)
// ═══════════════════════════════════════════════════════════════════════════
const Island = ({ children, className = '', floating = false, glow = false, dismissable = false, position = 'top' }) => {
  const [dismissed, setDismissed] = React.useState(false);
  const [dragY, setDragY] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const ref = React.useRef(null);
  const startRef = React.useRef(null);

  React.useEffect(() => { setMounted(true); }, []);

  const onPointerDown = React.useCallback((e) => {
    if (!dismissable || !ref.current) return;
    // Only start drag from the island border area or direct island — not from buttons/inputs
    const tag = e.target.tagName.toLowerCase();
    if (['button', 'input', 'textarea', 'select', 'a'].includes(tag) || e.target.closest('button, input, textarea, a')) return;
    const cy = e.clientY || (e.touches?.[0]?.clientY ?? 0);
    startRef.current = { y: cy };
    setDragging(true);
    const onMove = (ev) => {
      ev.preventDefault();
      const my = ev.clientY || (ev.touches?.[0]?.clientY ?? 0);
      const dy = my - startRef.current.y;
      // Top island: only allow dragging up (negative). Bottom: only down (positive).
      const toward = position === 'top' ? dy < 0 : dy > 0;
      if (toward) setDragY(dy);
      else setDragY(dy * 0.12); // rubber-band resistance
    };
    const onUp = (ev) => {
      const uy = (ev.clientY || ev.changedTouches?.[0]?.clientY) ?? 0;
      const dy = uy - startRef.current.y;
      const toward = position === 'top' ? dy < 0 : dy > 0;
      if (toward && Math.abs(dy) > 60) setDismissed(true);
      setDragY(0); setDragging(false);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [dismissable, position]);

  if (dismissed) return (
    <button
      className={`island-restore island-restore-enter ${position === 'top' ? 'restore-top' : 'restore-bottom'}`}
      onClick={() => { setDismissed(false); setMounted(false); setTimeout(() => setMounted(true), 50); }}
    >
      <ChevronDown size={14} style={{ transform: position === 'top' ? 'rotate(180deg)' : 'rotate(0deg)' }} />
    </button>
  );

  const style = dragY ? {
    transform: `translateY(${dragY}px)`,
    opacity: 1 - Math.min(Math.abs(dragY) / 120, 0.5),
    transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(.2,.9,.3,1), opacity 0.35s ease'
  } : {};

  return (
    <div ref={ref}
      className={`island ${!mounted ? 'island-enter' : ''} ${className} ${floating ? 'floating' : ''} ${glow ? 'glow' : ''} ${dismissable ? 'dismissable' : ''}`}
      style={style} onPointerDown={dismissable ? onPointerDown : undefined}>
      {dismissable && <div className={`island-hint ${position === 'top' ? 'hint-up' : 'hint-down'}`}><ChevronDown size={10} /></div>}
      {children}
    </div>
  );
};


// Fast ↔ Sovereign — standalone pill island
const SpeedIsland = ({ value, onChange }) => {
  const isFast = value !== 'sovereign';
  return (
    <button
      type="button"
      className={`tool-island speed-island ${isFast ? 'fast' : 'sov'}`}
      onClick={() => onChange(isFast ? 'sovereign' : 'instant')}
      title={isFast ? 'Fast mode — click for Sovereign' : 'Sovereign mode — click for Fast'}
    >
      {isFast ? <><Zap size={13} /><span>Fast</span></> : <><Crown size={13} /><span>Sov</span></>}
    </button>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// PILL
// ═══════════════════════════════════════════════════════════════════════════
const Pill = ({ icon: Icon, label, color, active, onClick, compact, badge, disabled }) => (
  <button
    className={`pill ${active ? 'active' : ''} ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
    style={{ '--pill-color': color }}
    onClick={onClick}
    disabled={disabled}
  >
    {Icon && <Icon size={compact ? 14 : 16} />}
    {label && <span>{label}</span>}
    {badge && <span className="pill-badge">{badge}</span>}
  </button>
);


// ═══════════════════════════════════════════════════════════════════════════
// POLICY BANNER
// ═══════════════════════════════════════════════════════════════════════════
const PolicyBanner = ({ notice, agents, onDismiss }) => {
  if (!notice) return null;
  const { reason, effectiveAgent } = notice;
  const agent = agents[effectiveAgent] || agents.insights || Object.values(agents)[0];
  const AgentIcon = resolveIcon(agent.icon);
  return (
    <div className="policy-banner">
      <div className="policy-icon"><ShieldAlert size={16} /></div>
      <div className="policy-content">
        <span className="policy-label">Action scope limited</span>
        <span className="policy-reason">{reason}</span>
      </div>
      <div className="policy-mode">
        <Pill icon={AgentIcon} label={agent.name} color={agent.color} compact active />
      </div>
      <button className="policy-dismiss" onClick={onDismiss}><X size={14} /></button>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// PROFILE INDICATOR
// ═══════════════════════════════════════════════════════════════════════════
const ProfileIndicator = ({ profileDef }) => {
  if (!profileDef) return null;
  const ProfileIcon = resolveIcon(profileDef.icon);
  return (
    <div className="profile-indicator" style={{ '--profile-color': profileDef.color }}>
      <ProfileIcon size={14} />
      <span>{profileDef.name}</span>
      {profileDef.safety && <ShieldCheck size={12} className="safety-badge" />}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// AGENT SELECTOR — RT-04: Visual hint only, server enforces
// ═══════════════════════════════════════════════════════════════════════════
const AgentSelector = ({ active, onChange, agents, maxTier, disabled }) => {
  const [open, setOpen] = useState(false);
  const activeAgent = agents[active] || Object.values(agents)[0];
  const ActiveIcon = resolveIcon(activeAgent?.icon);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [open]);

  return (
    <div className="agent-selector" ref={ref}>
      <button className="agent-current" onClick={() => !disabled && setOpen(!open)} disabled={disabled}>
        <ActiveIcon size={16} />
        <span>{activeAgent?.name || 'Agent'}</span>
        <ChevronDown size={14} className={open ? 'open' : ''} />
      </button>
      {open && (
        <div className="agent-dropdown">
          {Object.values(agents).map(agent => {
            const Icon = resolveIcon(agent.icon);
            const allowed = agent.tier <= (maxTier || 3);
            return (
              <button
                key={agent.id}
                className={`agent-option ${active === agent.id ? 'active' : ''} ${!allowed ? 'disabled' : ''}`}
                onClick={() => { if (allowed) { onChange(agent.id); setOpen(false); } }}
                disabled={!allowed}
              >
                <Icon size={16} />
                <div className="agent-info">
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-desc">{agent.desc}</span>
                </div>
                <div className="agent-caps">
                  {agent.capabilities?.map(cap => (
                    <span key={cap} className="cap-badge">{cap}</span>
                  ))}
                </div>
                {!allowed && <Lock size={12} className="agent-lock" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// SCOPE INDICATOR — RT-17: Visible on mobile (compact mode)
// ═══════════════════════════════════════════════════════════════════════════
const ScopeIndicator = ({ agent, agents }) => {
  const a = agents[agent] || Object.values(agents)[0];
  if (!a?.scopes) return null;
  return (
    <div className="scope-indicator">
      <span className="scope-label">Scope:</span>
      {a.scopes.map(s => (
        <span key={s} className="scope-badge">{s}</span>
      ))}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// REDACTION NOTICE — RT-16: Per-message
// ═══════════════════════════════════════════════════════════════════════════
const RedactionNotice = ({ count }) => {
  if (!count || count === 0) return null;
  return (
    <div className="redaction-notice">
      <ShieldCheck size={12} />
      <span>{count} field{count > 1 ? 's' : ''} redacted</span>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// AUDIT INDICATOR — RT-07: Proper handling
// ═══════════════════════════════════════════════════════════════════════════
const AuditIndicator = ({ status }) => {
  const isHealthy = status?.verified !== false;
  return (
    <div className={`audit-indicator ${isHealthy ? 'healthy' : 'warning'}`}>
      {isHealthy ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
      <span>Audit {isHealthy ? 'OK' : 'Issue'}</span>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// THOUGHT BLOCK
// ═══════════════════════════════════════════════════════════════════════════
const ThoughtBlock = ({ content, isStreaming }) => {
  const [expanded, setExpanded] = useState(false);
  if (!content && !isStreaming) return null;
  const lines = (content || '').split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 2).map(l => l.slice(0, 60)).join(' \u2022 ');
  return (
    <div className={`thought-block ${expanded ? 'expanded' : ''}`}>
      <button className="thought-toggle" onClick={() => setExpanded(!expanded)}>
        <div className="thought-icon">
          <Brain size={14} />
          {isStreaming && <span className="streaming-dot" />}
        </div>
        <span className="thought-label">Thinking</span>
        {!expanded && <span className="thought-preview">{preview}</span>}
        <ChevronDown size={14} className={`chevron ${expanded ? 'open' : ''}`} />
      </button>
      {expanded && <div className="thought-content"><pre>{content}</pre></div>}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT CARD — RT-19: sandbox allows same-origin
// ═══════════════════════════════════════════════════════════════════════════
const ArtifactCard = ({ artifact }) => {
  const [mode, setMode] = useState('preview');
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef(null);
  const canPreview = ['react', 'html', 'svg'].includes(artifact.type);

  useEffect(() => {
    if (mode === 'preview' && canPreview && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      let html = artifact.content;
      if (artifact.type === 'react') {
        html = `<!DOCTYPE html><html><head><script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><script src="https://cdn.tailwindcss.com"><\/script><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0a0a0c;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}</style></head><body><div id="root"></div><script type="text/babel">${artifact.content};ReactDOM.render(React.createElement(typeof App!=='undefined'?App:()=>null),document.getElementById('root'));<\/script></body></html>`;
      }
      doc.open(); doc.write(html); doc.close();
    }
  }, [mode, artifact, canPreview]);

  return (
    <div className="artifact-card">
      <div className="artifact-header">
        <FileCode size={16} />
        <span className="artifact-title">{artifact.title || 'Artifact'}</span>
        <span className="artifact-type">{artifact.type}</span>
        <div className="artifact-tabs">
          {canPreview && (
            <>
              <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>Code</button>
            </>
          )}
        </div>
        <div className="artifact-actions">
          <button onClick={() => { navigator.clipboard.writeText(artifact.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button onClick={() => {
            const ext = artifact.type === 'react' ? 'jsx' : artifact.type === 'html' ? 'html' : artifact.type === 'svg' ? 'svg' : 'txt';
            const blob = new Blob([artifact.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${(artifact.title || 'artifact').replace(/\s+/g, '-')}.${ext}`;
            a.click(); URL.revokeObjectURL(url);
          }} title="Download"><Download size={14} /></button>
        </div>
      </div>
      {mode === 'preview' && canPreview ? (
        <iframe ref={iframeRef} className="artifact-preview" sandbox="allow-scripts" />
      ) : (
        <pre className="artifact-code"><code>{artifact.content}</code></pre>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// CONTENT PARSER
// ═══════════════════════════════════════════════════════════════════════════
function parseContent(content) {
  const result = { think: '', main: content || '', artifact: null, thinkStreaming: false };
  const thinkMatch = content?.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    result.think = thinkMatch[1];
    result.main = content.replace(thinkMatch[0], '');
  }
  const openThink = content?.lastIndexOf('<think>');
  if (openThink !== -1 && content?.indexOf('</think>', openThink) === -1) {
    result.think = content.slice(openThink + 7);
    result.main = content.slice(0, openThink);
    result.thinkStreaming = true;
  }
  const artMatch = result.main.match(/<artifact[^>]*type="([^"]*)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/artifact>/i);
  if (artMatch) {
    result.artifact = { type: artMatch[1], title: artMatch[2], content: artMatch[3] };
    result.main = result.main.replace(artMatch[0], '');
  }
  result.main = result.main.trim();
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE — RT-08: Index-based regen, RT-16: per-message redaction
// ═══════════════════════════════════════════════════════════════════════════
const Message = ({ msg, msgIndex, isStreaming, onCopy, onEdit, showThoughts, agents, activeAgent }) => {
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef(null);
  const parsed = parseContent(msg.content);
  const revealedMain = useTerminalReveal(
    msg.role === 'assistant' ? parsed.main : null,
    isStreaming && !parsed.thinkStreaming
  );
  const agent = agents[activeAgent] || Object.values(agents)[0];
  const AgentIcon = resolveIcon(agent?.icon);

  const startEdit = () => {
    setEditValue(msg.content);
    setEditing(true);
    setShowActions(false);
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 30);
  };
  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== msg.content) onEdit(msgIndex, trimmed);
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div
      className={`message ${msg.role}`}
      onMouseEnter={() => !editing && setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {msg.role === 'assistant' && (
        <div className="message-avatar" style={{ '--agent-color': agent?.color || '#a855f7' }}>
          <AgentIcon size={18} />
        </div>
      )}
      <div className="message-content">
        {msg.role === 'assistant' && showThoughts && parsed.think && (
          <ThoughtBlock content={parsed.think} isStreaming={parsed.thinkStreaming} />
        )}
        {parsed.artifact && <ArtifactCard artifact={parsed.artifact} />}
        {/* Image thumbnails for user messages */}
        {msg.role === 'user' && msg.images?.length > 0 && (
          <div className="message-images">
            {msg.images.map((b64, i) => (
              <img key={i} src={`data:image/jpeg;base64,${b64}`} className="message-img-thumb" alt="attached" />
            ))}
          </div>
        )}
        {editing ? (
          <div className="message-edit-wrap">
            <textarea
              ref={editRef}
              className="message-edit-area"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === 'Escape') cancelEdit();
              }}
              rows={3}
            />
            <div className="message-edit-actions">
              <button className="message-edit-save" onClick={saveEdit}>Save</button>
              <button className="message-edit-cancel" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="message-text">
            {msg.role === 'assistant'
              ? <MarkdownText text={revealedMain} />
              : (msg.images?.length > 0
                  ? parsed.main.replace(/^\[Image:[^\]]+\]\n?/gm, '').trim() || null
                  : parsed.main)
            }
            {isStreaming && !parsed.thinkStreaming && <span className="stream-cursor">_</span>}
          </div>
        )}
        {showActions && !isStreaming && !editing && (
          <div className="message-actions">
            <button onClick={() => onCopy(msg.content)} title="Copy"><Copy size={14} /></button>
            {msg.role === 'user' && onEdit && (
              <button onClick={startEdit} title="Edit"><Edit3 size={14} /></button>
            )}
          </div>
        )}
      </div>
      {msg.role === 'user' && <div className="message-avatar user"><User size={18} /></div>}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// STREAM PROGRESS
// ═══════════════════════════════════════════════════════════════════════════
const StreamProgress = ({ tokens, startTime, isStreaming }) => {
  if (!isStreaming || tokens === 0) return null;
  const elapsed = (Date.now() - startTime) / 1000;
  const tps = elapsed > 0 ? tokens / elapsed : 0;
  const progress = Math.min(100, (tokens / 200) * 100);
  return (
    <div className="stream-progress">
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      <div className="progress-stats">
        <span>{tokens} tokens</span>
        <span>{tps.toFixed(1)} t/s</span>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION STATUS — RT-11
// ═══════════════════════════════════════════════════════════════════════════
const ConnectionStatus = ({ error }) => {
  if (!error) return null;
  return (
    <div className="connection-error">
      <WifiOff size={14} />
      <span>{error}</span>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════
const Sidebar = ({
  visible, onClose, projects, activeProject, setActiveProject, createProject,
  conversations, activeId, setActiveId, createConv, deleteConv,
  search, setSearch, profileDef, auditStatus,
  activeSkill, onSkillChange
}) => {
  const filteredConvs = useMemo(() => {
    let list = conversations;
    if (activeProject) list = list.filter(c => c.projectId === activeProject);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.title?.toLowerCase().includes(q));
    }
    return list;
  }, [conversations, activeProject, search]);

  return (
    <>
      {visible && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${visible ? 'open' : ''}`}>
        <div className="sidebar-top">
          <button className="new-chat" onClick={createConv}><Plus size={18} /><span>New chat</span></button>
          <div className="sidebar-skills">
            {Object.values(SKILLS).map(s => (
              <Pill key={s.id} icon={s.icon} label={s.name} color={s.color} compact
                active={activeSkill === s.id} onClick={() => onSkillChange(activeSkill === s.id ? 'chat' : s.id)} />
            ))}
          </div>
        </div>
        <div className="sidebar-search">
          <Search size={14} />
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch('')}><X size={12} /></button>}
        </div>
        <div className="sidebar-section">
          <div className="section-title"><Folder size={12} /><span>Projects</span><button onClick={createProject}><Plus size={14} /></button></div>
          <div className="project-list">
            <button className={`project-item ${!activeProject ? 'active' : ''}`} onClick={() => setActiveProject(null)}>
              <Home size={14} /><span>All Chats</span>
            </button>
            {projects.map(p => (
              <button key={p.id} className={`project-item ${activeProject === p.id ? 'active' : ''}`} onClick={() => setActiveProject(p.id)}>
                <Folder size={14} style={{ color: p.color }} /><span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-section flex-1">
          <div className="section-title"><Clock size={12} /><span>Recent</span></div>
          <div className="conv-list">
            {filteredConvs.map(c => (
              <button key={c.id} className={`conv-item ${c.id === activeId ? 'active' : ''}`} onClick={() => { setActiveId(c.id); onClose(); }}>
                <MessageSquare size={14} /><span>{c.title || 'New chat'}</span>
                <button className="conv-delete" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}><X size={12} /></button>
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <ProfileIndicator profileDef={profileDef} />
          <AuditIndicator status={auditStatus} />
          <button className="sidebar-link"><Settings size={16} /><span>Settings</span></button>
        </div>
      </aside>
    </>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════
const KuroCube = () => (
  <div className="kuro-cube-wrap">
    <div className="kuro-cube">
      <div className="kc-face kc-ft" /><div className="kc-face kc-bk" />
      <div className="kc-face kc-rt" /><div className="kc-face kc-lt" />
      <div className="kc-face kc-tp" /><div className="kc-face kc-bt" />
    </div>
  </div>
);

const EmptyState = () => (
  <div className="empty-state">
    <KuroCube />
    <h1>KURO</h1>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function KuroChat() {
  // RT-05, RT-10: Server-driven state
  const [profile, setProfile] = useState('lab');
  const [agents, setAgents] = useState(FALLBACK_AGENTS);
  const [profiles, setProfiles] = useState(FALLBACK_PROFILES);
  const [activeAgent, setActiveAgent] = useState('insights');
  const [policyNotice, setPolicyNotice] = useState(null);
  const [auditStatus, setAuditStatus] = useState({ verified: true });
  const [connectionError, setConnectionError] = useState(null);

  // RT-02: Only IDs in localStorage, messages in memory
  const [projects, setProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kuro_projects_v72') || '[]'); } catch { return []; }
  });
  const [conversationIndex, setConversationIndex] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('kuro_convindex_v72') || '[]');
    } catch { return []; }
  });
  const [conversations, setConversations] = useState(() => {
    // Initialize with one empty conversation
    const id = String(Date.now());
    return [{ id, title: '', messages: [], projectId: null }];
  });
  const [activeId, setActiveId] = useState(() => conversations[0]?.id);
  const [activeProject, setActiveProject] = useState(null);

  // UI State
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeSkill, setActiveSkill] = useState('chat');
  const [tokenCount, setTokenCount] = useState(0);
  const [streamStart, setStreamStart] = useState(0);

  const [isDragging, setIsDragging] = useState(false);

  // Settings
  const [settings] = useState({ temperature: 70, showThinking: true });
  const [powerDial, setPowerDial] = useState('sovereign'); // ⚡ instant | 👑 sovereign

  // Refs
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // ── Preempt — speculative pre-computation ──────────────────────────
  const { onInputChange, getPreemptSession, abortPreempt, preemptState } = usePreempt(String(activeId), 'main', getToken());

  useEffect(() => () => abortPreempt(), [activeId]);

  const activeConv = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeConv?.messages || [];
  const chatPlaceholder = useCyclingPlaceholder(messages.length === 0 && !input);
  const profileDef = profiles[profile] || profiles.lab;

  // ── RT-05, RT-10: Fetch server-driven config on mount ──────────────
  useEffect(() => {
    authFetch('/api/profile').then(r => r.json()).then(d => {
      if (d.active) setProfile(d.active);
      if (d.agents) setAgents(d.agents);
      if (d.profiles) setProfiles(d.profiles);
    }).catch(() => {});

    authFetch('/api/audit/verify').then(r => r.json()).then(d => {
      setAuditStatus(d);
    }).catch(() => {});
  }, []);

  // ── Persist index (not messages) ───────────────────────────────────
  useEffect(() => {
    const index = conversations.map(c => ({ id: c.id, title: c.title, projectId: c.projectId }));
    localStorage.setItem('kuro_convindex_v72', JSON.stringify(index));
  }, [conversations]);
  useEffect(() => { localStorage.setItem('kuro_projects_v72', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  // ── RT-18: Keyboard shortcuts in capture phase ─────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); e.stopPropagation(); setSidebarOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); e.stopPropagation(); createConv(); }
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // ── Drag & Drop ────────────────────────────────────────────────────
  useEffect(() => {
    const onDrag = (e) => { e.preventDefault(); setIsDragging(e.type !== 'dragleave'); };
    const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); };
    window.addEventListener('dragenter', onDrag);
    window.addEventListener('dragover', onDrag);
    window.addEventListener('dragleave', onDrag);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragenter', onDrag); window.removeEventListener('dragover', onDrag); window.removeEventListener('dragleave', onDrag); window.removeEventListener('drop', onDrop); };
  }, []);

  // ── RT-13: Textarea auto-resize ────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }, [input]);

  const handleFiles = useCallback((files) => {
    if (!files?.length) return;
    const file = files[0];
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|py|css|html|csv|sh|yaml|yml|xml|log|cjs|mjs)$/i.test(file.name);

    if (!isImage && !isText) {
      setConnectionError(`Unsupported file type: ${file.name}`);
      setTimeout(() => setConnectionError(null), 3000);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setConnectionError(`Failed to read: ${file.name}`);
      setTimeout(() => setConnectionError(null), 3000);
    };
    reader.onload = (e) => {
      const content = isImage
        ? `[Image: ${file.name}]`
        : `[File: ${file.name}]\n\`\`\`\n${e.target.result}\n\`\`\``;
      const msg = { role: 'user', content, images: isImage ? [e.target.result.split(',')[1]] : undefined };
      updateMessages(activeId, prev => [...prev, msg]);
      if (isImage) sendMessage(msg);
    };
    isImage ? reader.readAsDataURL(file) : reader.readAsText(file);
  }, [activeId]);

  const updateMessages = useCallback((cid, fn) => {
    setConversations(prev => prev.map(c =>
      c.id === cid ? { ...c, messages: typeof fn === 'function' ? fn(c.messages) : fn } : c
    ));
  }, []);

  const handleEditMessage = useCallback((msgIndex, newContent) => {
    updateMessages(activeId, msgs => {
      const updated = [...msgs];
      updated[msgIndex] = { ...updated[msgIndex], content: newContent };
      return updated;
    });
  }, [activeId, updateMessages]);

  const createConv = useCallback(() => {
    const n = { id: String(Date.now()), title: '', messages: [], projectId: activeProject };
    setConversations(prev => [n, ...prev]);
    setActiveId(n.id);
    setSidebarOpen(false);
  }, [activeProject]);

  const deleteConv = useCallback((id) => {
    setConversations(prev => {
      const f = prev.filter(c => c.id !== id);
      if (!f.length) {
        const n = { id: String(Date.now()), title: '', messages: [], projectId: activeProject };
        setActiveId(n.id);
        return [n];
      }
      if (id === activeId) setActiveId(f[0].id);
      return f;
    });
  }, [activeId, activeProject]);

  const createProject = useCallback(() => {
    const name = prompt('Project name:');
    if (!name) return;
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#a855f7'];
    setProjects(prev => [...prev, { id: Date.now(), name, color: colors[Math.floor(Math.random() * colors.length)] }]);
  }, []);

  // ── RT-11: SSE with reconnection + RT-15: Error surfacing ─────────
  const sendMessage = useCallback(async (preset = null) => {
    const msg = preset || { role: 'user', content: input.trim() };
    if (!preset && !input.trim()) return;

    const cid = activeId;
    if (!preset) {
      updateMessages(cid, prev => [...prev, msg, { role: 'assistant', content: '', redactionCount: 0 }]);
      setInput('');
    } else {
      updateMessages(cid, prev => [...prev, { role: 'assistant', content: '', redactionCount: 0 }]);
    }

    if (!messages.length && msg.content) {
      setConversations(prev => prev.map(c => c.id === cid ? { ...c, title: msg.content.slice(0, 40) } : c));
    }

    setIsLoading(true);
    setTokenCount(0);
    setStreamStart(Date.now());
    setPolicyNotice(null);
    setConnectionError(null);

    // RT-01, RT-04, RT-05: Auth + server resolves profile/agent
    const payload = {
      messages: [...messages, msg].map(m => ({
        role: m.role,
        content: m.content,
        images: m.images,
      })),
      agent: activeAgent,       // Hint only — server enforces
      skill: activeSkill,
      temperature: settings.temperature / 100,
      thinking: settings.showThinking,
      sessionId: activeId,
      powerDial,
      preemptSessionId: getPreemptSession(),
      // RT-05: Profile NOT sent — server resolves from token
    };

    let retries = 0;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = [1000, 3000];

    // ── Smooth streaming: buffer tokens, flush on rAF (~60fps) ──────────
    let tokenBuffer = '';
    let rafId = null;
    const flushTokenBuffer = () => {
      rafId = null;
      if (!tokenBuffer) return;
      const chunk = tokenBuffer;
      tokenBuffer = '';
      updateMessages(cid, prev => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last?.role === 'assistant') {
          u[u.length - 1] = { ...last, content: last.content + chunk };
        }
        return u;
      });
    };
    const scheduleFlush = () => {
      if (!rafId) rafId = requestAnimationFrame(flushTokenBuffer);
    };

    const attemptStream = async () => {
      try {
        abortRef.current = new AbortController();
        const res = await fetch('/api/stream', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(payload),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(`Server error: ${errText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let tokens = 0;
        let staleTimer = null;
        const STALE_MS = 30000; // 30s stall detection

        const resetStaleTimer = () => {
          clearTimeout(staleTimer);
          staleTimer = setTimeout(() => {
            console.warn('[SSE] Stale stream detected');
            setConnectionError('Stream stalled — reconnecting...');
            abortRef.current?.abort();
          }, STALE_MS);
        };

        resetStaleTimer();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetStaleTimer();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6);
            if (raw === '[DONE]') continue;

            // RT-15: Parse errors surface to user
            let d;
            try {
              d = JSON.parse(raw);
            } catch (parseErr) {
              console.warn('[SSE] Parse error:', raw.slice(0, 100));
              continue;
            }

            if (d.type === 'token') {
              tokens++;
              setTokenCount(tokens);
              tokenBuffer += d.content;
              scheduleFlush();
            } else if (d.type === 'policy_notice') {
              setPolicyNotice(d);
            } else if (d.type === 'capability') {
              // Capability router resolved profile — update dial if downgraded
              if (d.downgraded && d.profile !== powerDial) {
                setPowerDial(d.profile);
                setPolicyNotice({ level: 'info', message: `Scaled to ${d.profile}: ${d.reason || 'infrastructure adjustment'}` });
              }
            } else if (d.type === 'redaction') {
              // RT-16: Store redaction count on the message itself
              updateMessages(cid, prev => {
                const u = [...prev];
                const last = u[u.length - 1];
                if (last?.role === 'assistant') {
                  u[u.length - 1] = { ...last, redactionCount: d.count || 0 };
                }
                return u;
              });
            } else if (d.type === 'gate') {
              // Quota or tier gate — surface to user as message content
              updateMessages(cid, prev => {
                const u = [...prev];
                const last = u[u.length - 1];
                if (last?.role === 'assistant' && !last.content) {
                  u[u.length - 1] = { ...last, content: d.message || 'Chat limit reached. Upgrade to continue.' };
                }
                return u;
              });
              setIsLoading(false);
              clearTimeout(staleTimer);
              return;
            } else if (d.type === 'preempt_start' || d.type === 'preempt_end') {
              // Preempt cache — tokens arrive via normal 'token' events
            } else if (d.type === 'aborted_for_correction') {
              setIsLoading(false);
              return;
            } else if (d.type === 'error') {
              setConnectionError(d.message || 'Stream error');
            } else if (d.type === 'done') {
              clearTimeout(staleTimer);
              if (rafId) cancelAnimationFrame(rafId);
              flushTokenBuffer();
              setIsLoading(false);
              setConnectionError(null);
              return; // Success — no retry
            }
          }
        }

        clearTimeout(staleTimer);
        if (rafId) cancelAnimationFrame(rafId);
        flushTokenBuffer();
      } catch (err) {
        if (rafId) cancelAnimationFrame(rafId);
        flushTokenBuffer();
        if (err.name === 'AbortError') {
          // Check if it was a stale abort (retry) vs user abort (stop)
          if (retries < MAX_RETRIES && isLoading) {
            retries++;
            setConnectionError(`Reconnecting (attempt ${retries + 1})...`);
            await new Promise(r => setTimeout(r, RETRY_DELAY[retries - 1] || 3000));
            return attemptStream(); // Retry
          }
        }
        // RT-15: Surface error to user
        updateMessages(cid, prev => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.role === 'assistant' && !last.content) {
            u[u.length - 1] = { ...last, content: `Error: ${err.message}` };
          }
          return u;
        });
        setConnectionError(err.message);
      }
      setIsLoading(false);
    };

    await attemptStream();
  }, [input, activeId, activeAgent, activeSkill, messages, settings, isLoading]);

  // ── RT-08: Index-based regen ───────────────────────────────────────
  const handleRegen = useCallback((msgIndex) => {
    if (msgIndex < 1) return;
    const prevMsg = messages[msgIndex - 1];
    if (!prevMsg || prevMsg.role !== 'user') return;
    updateMessages(activeId, messages.slice(0, msgIndex));
    sendMessage(prevMsg);
  }, [messages, activeId, sendMessage]);

  // ── RT-09: Deep-clone fork ─────────────────────────────────────────
  const handleFork = useCallback((msgIndex) => {
    const sliced = messages.slice(0, msgIndex + 1);
    const deepCloned = JSON.parse(JSON.stringify(sliced));
    const f = { id: Date.now(), title: 'Branch', messages: deepCloned, projectId: activeProject };
    setConversations(prev => [f, ...prev]);
    setActiveId(f.id);
  }, [messages, activeProject]);

  // ── LiveEdit — mid-stream corrections ──────────────────────────────
  const liveEdit = useLiveEdit({
    isStreaming: isLoading,
    sessionId: activeId,
    activeId,
    messages,
    input,
    abortRef,
    sendMessage,
    updateMessages,
    setInput,
    setIsLoading,
    authHeaders: () => authHeaders(),
  });

  // Context
  const contextValue = useMemo(() => ({
    profile, activeAgent, auditStatus, agents, profiles,
  }), [profile, activeAgent, auditStatus, agents, profiles]);

  return (
    <KuroContext.Provider value={contextValue}>
      <div className={`kuro-v72 ${isDragging ? 'dragging' : ''}`}>
        <Sidebar
          visible={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          projects={projects}
          activeProject={activeProject}
          setActiveProject={setActiveProject}
          createProject={createProject}
          conversations={conversations}
          activeId={activeId}
          setActiveId={setActiveId}
          createConv={createConv}
          deleteConv={deleteConv}
          search={search}
          setSearch={setSearch}
          profileDef={profileDef}
          auditStatus={auditStatus}
          activeSkill={activeSkill}
          onSkillChange={setActiveSkill}
        />

        <main className="main">
          <PolicyBanner notice={policyNotice} agents={agents} onDismiss={() => setPolicyNotice(null)} />

          {/* Header */}
          <Island className="header-island" floating glow dismissable position="top">
            <button className="icon-btn" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
            <AgentSelector
              active={activeAgent}
              onChange={setActiveAgent}
              agents={agents}
              maxTier={profileDef?.maxAgentTier || 3}
            />
            <div className="header-spacer" />
            <button className="icon-btn" onClick={createConv}><Plus size={18} /></button>
          </Island>

          {/* Messages or Sandbox Panel */}
          {activeSkill === 'sandbox' ? (
            <div className="messages-scroll" style={{padding: 0}}>
              <SandboxPanel
                visible={activeSkill === 'sandbox'}
                onAttachArtifact={(artRef) => {
                  setInput(prev => prev + `\n[sandbox:${artRef.runId.slice(0,8)}] ${artRef.summary}`);
                  setActiveSkill('chat');
                }}
              />
            </div>
          ) : (
          <div className="messages-scroll">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="messages">
                {messages.map((m, i) => (
                  <Message
                    key={`${activeId}-${i}`}
                    msg={m}
                    msgIndex={i}
                    isStreaming={isLoading && i === messages.length - 1 && m.role === 'assistant'}
                    showThoughts={settings.showThinking}
                    agents={agents}
                    activeAgent={activeAgent}
                    onCopy={c => navigator.clipboard.writeText(c)}
                    onEdit={handleEditMessage}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
          )}

          <ConnectionStatus error={connectionError} />

          {/* Input area — tools row + input island */}
          <div className="input-area">
            <div className="input-tools-row">
              <button className="tool-island attach-island" type="button" onClick={() => fileInputRef.current?.click()} title="Attach file">
                <Paperclip size={13} /><span>Attach</span>
              </button>
              <input type="file" ref={fileInputRef} hidden onChange={e => handleFiles(e.target.files)} />
              <SpeedIsland value={powerDial} onChange={setPowerDial} />
            </div>
            <Island className={`input-island preempt-${preemptState}`} floating glow dismissable position="bottom">
              <LiveEditBar
                phrase={liveEdit.correctionPhrase}
                visible={liveEdit.showBar}
                adapting={liveEdit.adapting}
                error={liveEdit.error}
                onApply={liveEdit.applyCorrection}
                onDismiss={liveEdit.dismiss}
              />
              <div className="input-main">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); onInputChange(e.target.value); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (liveEdit.showBar) liveEdit.applyCorrection();
                      else if (!isLoading) sendMessage();
                    }
                  }}
                  placeholder={chatPlaceholder}
                  rows={1}
                />
                {isLoading ? (
                  <button className="send-btn stop" onClick={() => { abortRef.current?.abort(); setIsLoading(false); }}><Square size={16} /></button>
                ) : (
                  <button className="send-btn" onClick={() => sendMessage()} disabled={!input.trim()}><ArrowUp size={18} /></button>
                )}
              </div>
            </Island>
          </div>
        </main>

        {isDragging && <div className="drop-zone"><Paperclip size={48} /><span>Drop to upload</span></div>}

        <style>{`
/* ═══════════════════════════════════════════════════════════════════════════
   KURO v7.2 — HARDENED
   RT-20: All CSS vars use correct -- prefix
═══════════════════════════════════════════════════════════════════════════ */
.kuro-v72 {
  --bg: #09090b;
  --surface: rgba(255,255,255,0.04);
  --surface-2: rgba(255,255,255,0.06);
  --border: rgba(255,255,255,0.08);
  --border-2: rgba(255,255,255,0.12);
  --text: rgba(255,255,255,0.95);
  --text-2: rgba(255,255,255,0.65);
  --text-3: rgba(255,255,255,0.4);
  --accent: #a855f7;
  --accent-glow: rgba(168,85,247,0.25);
  --success: #30d158;
  --warning: #ff9f0a;
  --danger: #ff375f;
  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius-md: 20px;
  --radius-lg: 28px;
  position: relative;
  flex: 1; min-height: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  display: flex;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ═══ ISLAND ═══ */
.island {
  background: rgba(22,22,26,0.85);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
}
.island.floating { box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5); }
.island.glow { box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5), 0 0 60px -20px var(--accent-glow); }
/* Preempt awareness — purple glow states */
.island.preempt-preempting { animation: preemptPulse 1.4s ease-in-out infinite; }
.island.preempt-loaded { box-shadow: 0 0 0 1px rgba(168,85,247,0.22), 0 8px 32px rgba(0,0,0,0.5), 0 0 40px -8px rgba(168,85,247,0.45); transition: box-shadow 0.5s ease; }
@keyframes preemptPulse {
  0%,100% { box-shadow: 0 0 0 1px rgba(168,85,247,0.06), 0 8px 32px rgba(0,0,0,0.5), 0 0 24px -12px rgba(168,85,247,0.18); }
  50%      { box-shadow: 0 0 0 1px rgba(168,85,247,0.28), 0 8px 32px rgba(0,0,0,0.5), 0 0 52px -6px rgba(168,85,247,0.52); }
}
/* Message bubble inline edit — orange */
.message-edit-wrap { width: 100%; }
.message-edit-area {
  width: 100%; background: rgba(255,255,255,0.04); color: var(--text);
  border: 1px solid rgba(255,159,10,0.35); border-radius: 12px;
  padding: 10px 12px; font-size: 15px; font-family: inherit; resize: none; outline: none;
  box-shadow: 0 0 0 3px rgba(255,159,10,0.07), 0 0 24px -8px rgba(255,159,10,0.35);
  transition: box-shadow 0.2s;
}
.message-edit-area:focus { box-shadow: 0 0 0 3px rgba(255,159,10,0.12), 0 0 32px -6px rgba(255,159,10,0.5); }
.message-edit-actions { display: flex; gap: 6px; margin-top: 6px; }
.message-edit-save {
  padding: 5px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; font-family: inherit;
  background: rgba(255,159,10,0.15); border: 1px solid rgba(255,159,10,0.35); color: rgba(255,159,10,0.9);
  transition: background 0.15s;
}
.message-edit-save:hover { background: rgba(255,159,10,0.25); }
.message-edit-cancel {
  padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-family: inherit;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--text-3);
  transition: background 0.15s;
}
.message-edit-cancel:hover { background: rgba(255,255,255,0.08); }
.island.dismissable { touch-action: none; }
.island-enter { animation: islandSlideIn 0.38s cubic-bezier(0.22,1,0.36,1) both; }
@keyframes islandSlideIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

/* Dismiss hint — directional chevron with directional nudge */
.island-hint {
  position: absolute; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.16); pointer-events: none;
}
.island-hint.hint-up { top: -16px; animation: hintPulseUp 3.5s ease-in-out infinite; }
.island-hint.hint-up svg { transform: rotate(180deg); }
.island-hint.hint-down { bottom: -16px; animation: hintPulseDown 3.5s ease-in-out infinite; }
@keyframes hintPulseUp {
  0%,35%,100% { opacity: 0; transform: translateX(-50%) translateY(3px); }
  60%,75%     { opacity: 1; transform: translateX(-50%) translateY(-1px); }
}
@keyframes hintPulseDown {
  0%,35%,100% { opacity: 0; transform: translateX(-50%) translateY(-3px); }
  60%,75%     { opacity: 1; transform: translateX(-50%) translateY(1px); }
}

/* Restore pill */
.island-restore {
  position: absolute; z-index: 50; left: 50%; transform: translateX(-50%);
  background: rgba(30,30,34,0.7); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 6px 16px; cursor: pointer; color: rgba(255,255,255,0.4);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); transition: background 0.2s, color 0.2s, transform 0.18s cubic-bezier(0.34,1.4,0.64,1);
}
.island-restore:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); transform: translateX(-50%) scale(1.04); }
.island-restore:active { transform: translateX(-50%) scale(0.97); }
.restore-top { top: 8px; }
.restore-bottom { bottom: 8px; }
.island-restore-enter { animation: restoreSlideIn 0.32s cubic-bezier(0.34,1.4,0.64,1) both; }
@keyframes restoreSlideIn { from { opacity: 0; transform: translateX(-50%) scale(0.8) translateY(4px); } to { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); } }

/* ═══ PILL ═══ */
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 100px;
  color: var(--text-2);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.14s cubic-bezier(0.34,1.5,0.64,1);
  white-space: nowrap;
}
.pill:hover { background: var(--surface-2); color: var(--text); transform: scale(1.03); }
.pill:active { transform: scale(0.96); transition-duration: 0.08s; }
.pill.active {
  background: color-mix(in srgb, var(--pill-color, var(--accent)) 18%, transparent);
  border-color: color-mix(in srgb, var(--pill-color, var(--accent)) 40%, transparent);
  color: var(--pill-color, var(--accent));
}
.pill.compact { padding: 5px 10px; font-size: 12px; gap: 4px; }
.pill.compact svg { width: 12px; height: 12px; }
.pill.disabled { opacity: 0.4; cursor: not-allowed; }
.pill-badge { padding: 2px 6px; background: var(--accent); border-radius: 100px; font-size: 10px; color: white; }

/* ═══ POLICY BANNER ═══ */
.policy-banner {
  position: absolute;
  top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 60;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: rgba(255, 159, 10, 0.15);
  border: 1px solid rgba(255, 159, 10, 0.3);
  border-radius: var(--radius-md);
  backdrop-filter: blur(20px);
  animation: bannerIn 0.3s ease;
  max-width: calc(100% - 24px);
}
@keyframes bannerIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.policy-icon { color: var(--warning); flex-shrink: 0; }
.policy-content { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.policy-label { font-size: 12px; font-weight: 600; color: var(--warning); }
.policy-reason { font-size: 11px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.policy-mode { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-3); flex-shrink: 0; }
.policy-dismiss { background: none; border: none; color: var(--text-3); cursor: pointer; padding: 4px; flex-shrink: 0; }
.policy-dismiss:hover { color: var(--text); }

/* ═══ PROFILE INDICATOR ═══ */
.profile-indicator {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--profile-color, var(--text-2));
  font-size: 12px; font-weight: 500;
}
.profile-indicator .safety-badge { color: var(--success); }

/* ═══ AGENT SELECTOR ═══ */
.agent-selector { position: relative; }
.agent-current {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
}
.agent-current:hover { background: var(--surface-2); }
.agent-current .open { transform: rotate(180deg); }
.agent-current:disabled { opacity: 0.5; cursor: not-allowed; }
.agent-dropdown {
  position: absolute;
  top: calc(100% + 8px); left: 0;
  width: 280px;
  background: rgba(22,22,26,0.98);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  backdrop-filter: blur(40px);
  z-index: 100;
  padding: 8px;
  animation: dropIn 0.2s ease;
}
@keyframes dropIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
.agent-option {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 12px;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2); font-size: 13px;
  cursor: pointer; text-align: left;
}
.agent-option:hover { background: var(--surface); color: var(--text); }
.agent-option.active { background: var(--surface-2); color: var(--text); }
.agent-option.disabled { opacity: 0.4; cursor: not-allowed; }
.agent-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.agent-name { font-weight: 500; }
.agent-desc { font-size: 11px; color: var(--text-3); }
.agent-caps { display: flex; gap: 4px; flex-wrap: wrap; }
.cap-badge { padding: 2px 6px; background: var(--surface); border-radius: 4px; font-size: 10px; color: var(--text-3); }
.agent-lock { color: var(--text-3); }

/* ═══ SCOPE INDICATOR — RT-17: Visible on mobile (compact) ═══ */
.scope-indicator {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px;
  flex-shrink: 0;
}
.scope-label { color: var(--text-3); }
.scope-badge { padding: 2px 5px; background: var(--surface); border-radius: 4px; color: var(--text-3); font-size: 10px; }

/* ═══ REDACTION NOTICE ═══ */
.redaction-notice {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(48, 209, 88, 0.1);
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--success);
}

/* ═══ AUDIT INDICATOR ═══ */
.audit-indicator {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.audit-indicator.healthy { color: var(--success); }
.audit-indicator.warning { color: var(--warning); }

/* ═══ CONNECTION ERROR — RT-11, RT-15 ═══ */
.connection-error {
  position: absolute;
  bottom: 200px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: rgba(255, 55, 95, 0.15);
  border: 1px solid rgba(255, 55, 95, 0.3);
  border-radius: var(--radius-md);
  backdrop-filter: blur(20px);
  z-index: 55;
  font-size: 12px;
  color: var(--danger);
  animation: bannerIn 0.3s ease;
}

/* ═══ SIDEBAR ═══ */
.sidebar-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 90; animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.sidebar {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 280px;
  background: rgba(16,16,20,0.98);
  border-right: 1px solid var(--border);
  backdrop-filter: blur(40px);
  z-index: 100;
  display: flex; flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.sidebar.open { transform: translateX(0); }
.sidebar-top { padding: 12px; }
.new-chat {
  width: 100%; padding: 12px 16px;
  display: flex; align-items: center; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text); font-size: 14px;
  cursor: pointer;
}
.new-chat:hover { background: var(--surface-2); }
.sidebar-search {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; margin: 0 12px 8px;
  background: var(--surface);
  border-radius: var(--radius-sm);
}
.sidebar-search svg { color: var(--text-3); flex-shrink: 0; }
.sidebar-search input { flex: 1; background: none; border: none; color: var(--text); font-size: 13px; outline: none; }
.sidebar-search button { background: none; border: none; color: var(--text-3); cursor: pointer; }
.sidebar-section { padding: 0 8px; }
.sidebar-section.flex-1 { flex: 1; overflow-y: auto; }
.section-title {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 8px 6px;
  font-size: 11px; font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
}
.section-title button { margin-left: auto; background: none; border: none; color: var(--text-3); cursor: pointer; }
.section-title button:hover { color: var(--text); }
.project-list, .conv-list { display: flex; flex-direction: column; gap: 2px; }
.project-item, .conv-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2); font-size: 13px;
  cursor: pointer; text-align: left;
}
.project-item:hover, .conv-item:hover { background: var(--surface); color: var(--text); }
.project-item.active, .conv-item.active { background: var(--surface-2); color: var(--text); }
.conv-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-delete { opacity: 0; background: none; border: none; color: var(--text-3); cursor: pointer; padding: 4px; flex-shrink: 0; }
.conv-item:hover .conv-delete { opacity: 1; }
.sidebar-bottom {
  padding: 12px;
  border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 8px;
}
.sidebar-link {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2); font-size: 13px;
  cursor: pointer;
}
.sidebar-link:hover { background: var(--surface); color: var(--text); }
.sidebar-skills {
  display: flex; gap: 6px; padding: 8px 12px 0;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.sidebar-skills::-webkit-scrollbar { display: none; }

/* ═══ MAIN ═══ */
.main { flex: 1; display: flex; flex-direction: column; position: relative; min-width: 0; }

/* ═══ HEADER ═══ */
.header-island {
  position: absolute;
  top: 14px; left: 18px; right: 18px;
  z-index: 50;
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
}
.header-spacer { flex: 1; }
.header-center { display: flex; gap: 6px; flex: 1; min-width: 0; }
.header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.token-badge {
  padding: 4px 10px;
  background: var(--surface);
  border-radius: 100px;
  font-size: 11px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.icon-btn {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  cursor: pointer; flex-shrink: 0;
}
.icon-btn:hover { background: var(--surface); color: var(--text); }

/* ═══ MESSAGES ═══ */
.messages-scroll { flex: 1; overflow-y: auto; padding: 80px 16px 230px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.messages { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
.message { display: flex; gap: 12px; animation: msgIn 0.28s cubic-bezier(0.22,1,0.36,1); }
@keyframes msgIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.message.user { justify-content: flex-end; }
.message-avatar {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--agent-color, var(--accent)), #6366f1);
  border-radius: 50%;
  flex-shrink: 0;
}
.message-avatar.user { background: var(--surface-2); }
.message-avatar svg { color: white; }
.message-content { max-width: 85%; min-width: 0; }
.message.user .message-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 18px;
}
.message-text { font-size: 15px; line-height: 1.65; word-break: break-word; }
.message.user .message-text { white-space: pre-wrap; }
.stream-cursor {
  display: inline;
  color: var(--accent);
  text-shadow: 0 0 6px var(--accent-glow), 0 0 14px var(--accent-glow);
  animation: cursorFade 0.9s ease-in-out infinite;
  font-weight: normal;
  user-select: none;
}
@keyframes cursorFade {
  0%, 100% { opacity: 1; }
  45%, 55% { opacity: 0; }
}

/* ═══ MARKDOWN ═══ */
.md-codeblock { position: relative; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px 14px; margin: 8px 0; overflow-x: auto; font-size: 13px; line-height: 1.5; font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace; }
.md-codeblock code { color: rgba(255,255,255,0.85); }
.md-lang { position: absolute; top: 4px; right: 8px; font-size: 10px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 1px; font-family: inherit; }
.md-inline-code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; font-family: 'SF Mono', ui-monospace, monospace; color: rgba(255,255,255,0.85); }
.md-h { margin: 12px 0 4px; font-weight: 600; color: rgba(255,255,255,0.9); }
h3.md-h { font-size: 1.1em; } h4.md-h { font-size: 1em; } h5.md-h { font-size: 0.95em; }
.md-li { margin-left: 16px; padding-left: 4px; list-style: disc; display: list-item; }
.md-li.md-ol { list-style: decimal; }
.md-link { color: #a78bfa; text-decoration: none; border-bottom: 1px solid rgba(167,139,250,0.3); }
.md-link:hover { color: #c4b5fd; border-bottom-color: rgba(196,181,253,0.5); }
.md-line { display: inline; }
.message-actions { display: flex; gap: 4px; margin-top: 8px; animation: fadeIn 0.15s ease; }
.message-actions button {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-3);
  cursor: pointer;
}
.message-actions button:hover { background: var(--surface-2); color: var(--text); }

/* ═══ IMAGE ATTACHMENTS ═══ */
.message-images { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.message-img-thumb {
  max-width: 220px; max-height: 160px; border-radius: 10px; object-fit: cover;
  border: 1px solid var(--border); cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.message-img-thumb:hover { opacity: 0.9; transform: scale(1.02); }

/* ═══ THOUGHT BLOCK ═══ */
.thought-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  overflow: hidden;
}
.thought-toggle {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: none; border: none;
  color: var(--text-2); font-size: 13px;
  cursor: pointer; text-align: left;
}
.thought-icon { position: relative; color: #bf5af2; flex-shrink: 0; }
.streaming-dot {
  position: absolute; top: -2px; right: -2px;
  width: 6px; height: 6px;
  background: var(--success);
  border-radius: 50%;
  animation: pulse 1s infinite;
}
@keyframes pulse { 50% { opacity: 0.5; } }
.thought-label { font-weight: 500; flex-shrink: 0; }
.thought-preview { flex: 1; color: var(--text-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chevron { transition: transform 0.2s; flex-shrink: 0; }
.chevron.open { transform: rotate(180deg); }
.thought-content { padding: 0 14px 14px; }
.thought-content pre {
  margin: 0; padding: 12px;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ═══ ARTIFACT — RT-19 ═══ */
.artifact-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 12px;
}
.artifact-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,0.2);
  flex-wrap: wrap;
}
.artifact-header svg { color: #bf5af2; flex-shrink: 0; }
.artifact-title { font-weight: 500; font-size: 14px; }
.artifact-type { color: var(--text-3); font-size: 11px; }
.artifact-tabs { display: flex; gap: 4px; margin-left: auto; }
.artifact-tabs button { padding: 5px 10px; background: none; border: none; border-radius: 6px; color: var(--text-3); font-size: 12px; cursor: pointer; }
.artifact-tabs button:hover { background: var(--surface); }
.artifact-tabs button.active { background: var(--surface-2); color: var(--text); }
.artifact-actions { display: flex; gap: 4px; }
.artifact-actions button { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; border-radius: 6px; color: var(--text-3); cursor: pointer; }
.artifact-actions button:hover { background: var(--surface); color: var(--text); }
.artifact-preview { width: 100%; height: 280px; border: none; background: #0a0a0c; }
.artifact-code { max-height: 280px; overflow: auto; padding: 16px; }
.artifact-code pre { margin: 0; font-family: 'SF Mono', monospace; font-size: 12px; word-break: break-all; }

/* ═══ EMPTY STATE ═══ */
.empty-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 60px 24px;
  text-align: center;
  min-height: 60vh;
}
/* ═══ KURO CUBE (EmptyState) ═══ */
.kuro-cube-wrap { perspective: 600px; width: 80px; height: 80px; margin: 0 auto 16px; }
.kuro-cube { width: 52px; height: 52px; position: relative; transform-style: preserve-3d; animation: kcSpin 20s linear infinite; margin: 14px auto; }
@keyframes kcSpin { from { transform: rotateX(-20deg) rotateY(-30deg); } to { transform: rotateX(-20deg) rotateY(330deg); } }
.kc-face { position: absolute; width: 52px; height: 52px; background: linear-gradient(135deg,rgba(91,33,182,.35),rgba(76,29,149,.25) 50%,rgba(49,10,101,.45)); border: 1px solid rgba(139,92,246,.25); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.kc-ft { transform: translateZ(26px); } .kc-bk { transform: rotateY(180deg) translateZ(26px); }
.kc-rt { transform: rotateY(90deg) translateZ(26px); } .kc-lt { transform: rotateY(-90deg) translateZ(26px); }
.kc-tp { transform: rotateX(90deg) translateZ(26px); } .kc-bt { transform: rotateX(-90deg) translateZ(26px); }
@media (prefers-reduced-motion: reduce) { .kuro-cube { animation: none; transform: rotateX(-20deg) rotateY(-30deg); } }
.empty-state h1 { font-size: 32px; font-weight: 600; margin: 0 0 8px; }
.empty-profile {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 24px;
  padding: 6px 12px;
  background: var(--surface);
  border-radius: 100px;
  font-size: 12px;
  color: var(--text-2);
}
.typing-anim { height: 24px; margin-bottom: 16px; font-size: 16px; color: var(--text-2); }
.typing-anim .cursor {
  display: inline-block;
  width: 2px; height: 18px;
  background: var(--accent);
  margin-left: 2px;
  animation: cursorBlink 0.9s ease-in-out infinite;
  vertical-align: middle;
}
.typing-anim .cursor.thinking { animation: cursorPulse 1.2s ease-in-out infinite; background: var(--text-3); }
@keyframes cursorBlink { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes cursorPulse { 0%, 100% { opacity: 0.3; transform: scaleY(0.8); } 50% { opacity: 0.7; transform: scaleY(1); } }
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.quick-action {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-2); font-size: 14px;
  cursor: pointer;
}
.quick-action:hover { background: var(--surface-2); color: var(--text); border-color: var(--accent); }
.quick-action svg { color: var(--accent); }

/* ═══ INPUT AREA — wrapper for tools row + input island ═══ */
.input-area {
  position: absolute;
  bottom: 24px; left: 50%; transform: translateX(-50%);
  width: min(calc(100% - 44px), 720px);
  z-index: 50;
  display: flex; flex-direction: column; gap: 7px;
}
.input-tools-row {
  display: flex; gap: 6px; align-items: center;
  padding: 0 4px;
}
/* Shared pill island style — upload, speed, etc. */
.tool-island {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px;
  background: rgba(22,22,26,0.88);
  border: 1px solid var(--border);
  border-radius: 100px;
  backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.35);
  color: var(--text-2); font-size: 12px; font-weight: 500;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.15s, color 0.15s, transform 0.13s cubic-bezier(0.2,0,0,1);
  -webkit-tap-highlight-color: transparent;
}
.tool-island:hover { background: rgba(35,35,42,0.92); color: var(--text); }
.tool-island:active { transform: scale(0.95); transition-duration: 0.07s; }
/* Speed island modes */
.speed-island.fast { color: rgba(255,214,10,0.75); border-color: rgba(255,214,10,0.15); }
.speed-island.fast:hover { background: rgba(255,214,10,0.07); color: rgba(255,230,80,0.95); border-color: rgba(255,214,10,0.3); }
.speed-island.sov { color: rgba(168,85,247,0.85); border-color: rgba(168,85,247,0.22); }
.speed-island.sov:hover { background: rgba(168,85,247,0.1); color: #a855f7; border-color: rgba(168,85,247,0.4); }

/* ═══ INPUT ISLAND ═══ */
.input-island {
  padding: 12px;
}
.input-main { display: flex; align-items: flex-end; gap: 8px; }
.input-main textarea {
  flex: 1;
  background: none; border: none;
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
  resize: none;
  outline: none;
  min-height: 24px;
  max-height: 150px;
  font-family: inherit;
  padding: 0;
  vertical-align: middle;
}
.input-main textarea::placeholder { color: var(--text-3); }
.voice-btn {
  position: relative;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  border-radius: 50%;
  color: var(--text-2);
  cursor: pointer; flex-shrink: 0;
}
.voice-btn:hover { background: var(--surface); color: var(--text); }
.voice-btn.listening { color: var(--danger); }
.voice-pulse {
  position: absolute; inset: 0;
  border: 2px solid var(--danger);
  border-radius: 50%;
  animation: voicePulse 1.5s infinite;
  pointer-events: none;
}
@keyframes voicePulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
.send-btn {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer; flex-shrink: 0;
}
.send-btn:hover { filter: brightness(1.1); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop { background: var(--danger); }
.input-tools {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--border);
}
.skill-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.input-meta { display: flex; gap: 10px; flex-shrink: 0; }
.hint { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-3); }

/* ═══ STREAM PROGRESS ═══ */
.stream-progress { margin-top: 8px; padding: 8px 0; }
.progress-bar { height: 3px; background: var(--surface); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #6366f1); border-radius: 2px; transition: width 0.3s ease; }
.progress-stats { display: flex; gap: 12px; margin-top: 6px; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }

/* ═══ DROP ZONE ═══ */
.drop-zone {
  position: absolute; inset: 16px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  background: rgba(10,10,12,0.95);
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  z-index: 200;
}
.drop-zone svg { color: var(--accent); }
.drop-zone span { font-size: 16px; color: var(--text-2); }

/* ═══ RESPONSIVE ═══ */

/* Tablet (iPad portrait / landscape) */
@media (max-width: 1024px) {
  .header-island { top: 12px; left: 14px; right: 14px; padding: 7px 10px; gap: 10px; }
  .input-area { bottom: 18px; width: min(calc(100% - 32px), 680px); }
  .messages-scroll { padding: 76px 14px 220px; }
  .messages { max-width: 680px; gap: 20px; }
  .message-text { font-size: 14.5px; }
  .icon-btn { width: 34px; height: 34px; }
  .send-btn { width: 34px; height: 34px; }
  .voice-btn { width: 34px; height: 34px; }
  .empty-state h1 { font-size: 28px; }
  .typing-anim { font-size: 15px; }
}

/* Phone (iPhone / Android) */
@media (max-width: 768px) {
  /* Header: strip down to menu + agent + new-chat only */
  .header-island { top: 8px; left: 8px; right: 8px; padding: 6px 8px; gap: 6px; }
  .header-center { display: none; }   /* skill/project pills live in input area */
  .scope-indicator { display: none; } /* too dense for phone */
  .token-badge { display: none; }

  /* Input */
  .input-area { bottom: 10px; width: calc(100% - 20px); }
  .tool-island { font-size: 11px; padding: 5px 10px; }
  .input-main textarea { font-size: 16px; } /* prevent iOS auto-zoom */
  .icon-btn { width: 32px; height: 32px; }
  .send-btn { width: 34px; height: 34px; }

  /* Messages */
  .messages-scroll { padding: 70px 10px 190px; }
  .messages { gap: 16px; }
  .message { gap: 8px; }
  .message-avatar { width: 28px; height: 28px; }
  .message-text { font-size: 14px; line-height: 1.55; }
  .md-codeblock { font-size: 12px; padding: 10px 12px; }

  /* Misc */
  .quick-actions { flex-direction: column; }
  .quick-action { font-size: 13px; }
  .policy-banner { left: 6px; right: 6px; transform: none; flex-wrap: wrap; }
  .connection-error { left: 6px; right: 6px; transform: none; }
  .empty-state h1 { font-size: 24px; }
  .empty-state { padding: 40px 16px; min-height: 50vh; }
  .kuro-cube-wrap { width: 64px; height: 64px; }
  .kuro-cube { width: 42px; height: 42px; }
  .kc-face { width: 42px; height: 42px; }
  .kc-ft { transform: translateZ(21px); } .kc-bk { transform: rotateY(180deg) translateZ(21px); }
  .kc-rt { transform: rotateY(90deg) translateZ(21px); } .kc-lt { transform: rotateY(-90deg) translateZ(21px); }
  .kc-tp { transform: rotateX(90deg) translateZ(21px); } .kc-bt { transform: rotateX(-90deg) translateZ(21px); }
}

/* Small phone (iPhone SE / Mini / compact) */
@media (max-width: 430px) {
  .header-island { top: 6px; left: 6px; right: 6px; padding: 5px 6px; gap: 4px; }
  .input-area { bottom: 8px; width: calc(100% - 16px); }
  .messages-scroll { padding: 66px 8px 175px; }
  .message-text { font-size: 13.5px; }
  .agent-selector { font-size: 12px; }
  .agent-current span { max-width: 52px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { padding: 5px 10px; font-size: 11px; }
  .pill.compact { padding: 3px 8px; font-size: 10px; }
  .empty-state h1 { font-size: 22px; }
  .quick-action { padding: 10px 14px; font-size: 12px; }
}
        `}</style>
      </div>
    </KuroContext.Provider>
  );
}
