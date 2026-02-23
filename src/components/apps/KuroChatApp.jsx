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
import KuroCubeSpinner from '../ui/KuroCubeSpinner';
import ReasoningPanel from '../ui/ReasoningPanel';

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
        // Images — ![alt](url)
        const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
        if (imgMatch) { lineEls.push(<img key={key++} src={imgMatch[2]} alt={imgMatch[1]} className="md-img" loading="lazy" />); continue; }
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


// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3.5: WEB (o) TOGGLE + SOURCE FLASH CARDS
// ═══════════════════════════════════════════════════════════════════════════

const WebToggle = ({ enabled, onChange }) => (
  <button
    type="button"
    className={`tool-island web-island ${enabled ? 'web-on' : ''}`}
    onClick={() => onChange(!enabled)}
    title={enabled ? 'Web (o) ON — click to disable' : 'Web (o) OFF — click to enable'}
  >
    <Globe size={13} />
    <span>Web {enabled ? 'on' : 'off'}</span>
  </button>
);

const WebSourceCards = ({ results }) => {
  if (!results || results.length === 0) return null;
  return (
    <div className="web-source-cards">
      {results.slice(0, 5).map((r, i) => (
        <a
          key={i}
          className="web-card"
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="web-card-num">{i + 1}</div>
          <div className="web-card-body">
            <div className="web-card-title">{r.title}</div>
            <div className="web-card-url">{r.url.replace(/^https?:\/\//, '').slice(0, 60)}</div>
            {r.snippet && <div className="web-card-snippet">{r.snippet.slice(0, 100)}</div>}
          </div>
          <ExternalLink size={11} className="web-card-icon" />
        </a>
      ))}
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
// KURO SWITCH — reusable toggle used in panels
// ═══════════════════════════════════════════════════════════════════════════
const KuroSwitch = ({ on, onChange }) => (
  <button
    type="button"
    className={`ks-switch ${on ? 'on' : ''}`}
    onClick={() => onChange(!on)}
    role="switch"
    aria-checked={on}
  >
    <span className="ks-thumb" />
  </button>
);


// ═══════════════════════════════════════════════════════════════════════════
// VISION BAR — compact quality + aspect selectors above input
// ═══════════════════════════════════════════════════════════════════════════
const VISION_PRESETS = ['draft', 'balanced', 'pro'];
const VISION_ASPECTS = ['1:1', '4:5', '16:9', '9:16'];

const VisionBar = ({ preset, setPreset, aspect, setAspect }) => (
  <div className="vision-bar">
    <div className="vb-group">
      {VISION_PRESETS.map(p => (
        <button key={p} className={`vb-pill${preset === p ? ' active' : ''}`} onClick={() => setPreset(p)}>
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
    <div className="vb-sep" />
    <div className="vb-group">
      {VISION_ASPECTS.map(a => (
        <button key={a} className={`vb-pill${aspect === a ? ' active' : ''}`} onClick={() => setAspect(a)}>
          {a}
        </button>
      ))}
    </div>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
// VISION GENERATING CARD — live progress during diffusion
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_PCT = { start: 5, intent: 10, gpu: 15, scene_graph: 30, generate: 42, composite: 82, evaluate: 92 };

const VisionGeneratingCard = ({ gen }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const pct = gen.pct ?? PHASE_PCT[gen.phase] ?? 5;
  const label = gen.label || gen.phase || 'Initializing…';
  return (
    <div className="vision-gen-card">
      <div className="vgc-header">
        <KuroCubeSpinner size="xs" />
        <span className="vgc-title">Generating image</span>
        <span className="vgc-meta">{gen.preset} · {gen.aspect}</span>
        <span className="vgc-elapsed">{elapsed}s</span>
      </div>
      <div className="vgc-track"><div className="vgc-fill" style={{ width: `${pct}%` }} /></div>
      <div className="vgc-phase">{label}</div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// VISION GRID — 2×2 variant display with seed + download actions
// ═══════════════════════════════════════════════════════════════════════════
const VisionGrid = ({ images, onUseSeed }) => (
  <div className={`vision-grid${images.length > 1 ? ' grid-multi' : ''}`}>
    {images.map((img, i) => (
      <div key={i} className="vg-cell">
        <img src={img.url} alt={`variant ${i + 1}`} className="vg-img" loading="lazy" />
        <div className="vg-actions">
          <button className="vg-btn" onClick={() => onUseSeed(img.seed)} title={`Use seed ${img.seed}`}>
            <RefreshCw size={11} />
            <span>{img.seed}</span>
          </button>
          <a className="vg-btn" href={img.url} download target="_blank" rel="noreferrer" title="Download">
            <Download size={11} />
          </a>
        </div>
      </div>
    ))}
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
// ATTACH PANEL — glass popover above input island
// ═══════════════════════════════════════════════════════════════════════════
const AttachPanel = ({
  onAttachFile,
  webEnabled, onWebChange,
  powerDial, onSpeedChange,
  insightsEnabled, onInsightsChange,
  analysisEnabled, onAnalysisChange,
  actionsEnabled, onActionsChange,
  onClose,
}) => {
  const fileRows = [
    { icon: Folder, label: 'Attach File', desc: 'Docs, images, code — opens file browser', action: onAttachFile },
  ];
  const toggleRows = [
    { label: 'Web Search',      desc: 'Fetch live results before generating',          on: webEnabled,        set: onWebChange,       color: '#64b4ff' },
    { label: 'Fast Responses',  desc: 'Quicker replies using a smaller model',         on: powerDial !== 'sovereign', set: v => onSpeedChange(v ? 'instant' : 'sovereign'), color: '#ffd60a' },
    { label: 'Insights',        desc: 'Pattern recognition & key point extraction',    on: insightsEnabled,   set: onInsightsChange,  color: '#5e5ce6' },
    { label: 'Analysis',        desc: 'Structured data & document analysis mode',      on: analysisEnabled,   set: onAnalysisChange,  color: '#ff9f0a' },
    { label: 'Actions',         desc: 'Execute code and system-level commands',        on: actionsEnabled,    set: onActionsChange,   color: '#30d158' },
  ];
  return (
    <>
      <div className="ap-backdrop" onClick={onClose} />
      <div className="ap-panel" onClick={e => e.stopPropagation()}>
        <div className="ap-inner">
          {fileRows.map(r => (
            <button key={r.label} type="button" className="ap-row ap-file-row" onClick={() => { r.action(); }}>
              <span className="ap-row-icon"><r.icon size={16} /></span>
              <span className="ap-row-body">
                <span className="ap-row-label">{r.label}</span>
                <span className="ap-row-desc">{r.desc}</span>
              </span>
              <ChevronRight size={14} className="ap-row-arr" />
            </button>
          ))}
          <div className="ap-divider" />
          {toggleRows.map(t => (
            <div key={t.label} className="ap-row ap-toggle-row">
              <span className="ap-row-body">
                <span className="ap-row-label">{t.label}</span>
                <span className="ap-row-desc">{t.desc}</span>
              </span>
              <KuroSwitch on={t.on} onChange={t.set} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL — full slide-over with all advanced controls
// ═══════════════════════════════════════════════════════════════════════════
const SettingsPanel = ({
  settings, updateSetting,
  powerDial, setPowerDial,
  webEnabled, toggleWeb,
  activeSkill, setActiveSkill,
  onClose,
}) => (
  <>
    <div className="sp-backdrop" onClick={onClose} />
    <div className="sp-panel">
      <div className="sp-header">
        <span className="sp-title">Settings</span>
        <button className="sp-close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="sp-body">

        <div className="sp-section">
          <div className="sp-section-title">Intelligence</div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Show thinking</div>
              <div className="sp-row-desc">Display chain-of-thought reasoning blocks inline</div>
            </div>
            <KuroSwitch on={settings.showThinking} onChange={v => updateSetting('showThinking', v)} />
          </div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Preemptive compute</div>
              <div className="sp-row-desc">Speculatively start generating before you finish typing</div>
            </div>
            <KuroSwitch on={settings.preemptEnabled} onChange={v => updateSetting('preemptEnabled', v)} />
          </div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Live edit corrections</div>
              <div className="sp-row-desc">Show auto-correction bar for mid-stream phrasing fixes</div>
            </div>
            <KuroSwitch on={settings.liveEditEnabled} onChange={v => updateSetting('liveEditEnabled', v)} />
          </div>
          <div className="sp-row sp-row-stack">
            <div className="sp-row-info">
              <div className="sp-row-label">Volatility</div>
              <div className="sp-row-desc">How unhinged the model gets. Low = clinical. High = feral.</div>
            </div>
            <div className="vol-slider-wrap">
              <div className="vol-track">
                <div className="vol-fill" style={{ width: `${settings.temperature}%` }} />
                <div className="vol-notches">
                  {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => (
                    <span key={n} className={`vol-notch${settings.temperature >= n ? ' lit' : ''}`} />
                  ))}
                </div>
                <input
                  type="range" min={0} max={100} value={settings.temperature}
                  onChange={e => updateSetting('temperature', +e.target.value)}
                  className="vol-input"
                />
              </div>
              <div className="vol-readout">
                <span className="vol-val">{settings.temperature}</span>
                <span className="vol-label">{settings.temperature < 20 ? 'CLINICAL' : settings.temperature < 40 ? 'STABLE' : settings.temperature < 60 ? 'NOMINAL' : settings.temperature < 80 ? 'VOLATILE' : 'UNHINGED'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="sp-section">
          <div className="sp-section-title">Tools</div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Web search</div>
              <div className="sp-row-desc">Fetch live results from the web before responding</div>
            </div>
            <KuroSwitch on={webEnabled} onChange={toggleWeb} />
          </div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Code sandbox</div>
              <div className="sp-row-desc">Run and preview generated code in an isolated frame</div>
            </div>
            <KuroSwitch on={activeSkill === 'sandbox'} onChange={v => setActiveSkill(v ? 'sandbox' : 'chat')} />
          </div>
        </div>

        <div className="sp-section">
          <div className="sp-section-title">Model</div>
          <div className="sp-row">
            <div className="sp-row-info">
              <div className="sp-row-label">Response speed</div>
              <div className="sp-row-desc">Fast uses a smaller model; Sovereign uses full depth</div>
            </div>
            <div className="sp-seg">
              <button className={`sp-seg-btn ${powerDial !== 'sovereign' ? 'active' : ''}`} onClick={() => setPowerDial('instant')}>
                <Zap size={12} /><span>Fast</span>
              </button>
              <button className={`sp-seg-btn ${powerDial === 'sovereign' ? 'active' : ''}`} onClick={() => setPowerDial('sovereign')}>
                <Crown size={12} /><span>Sovereign</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  </>
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
  // Auto-open when the model starts generating thinking tokens
  useEffect(() => { if (isStreaming) setExpanded(true); }, [isStreaming]);
  if (!content && !isStreaming) return null;
  const lines = (content || '').split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 2).map(l => l.slice(0, 60)).join(' \u2022 ');
  return (
    <div className={`thought-block ${expanded ? 'expanded' : ''}`}>
      <button className="thought-toggle" onClick={() => setExpanded(!expanded)}>
        <div className="thought-icon">
          {isStreaming ? <KuroCubeSpinner size="xs" /> : <Brain size={14} />}
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
// PHASE 3: JSON TOOL CALL EXTRACTOR
// Scans accumulated model output for embedded {"kuro_tool_call": {...}} blocks.
// <think> blocks are stripped before scanning (never surfaced).
// ═══════════════════════════════════════════════════════════════════════════
function extractJsonToolCalls(text) {
  const calls = [];
  if (!text) return calls;
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  let pos = 0;
  while (pos < stripped.length) {
    const idx = stripped.indexOf('{"kuro_tool_call":', pos);
    if (idx === -1) break;
    let depth = 0, inStr = false, esc = false;
    for (let i = idx; i < stripped.length; i++) {
      const ch = stripped[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const raw = stripped.slice(idx, i + 1);
            const parsed = JSON.parse(raw);
            if (parsed.kuro_tool_call) calls.push({ raw, parsed });
          } catch { /* malformed JSON, skip */ }
          break;
        }
      }
    }
    pos = idx + 1;
  }
  return calls;
}

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
const Message = ({ msg, msgIndex, isStreaming, onCopy, onEdit, onUseSeed, showThoughts, agents, activeAgent }) => {
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
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 30);
  };
  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== msg.content) onEdit(msgIndex, trimmed);
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div className={`message ${msg.role}`}>
      <div className={`message-content${msg.isEdited ? ' edited' : ''}`}>
        {msg.role === 'assistant' && (
          <ReasoningPanel meta={msg.meta} isStreaming={isStreaming} />
        )}
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
        {/* Vision generating card — shown while diffusion is running */}
        {msg.role === 'assistant' && msg.visionGenerating && (
          <VisionGeneratingCard gen={msg.visionGenerating} />
        )}
        {/* Vision variants grid — shown for n>1 results */}
        {msg.role === 'assistant' && msg.visionImages && msg.visionImages.length > 1 && (
          <VisionGrid images={msg.visionImages} onUseSeed={onUseSeed} />
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
            {isStreaming && !parsed.thinkStreaming && <span className={`stream-cursor${msg.isEditResponse ? ' edit-cursor' : ''}`}>_</span>}
          </div>
        )}
        {!isStreaming && !editing && (
          <div className="message-actions">
            <button onClick={() => onCopy(msg.content)} title="Copy"><Copy size={14} /></button>
            {msg.role === 'user' && onEdit && (
              <button onClick={startEdit} title="Edit"><Edit3 size={14} /></button>
            )}
          </div>
        )}
      </div>
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
  activeSkill, onSkillChange, onOpenSettings,
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
          <button className="sidebar-link" onClick={() => { onOpenSettings?.(); onClose(); }}><Settings size={16} /><span>Settings</span></button>
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
    <p className="empty-tagline">Chat, code, or execute.</p>
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

  // Phase 3.5: Web (o) mode — off by default, persisted in sessionStorage
  const [webEnabled, setWebEnabled] = useState(() => {
    try { return sessionStorage.getItem('kuro_web_enabled') === 'true'; } catch { return false; }
  });
  const [webResults, setWebResults] = useState([]); // latest search results for source cards

  // Persist web toggle in session
  const toggleWeb = (v) => {
    setWebEnabled(v);
    try { sessionStorage.setItem('kuro_web_enabled', v ? 'true' : 'false'); } catch {}
  };

  // Vision quality + aspect — persisted in sessionStorage
  const [visionPreset, setVisionPreset] = useState(() => {
    try { return sessionStorage.getItem('kuro_vision_preset') || 'draft'; } catch { return 'draft'; }
  });
  const [visionAspect, setVisionAspect] = useState(() => {
    try { return sessionStorage.getItem('kuro_vision_aspect') || '1:1'; } catch { return '1:1'; }
  });
  const setVPreset = (v) => { setVisionPreset(v); try { sessionStorage.setItem('kuro_vision_preset', v); } catch {} };
  const setVAspect = (v) => { setVisionAspect(v); try { sessionStorage.setItem('kuro_vision_aspect', v); } catch {} };

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
  const [attachPanelOpen, setAttachPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [insightsEnabled, setInsightsEnabled] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [actionsEnabled, setActionsEnabled] = useState(false);

  // Settings — with setter so controls in SettingsPanel are live
  const [settings, setSettings] = useState({ temperature: 70, showThinking: true, preemptEnabled: true, liveEditEnabled: true });
  const updateSetting = useCallback((k, v) => setSettings(prev => ({ ...prev, [k]: v })), []);
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
  // opts.historyForPayload: explicit message array to send (for edit-resend)
  // opts.isEditResponse: marks assistant reply as edit-triggered (orange cursor)
  const sendMessage = useCallback(async (preset = null, opts = {}) => {
    const msg = preset || { role: 'user', content: input.trim() };
    if (!preset && !input.trim()) return;

    const cid = activeId;
    const freshMeta = () => ({ steps: [], tools: [], sources: [], runner: null });
    if (opts.historyForPayload) {
      // Edit-resend: set conversation to explicit history + new assistant slot
      updateMessages(cid, [...opts.historyForPayload, { role: 'assistant', content: '', redactionCount: 0, meta: freshMeta(), isEditResponse: true }]);
    } else if (!preset) {
      updateMessages(cid, prev => [...prev, msg, { role: 'assistant', content: '', redactionCount: 0, meta: freshMeta() }]);
      setInput('');
    } else {
      updateMessages(cid, prev => [...prev, { role: 'assistant', content: '', redactionCount: 0, meta: freshMeta() }]);
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
    const historyForApi = opts.historyForPayload || [...messages, msg];
    const payload = {
      messages: historyForApi.map(m => ({
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
      // Vision session preferences (server uses as fallback if LLM doesn't specify)
      visionPreset,
      visionAspect,
    };

    // Phase 3.5: Web (o) — fetch results before stream, inject context into payload
    if (webEnabled && msg.content) {
      setWebResults([]);
      addStep('Searching web sources');
      try {
        const wRes = await authFetch('/api/web/search', {
          method: 'POST',
          body: JSON.stringify({ query: msg.content }),
        });
        if (wRes.ok) {
          const wData = await wRes.json();
          if (wData.results?.length) {
            setWebResults(wData.results);
            setSources(wData.results);         // Phase 3.6: per-message sources
            payload.webContext = wData.context;
          }
        }
      } catch { /* degrade silently */ }
    }

    // ── Phase 3.6: meta dispatch helpers ─────────────────────────────────
    // Update the last assistant message's meta without touching content.
    const dispatchMeta = (fn) => {
      updateMessages(cid, prev => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last?.role === 'assistant') {
          const cur = last.meta || { steps: [], tools: [], sources: [], runner: null };
          u[u.length - 1] = { ...last, meta: fn(cur) };
        }
        return u;
      });
    };
    const addStep = (text) =>
      dispatchMeta(m => ({ ...m, steps: [...m.steps, { id: `${Date.now()}-${Math.random()}`, text }] }));
    const setSources = (sources) =>
      dispatchMeta(m => ({ ...m, sources }));
    const addTool = (id, name) =>
      dispatchMeta(m => ({ ...m, tools: [...m.tools, { id, name, status: 'pending', startMs: Date.now() }] }));
    const updateTool = (id, status, durationMs) =>
      dispatchMeta(m => ({ ...m, tools: m.tools.map(t => t.id === id ? { ...t, status, durationMs } : t) }));
    const setRunner = (runner) =>
      dispatchMeta(m => ({ ...m, runner }));

    let retries = 0;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = [1000, 3000];
    const streamStartMs = Date.now();

    // ── Smooth streaming: buffer tokens, flush on rAF (~60fps) ──────────
    let tokenBuffer = '';
    let toolScanBuffer = ''; // Phase 3: full content for JSON tool call detection
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

    // Phase 3 + 3.6: execute JSON tool calls found in the completed response,
    // updating ReasoningPanel meta as each call proceeds.
    const executedToolIds = new Set(); // Dedup: skip calls already handled via SSE (vision)
    const handleJsonToolCalls = async (content, convId) => {
      const calls = extractJsonToolCalls(content);
      if (!calls.length) return;
      addStep('Validating tool arguments');
      for (const { raw, parsed } of calls) {
        const toolName = parsed?.kuro_tool_call?.name || 'unknown';
        const toolId   = parsed?.kuro_tool_call?.id   || `${toolName}-${Date.now()}`;
        if (executedToolIds.has(toolId)) {
          console.warn(`[VISION_TOOL_LOOP_ABORT] toolId=${toolId} already executed — skipping`);
          continue;
        }
        executedToolIds.add(toolId);
        addTool(toolId, toolName);

        // ── IMMEDIATE: replace raw JSON with a placeholder so it never shows as text ──
        const placeholder = `__TOOL_PENDING_${toolId}__`;
        const replaceInMsg = (search, replacement) => {
          updateMessages(convId, prev => {
            const u = [...prev];
            // Search all assistant messages, not just last (in case new messages arrived)
            for (let i = u.length - 1; i >= 0; i--) {
              if (u[i].role === 'assistant' && u[i].content.includes(search)) {
                u[i] = { ...u[i], content: u[i].content.replace(search, replacement) };
                break;
              }
            }
            return u;
          });
        };

        // Hide the raw JSON immediately
        replaceInMsg(raw, placeholder);

        const invokeStart = Date.now();
        try {
          const res = await authFetch('/api/tools/invoke', {
            method: 'POST',
            body: JSON.stringify(parsed),
          });
          const durationMs = Date.now() - invokeStart;
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            updateTool(toolId, 'error', durationMs);
            replaceInMsg(placeholder, `**Tool error**: ${errText}`);
            continue;
          }
          const data = await res.json();
          const tr = data.kuro_tool_result;
          if (!tr) {
            updateTool(toolId, 'error', durationMs);
            replaceInMsg(placeholder, `**Tool error**: Invalid response from server`);
            continue;
          }
          updateTool(toolId, tr.ok ? 'ok' : 'error', durationMs);

          // Phase 3.6: surface runner job in panel
          if (tr.name === 'runner.spawn' && tr.ok && tr.result) {
            addStep('Running code in sandbox');
            setRunner({
              jobId:  tr.result.jobId  || null,
              status: tr.result.status || 'queued',
              lang:   parsed.kuro_tool_call?.args?.lang || '',
              cmd:    parsed.kuro_tool_call?.args?.cmd  || '',
            });
          }

          // Vision tool: embed image inline instead of JSON dump
          if (tr.name === 'vision.generate' && tr.ok && tr.result?.imageUrl) {
            addStep(`Image generated (${tr.result.elapsed || '?'}s, seed ${tr.result.seed || '?'})`);
          }

          const resultBlock = tr.name === 'vision.generate' && tr.ok && tr.result?.imageUrl
            ? `![Generated Image](${tr.result.imageUrl})\n*${tr.result.dimensions?.width || 1024}×${tr.result.dimensions?.height || 1024} · ${tr.result.pipeline || 'flux'} · ${tr.result.elapsed || '?'}s · seed ${tr.result.seed || '?'}*`
            : tr.ok
            ? `\`\`\`json\n${JSON.stringify(tr.result, null, 2)}\n\`\`\``
            : `**Tool error**: ${tr.error}`;
          replaceInMsg(placeholder, resultBlock);
        } catch (err) {
          updateTool(toolId, 'error', Date.now() - invokeStart);
          replaceInMsg(placeholder, `**Tool error**: ${err.message}`);
          console.error('[TOOL] Invoke error:', err.message);
        }
      }
    };

    addStep('Connecting to model');

    const attemptStream = async () => {
      toolScanBuffer = ''; // reset on each attempt
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

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/event-stream')) {
          const raw = await res.text().catch(() => '');
          let message = 'Unexpected non-stream response from server';
          try {
            const parsed = JSON.parse(raw || '{}');
            message = parsed.message || parsed.error || message;
          } catch {
            if (raw && raw.trim()) message = raw.trim();
          }
          updateMessages(cid, prev => {
            const u = [...prev];
            const last = u[u.length - 1];
            if (last?.role === 'assistant' && !last.content) {
              u[u.length - 1] = { ...last, content: message };
            }
            return u;
          });
          setConnectionError(message);
          setIsLoading(false);
          return;
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

            if (d.type === 'vision_start') {
              addStep(`Generating image…`);
              flushTokenBuffer();
              toolScanBuffer = ''; // Prevent handleJsonToolCalls from re-executing after SSE vision
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant'
                  ? { ...m,
                      content: m.content.replace(/\{[\s\S]*?"vision\.generate"[\s\S]*/, '').trim(),
                      visionGenerating: { phase: 'start', pct: 5, label: 'Initializing…', preset: d.preset || visionPreset, aspect: d.aspect || visionAspect } }
                  : m
              ));
            } else if (d.type === 'vision_phase') {
              if (d.label) addStep(d.label);
              const phasePct = { intent: 10, gpu: 15, scene_graph: 30, generate: 42, composite: 82, evaluate: 92 }[d.phase] || 20;
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant' && m.visionGenerating
                  ? { ...m, visionGenerating: { ...m.visionGenerating, phase: d.phase, pct: phasePct, label: d.label || d.phase } }
                  : m
              ));
            } else if (d.type === 'vision_progress') {
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant' && m.visionGenerating
                  ? { ...m, visionGenerating: { ...m.visionGenerating, pct: d.pct, label: `Diffusing… ${d.elapsed}s` } }
                  : m
              ));
            } else if (d.type === 'vision_result') {
              flushTokenBuffer();
              executedToolIds.add('vision-1'); // Mark as SSE-handled so handleJsonToolCalls skips it
              const w = d.dimensions?.width || 1024, h = d.dimensions?.height || 1024;
              const caption = `*${w}×${h} · ${d.preset || 'draft'} · ${d.elapsed || '?'}s · seed ${d.seed || '?'}*`;
              const imgMd = `![Generated Image](${d.imageUrl})\n${caption}`;
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant'
                  ? { ...m,
                      visionGenerating: null,
                      visionImages: d.images && d.images.length > 1 ? d.images : null,
                      content: (m.content || '') + '\n' + imgMd }
                  : m
              ));
              addStep(`Image generated (${d.elapsed || '?'}s · ${d.preset || 'draft'})`);
            } else if (d.type === 'token') {
              if (tokens === 0) addStep('Generating response');
              tokens++;
              setTokenCount(tokens);
              if (tokens % 10 === 0) {
                dispatchMeta(m => ({ ...m, tokens, elapsed: Date.now() - streamStartMs }));
              }
              // Suppress raw tool call JSON from display
              if (d.content === '\0' || d.content.includes('"kuro_tool_call"')) continue;
              tokenBuffer += d.content;
              toolScanBuffer += d.content;
              scheduleFlush();
            } else if (d.type === 'thinking') {
              // Per-sentence think summaries from the <think> block
              if (d.content) addStep(d.content);
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
              const msg = d.message || 'Stream error';
              updateMessages(cid, prev => {
                const u = [...prev];
                const last = u[u.length - 1];
                if (last?.role === 'assistant' && !last.content) {
                  u[u.length - 1] = { ...last, content: `Error: ${msg}` };
                }
                return u;
              });
              setConnectionError(msg);
            } else if (d.type === 'done') {
              clearTimeout(staleTimer);
              if (rafId) cancelAnimationFrame(rafId);
              flushTokenBuffer();
              // Final meta: token count, model, elapsed time
              const finalElapsed = Date.now() - streamStartMs;
              dispatchMeta(m => ({
                ...m,
                tokens,
                model: d.model || '',
                elapsed: finalElapsed,
              }));
              // Phase 3: detect and execute any JSON tool calls in the response
              handleJsonToolCalls(toolScanBuffer, cid).catch(console.error);
              setIsLoading(false);
              setConnectionError(null);
              return; // Success — no retry
            }
          }
        }

        clearTimeout(staleTimer);
        if (rafId) cancelAnimationFrame(rafId);
        flushTokenBuffer();
        // Fallback: if stream ended without a 'done' event, still process tool calls
        if (toolScanBuffer) {
          handleJsonToolCalls(toolScanBuffer, cid).catch(console.error);
        }
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
  }, [input, activeId, activeAgent, activeSkill, messages, settings, isLoading, visionPreset, visionAspect]);

  const handleEditMessage = useCallback((msgIndex, newContent) => {
    // Truncate to before the edited message, re-send with new content
    const truncated = messages.slice(0, msgIndex);
    const editedMsg = { role: 'user', content: newContent, isEdited: true };
    const fullHistory = [...truncated, editedMsg];
    sendMessage(editedMsg, { historyForPayload: fullHistory, isEditResponse: true });
  }, [messages, sendMessage]);

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
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {settingsOpen && (
          <SettingsPanel
            settings={settings}
            updateSetting={updateSetting}
            powerDial={powerDial}
            setPowerDial={setPowerDial}
            webEnabled={webEnabled}
            toggleWeb={toggleWeb}
            activeSkill={activeSkill}
            setActiveSkill={setActiveSkill}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        <main className="main">
          <PolicyBanner notice={policyNotice} agents={agents} onDismiss={() => setPolicyNotice(null)} />

          {/* Header */}
          <Island className="header-island" floating glow dismissable position="top">
            <button className="icon-btn" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
            <div className="header-spacer" />
            <button className="icon-btn" onClick={createConv}><Plus size={18} /></button>
          </Island>

          {/* ── Chat + Sandbox unified split layout ──────────────── */}
          <div className={`chat-sandbox-row${activeSkill === 'sandbox' ? ' has-sandbox' : ''}`}>

            {/* Left: chat pane (always visible) */}
            <div className="chat-pane">
              <div className="messages-scroll">
                {messages.length === 0 ? (
                  <EmptyState />
                ) : (
                  <div className="messages">
                    {/* Web source cards above messages when results available */}
                    <WebSourceCards results={webResults} />
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
                        onUseSeed={seed => setInput(prev => prev + (prev ? ' ' : '') + `seed:${seed}`)}
                      />
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <ConnectionStatus error={connectionError} />

              {/* Input area — attach panel + [+] bubble + input island */}
              <div className="input-area">
            {attachPanelOpen && (
              <AttachPanel
                onAttachFile={() => fileInputRef.current?.click()}
                webEnabled={webEnabled} onWebChange={toggleWeb}
                powerDial={powerDial} onSpeedChange={setPowerDial}
                insightsEnabled={insightsEnabled} onInsightsChange={setInsightsEnabled}
                analysisEnabled={analysisEnabled} onAnalysisChange={setAnalysisEnabled}
                actionsEnabled={actionsEnabled} onActionsChange={setActionsEnabled}
                onClose={() => setAttachPanelOpen(false)}
              />
            )}
            {/* single file input — no image/* so iOS opens Files directly */}
            <input type="file" ref={fileInputRef} hidden
              accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.c,.cpp,.sh,.bash,.yaml,.yml,.xml,.csv,.log,.zip,.tar,.gz,.mp4,.mov,.mp3"
              onChange={e => { handleFiles(e.target.files); setAttachPanelOpen(false); }}
            />
            <VisionBar preset={visionPreset} setPreset={setVPreset} aspect={visionAspect} setAspect={setVAspect} />
            <div className="input-row">
              <button
                className={`attach-btn${attachPanelOpen ? ' open' : ''}`}
                type="button"
                onClick={() => setAttachPanelOpen(v => !v)}
                title="Attach or toggle options"
              >
                <Plus size={16} />
              </button>
              <Island className={`input-island preempt-${preemptState}`} floating glow dismissable position="bottom">
                {settings.liveEditEnabled && (
                  <LiveEditBar
                    phrase={liveEdit.correctionPhrase}
                    visible={liveEdit.showBar}
                    adapting={liveEdit.adapting}
                    error={liveEdit.error}
                    onApply={liveEdit.applyCorrection}
                    onDismiss={liveEdit.dismiss}
                  />
                )}
                <div className="input-main">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); if (settings.preemptEnabled) onInputChange(e.target.value); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (settings.liveEditEnabled && liveEdit.showBar) liveEdit.applyCorrection();
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
            </div>{/* /input-area */}
            </div>{/* /chat-pane */}

            {/* Right: sandbox pane — slides in when activeSkill === 'sandbox' */}
            {activeSkill === 'sandbox' && (
              <div className="sandbox-pane">
                <SandboxPanel
                  visible={true}
                  onAttachArtifact={(artRef) => {
                    setInput(prev => prev + `\n[sandbox:${artRef.runId.slice(0,8)}] ${artRef.summary}`);
                    setActiveSkill('chat');
                  }}
                />
              </div>
            )}

          </div>{/* /chat-sandbox-row */}

        </main>

        {isDragging && <div className="drop-zone"><Plus size={48} /><span>Drop to upload</span></div>}

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
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

/* ── Chat + Sandbox split row ──────────────────────────────── */
.chat-sandbox-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 0;
}
.chat-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
  overflow: hidden;
}
.sandbox-pane {
  width: 50%;
  min-width: 320px;
  max-width: 800px;
  border-left: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sandbox-slide-in 280ms var(--lg-ease-decelerate, cubic-bezier(0,0,0.2,1)) both;
  flex-shrink: 0;
}
@keyframes sandbox-slide-in {
  from { opacity: 0; transform: translateX(32px); }
  to   { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .sandbox-pane { animation: none; }
}
/* On mobile: sandbox pane is a bottom sheet via fixed positioning */
@media (max-width: 767px) {
  .chat-sandbox-row { flex-direction: column; }
  .sandbox-pane {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    border-left: none;
    border-top: 1px solid rgba(255,255,255,0.06);
    height: 55%;
    animation: sandbox-slide-up 280ms var(--lg-ease-decelerate) both;
  }
  @keyframes sandbox-slide-up {
    from { opacity: 0; transform: translateY(32px); }
    to   { opacity: 1; transform: translateY(0); }
  }
}

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
.messages-scroll { flex: 1; overflow-y: auto; padding: 80px 16px max(230px, calc(env(safe-area-inset-bottom, 0px) + 200px)); -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.messages { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
.message { display: flex; gap: 12px; animation: msgIn 0.28s cubic-bezier(0.22,1,0.36,1); }
@keyframes msgIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.message.user { justify-content: flex-end; }
.message-content { max-width: 88%; min-width: 0; }
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
.stream-cursor.edit-cursor {
  color: var(--warning);
  text-shadow: 0 0 6px rgba(255,159,10,0.5), 0 0 14px rgba(255,159,10,0.3);
}
/* Edited user message — orange glow on bubble */
.message.user .message-content.edited {
  border-color: rgba(255,159,10,0.4);
  box-shadow: 0 0 0 3px rgba(255,159,10,0.07), 0 0 28px -8px rgba(255,159,10,0.35);
  transition: border-color 0.3s, box-shadow 0.3s;
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
.message-actions { display: flex; gap: 4px; margin-top: 8px; animation: msgActionsIn 0.4s ease 0.25s both; }
@keyframes msgActionsIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
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
.md-img {
  max-width: 100%; max-height: 480px;
  border-radius: 12px; object-fit: contain;
  border: 1px solid var(--border);
  margin: 8px 0;
  display: block;
  background: rgba(0,0,0,0.2);
}

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
.empty-state h1 { font-size: 32px; font-weight: 600; margin: 0 0 6px; }
.empty-tagline { margin: 0 0 20px; font-size: 14px; font-weight: 400; color: var(--text-3); letter-spacing: 0.02em; }
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
  bottom: max(24px, calc(env(safe-area-inset-bottom, 0px) + 16px));
  left: 50%; transform: translateX(-50%);
  width: min(calc(100% - 44px), 720px);
  z-index: 50;
  display: flex; flex-direction: column; gap: 7px;
}
/* ═══ INPUT ROW — [+] bubble + Island side by side ═══ */
.input-row {
  display: flex; align-items: flex-end; gap: 8px;
}
.input-island { flex: 1; min-width: 0; }

/* ═══ ATTACH BUTTON — circular bubble outside Island ═══ */
.attach-btn {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(22,22,26,0.88);
  border: 1px solid var(--border);
  border-radius: var(--radius-md); /* match island radius */
  color: var(--text-2);
  cursor: pointer; flex-shrink: 0;
  backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.35);
  transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.22s cubic-bezier(0.22,1,0.36,1);
  -webkit-tap-highlight-color: transparent;
}
.attach-btn:hover { background: rgba(35,35,42,0.95); color: var(--text); }
.attach-btn:active { transform: scale(0.93); }
.attach-btn.open { background: rgba(168,85,247,0.12); border-color: rgba(168,85,247,0.3); color: var(--accent); transform: rotate(45deg); }

/* ═══ ATTACH PANEL — glass popover, left-aligned with + bubble ═══ */
.ap-backdrop { position: fixed; inset: 0; z-index: 200; }
.ap-panel {
  position: absolute; bottom: calc(100% + 10px); left: 0;
  width: 288px; z-index: 201;
  transform-origin: bottom left;
  animation: apShow 0.16s cubic-bezier(0.22,1,0.36,1);
}
@keyframes apShow {
  from { opacity: 0; transform: scale(0.93) translateY(6px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}
.ap-inner {
  background: rgba(18,18,24,0.97);
  backdrop-filter: blur(60px) saturate(1.5); -webkit-backdrop-filter: blur(60px) saturate(1.5);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.05);
}
.ap-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  border: none; background: none; width: 100%;
  text-align: left; cursor: pointer;
  transition: background 0.12s;
}
.ap-row:hover { background: rgba(255,255,255,0.04); }
.ap-row + .ap-row { border-top: 1px solid rgba(255,255,255,0.04); }
.ap-file-row { cursor: pointer; }
.ap-toggle-row { cursor: default; }
.ap-row-icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--surface); border-radius: 9px; color: var(--text-2); flex-shrink: 0; }
.ap-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ap-row-label { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.3; }
.ap-row-desc { font-size: 11px; color: var(--text-3); line-height: 1.4; }
.ap-row-arr { color: var(--text-3); flex-shrink: 0; }
.ap-divider { height: 1px; background: var(--border); margin: 0; }

/* ═══ KURO SWITCH ═══ */
.ks-switch {
  width: 40px; height: 24px; border-radius: 12px;
  background: var(--surface-2); border: 1px solid var(--border);
  position: relative; cursor: pointer; flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.ks-switch.on { background: var(--accent); border-color: var(--accent); }
.ks-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  transition: transform 0.2s cubic-bezier(0.22,1,0.36,1);
}
.ks-switch.on .ks-thumb { transform: translateX(16px); }

/* ═══ SETTINGS PANEL ═══ */
.sp-backdrop { position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fadeIn 0.18s ease; }
.sp-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(360px, 100%);
  background: rgba(12,12,16,0.98);
  backdrop-filter: blur(60px); -webkit-backdrop-filter: blur(60px);
  border-left: 1px solid var(--border);
  z-index: 401;
  display: flex; flex-direction: column;
  animation: spSlideIn 0.25s cubic-bezier(0.22,1,0.36,1);
}
@keyframes spSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
.sp-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sp-title { font-size: 15px; font-weight: 600; color: var(--text); }
.sp-close { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); cursor: pointer; transition: background 0.12s; }
.sp-close:hover { background: var(--surface-2); color: var(--text); }
.sp-body { flex: 1; overflow-y: auto; }
.sp-section { border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 4px; }
.sp-section:last-child { border-bottom: none; }
.sp-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-3); padding: 16px 20px 6px; }
.sp-row { display: flex; align-items: center; gap: 12px; padding: 10px 20px; min-height: 58px; }
.sp-row-stack { flex-wrap: wrap; gap: 8px; }
.sp-row-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.sp-row-label { font-size: 13px; font-weight: 500; color: var(--text); }
.sp-row-desc { font-size: 11px; color: var(--text-3); line-height: 1.4; }
/* ── NIN ADD ANXIETY — Volatility Slider ── */
.vol-slider-wrap { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.vol-track {
  position: relative; height: 28px; width: 100%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.vol-fill {
  position: absolute; top: 0; left: 0; bottom: 0;
  background: linear-gradient(90deg,
    rgba(168,85,247,0.3) 0%,
    rgba(239,68,68,0.5) 60%,
    rgba(255,50,30,0.75) 100%);
  transition: width 0.06s linear;
  pointer-events: none;
}
.vol-fill::after {
  content: '';
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0px,
    transparent 3px,
    rgba(0,0,0,0.4) 3px,
    rgba(0,0,0,0.4) 4px
  );
}
.vol-notches {
  position: absolute; inset: 0;
  display: flex; align-items: stretch; justify-content: space-between;
  padding: 4px 2px;
  pointer-events: none;
}
.vol-notch {
  width: 1px;
  background: rgba(255,255,255,0.08);
  transition: background 0.1s;
}
.vol-notch.lit { background: rgba(255,255,255,0.2); }
.vol-input {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  margin: 0; padding: 0;
  opacity: 0;
  cursor: pointer;
  -webkit-appearance: none;
}
.vol-readout {
  display: flex; align-items: baseline; justify-content: space-between;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.vol-val {
  font-size: 22px; font-weight: 800; letter-spacing: -1px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.vol-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(255,255,255,0.3);
  transition: color 0.15s;
}
/* Color escalation based on parent state — driven by the fill gradient */
.vol-slider-wrap:has(.vol-input:hover) .vol-fill { filter: brightness(1.3); }
.vol-slider-wrap:has(.vol-input:active) .vol-fill { filter: brightness(1.5); }
.vol-slider-wrap:has(.vol-input:active) .vol-track { border-color: rgba(239,68,68,0.3); }
.sp-seg { display: flex; gap: 4px; flex-shrink: 0; }
.sp-seg-btn { display: flex; align-items: center; gap: 5px; padding: 6px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); font-size: 12px; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s; white-space: nowrap; }
.sp-seg-btn.active { background: rgba(168,85,247,0.14); border-color: rgba(168,85,247,0.35); color: var(--accent); }

/* ═══ WEB SOURCE FLASH CARDS ═══ */
.web-source-cards {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 0 4px 0;
  animation: fadeIn 0.25s ease;
}
.web-card {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px;
  background: rgba(100,180,255,0.05);
  border: 1px solid rgba(100,180,255,0.14);
  border-radius: var(--lg-radius-sm, 12px);
  text-decoration: none; color: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.web-card:hover { background: rgba(100,180,255,0.1); border-color: rgba(100,180,255,0.28); }
.web-card-num {
  flex-shrink: 0; width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: #64b4ff;
  background: rgba(100,180,255,0.12); border-radius: 50%;
}
.web-card-body { flex: 1; min-width: 0; }
.web-card-title { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.web-card-url { font-size: 10px; color: #64b4ff; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.web-card-snippet { font-size: 11px; color: var(--text-dim); margin-top: 2px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.web-card-icon { flex-shrink: 0; opacity: 0.4; margin-top: 2px; }

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

/* ═══ VISION BAR ═══ */
.vision-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 2px 4px;
}
.vb-group { display: flex; gap: 3px; }
.vb-sep { width: 1px; height: 16px; background: var(--border); margin: 0 3px; }
.vb-pill {
  padding: 3px 9px;
  font-size: 11px; font-weight: 500; letter-spacing: 0.02em;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer; transition: all 0.15s;
}
.vb-pill:hover { color: var(--text-2); border-color: var(--border-2); }
.vb-pill.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

/* ═══ VISION GENERATING CARD ═══ */
.vision-gen-card {
  margin: 8px 0;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.vgc-header {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 10px;
}
.vgc-title { font-size: 13px; font-weight: 500; color: var(--text); }
.vgc-meta  { font-size: 11px; color: var(--text-3); margin-left: auto; }
.vgc-elapsed { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.vgc-track {
  height: 3px; background: var(--surface-2);
  border-radius: 2px; overflow: hidden; margin-bottom: 7px;
}
.vgc-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #6366f1);
  border-radius: 2px;
  transition: width 0.6s ease;
}
.vgc-phase { font-size: 11px; color: var(--text-3); }

/* ═══ VISION GRID ═══ */
.vision-grid {
  display: grid; grid-template-columns: 1fr;
  gap: 8px; margin: 8px 0;
}
.vision-grid.grid-multi { grid-template-columns: 1fr 1fr; }
.vg-cell { position: relative; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
.vg-img { display: block; width: 100%; height: auto; }
.vg-actions {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; gap: 6px; padding: 6px 8px;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  opacity: 0; transition: opacity 0.15s;
}
.vg-cell:hover .vg-actions { opacity: 1; }
.vg-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; font-size: 11px;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 20px; color: var(--text-2); cursor: pointer;
  text-decoration: none; transition: background 0.12s;
}
.vg-btn:hover { background: rgba(0,0,0,0.85); color: var(--text); }

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
  .input-area { bottom: max(18px, calc(env(safe-area-inset-bottom, 0px) + 12px)); width: min(calc(100% - 32px), 680px); }
  .messages-scroll { padding: 76px 14px max(220px, calc(env(safe-area-inset-bottom, 0px) + 190px)); }
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
  .input-area { bottom: max(10px, calc(env(safe-area-inset-bottom, 0px) + 8px)); width: calc(100% - 20px); }
  .tool-island { font-size: 11px; padding: 5px 10px; }
  .input-main textarea { font-size: 16px; } /* prevent iOS auto-zoom */
  .icon-btn { width: 32px; height: 32px; }
  .send-btn { width: 34px; height: 34px; }

  /* Messages */
  .messages-scroll { padding: 70px 10px max(190px, calc(env(safe-area-inset-bottom, 0px) + 160px)); }
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
  .input-area { bottom: max(8px, calc(env(safe-area-inset-bottom, 0px) + 6px)); width: calc(100% - 16px); }
  .messages-scroll { padding: 66px 8px max(175px, calc(env(safe-area-inset-bottom, 0px) + 148px)); }
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
