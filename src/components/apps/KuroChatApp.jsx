/**
 * KURO CHAT v8.0 — Clean Architecture
 *
 * Design principles:
 *   - Apple HIG: floating islands, no toolbars, contextual surfaces
 *   - KURO touch: 3D cube, typing animation, purple accent, glass
 *   - Minimal: only what's needed for a great chat experience
 *   - Fast: rAF-batched token rendering, stagger animations
 *
 * Simplified from v7.2 (3217 lines → ~1400 lines):
 *   - Removed: sidebar skills, agent selector, scope indicator, profile/audit badges,
 *     settings panel, vision bar, attach panel toggles, policy banner, web source cards,
 *     speed island, live edit bar, sandbox split pane
 *   - Kept: SSE streaming, terminal reveal, markdown, thinking blocks, file attach,
 *     conversation history, keyboard shortcuts, cube logo, typing animation
 *   - Added: flash card suggestions, animated loading steps, conversation sheet
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo, memo,
} from 'react';
import {
  Plus, X, MessageSquare, Copy, Check, ArrowUp, Square, Menu,
  Brain, ChevronDown, Edit3, Folder, Paperclip, Trash2, Search,
} from 'lucide-react';
import KuroCubeSpinner from '../ui/KuroCubeSpinner';
import { renderKuroText, isEmojiOnly } from '../ui/KuroEmoji';
import { useLiveEdit, LiveEditBar } from './LiveEdit';
import usePreempt from '../../hooks/usePreempt';


/* ═══════════════════════════════════════════════════════════════════════════
   AUTH — token on every request
═══════════════════════════════════════════════════════════════════════════ */
function getToken() {
  return localStorage.getItem('kuro_token') || '';
}
function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-KURO-Token': getToken(), ...extra };
}
function authFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: authHeaders(opts.headers || {}) });
}


/* ═══════════════════════════════════════════════════════════════════════════
   CYCLING PLACEHOLDER — human-like typing in textarea
═══════════════════════════════════════════════════════════════════════════ */
const TYPING_PROMPTS = [
  "What should I build today\u2026",
  "Explain how this works\u2026",
  "Help me debug this issue\u2026",
  "Write me something beautiful\u2026",
  "Research this topic deeply\u2026",
  "Analyze this data set\u2026",
];

function useCyclingPlaceholder(active) {
  const [display, setDisplay] = useState('');
  useEffect(() => {
    if (!active) { setDisplay(''); return; }
    const r = (lo, hi) => lo + Math.random() * (hi - lo);
    let idx = 0, chars = 0, phase = 'typing', blinkTicks = 0, eraseCount = 0, slowErases = 0, timer;
    function tick() {
      const phrase = TYPING_PROMPTS[idx];
      if (phase === 'typing') {
        chars++;
        setDisplay(phrase.slice(0, chars));
        if (chars >= phrase.length) { phase = 'wait'; blinkTicks = 0; timer = setTimeout(tick, r(1200, 2200)); }
        else { const ch = phrase[chars - 1]; timer = setTimeout(tick, (ch === ' ' || ch === ',') ? r(80, 160) : Math.random() < 0.07 ? r(160, 280) : r(42, 100)); }
      } else if (phase === 'wait') {
        blinkTicks++;
        if (blinkTicks >= 4) { phase = 'erasing'; eraseCount = 0; slowErases = 2 + Math.floor(Math.random() * 2); timer = setTimeout(tick, r(300, 700)); }
        else timer = setTimeout(tick, 420);
      } else {
        chars--;
        eraseCount++;
        if (chars <= 0) { chars = 0; setDisplay(''); idx = (idx + 1) % TYPING_PROMPTS.length; phase = 'typing'; timer = setTimeout(tick, r(400, 700)); }
        else { setDisplay(phrase.slice(0, chars)); timer = setTimeout(tick, eraseCount <= slowErases ? r(100, 160) : r(25, 50)); }
      }
    }
    timer = setTimeout(tick, 800);
    return () => clearTimeout(timer);
  }, [active]);
  return active ? display : '';
}


/* useTerminalReveal removed — tokens now render instantly (ChatGPT-style) */


/* ═══════════════════════════════════════════════════════════════════════════
   MARKDOWN RENDERER — lightweight inline parser
═══════════════════════════════════════════════════════════════════════════ */
const CodeBlock = memo(({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(code);
    navigator.vibrate?.([3,50,3]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <pre className="k8-codeblock" data-lang={lang}>
      <span className="k8-lang">
        <span>{lang || 'code'}</span>
        <button className="k8-code-copy" onClick={doCopy} title="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </span>
      <code>{code}</code>
    </pre>
  );
});

const MarkdownText = memo(({ text }) => {
  if (!text) return null;
  const elements = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  let key = 0;
  for (const part of parts) {
    if (part.startsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang = match?.[1] || '';
      const code = match?.[2] || part.slice(3, -3);
      elements.push(<CodeBlock key={key++} lang={lang} code={code.replace(/\n$/, '')} />);
    } else {
      const lines = part.split('\n');
      const lineEls = [];
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
        if (imgMatch) { lineEls.push(<img key={key++} src={imgMatch[2]} alt={imgMatch[1]} className="k8-img" loading="lazy" />); continue; }
        const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (hMatch) { lineEls.push(React.createElement(`h${hMatch[1].length + 2}`, { key: key++, className: 'k8-h' }, hMatch[2])); continue; }
        if (/^[-*]\s+/.test(line)) { lineEls.push(<li key={key++} className="k8-li">{renderInline(line.replace(/^[-*]\s+/, ''))}</li>); continue; }
        const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) { lineEls.push(<li key={key++} className="k8-li k8-ol" value={olMatch[1]}>{renderInline(olMatch[2])}</li>); continue; }
        if (!line.trim()) { lineEls.push(<br key={key++} />); continue; }
        lineEls.push(<span key={key++} className="k8-line">{renderInline(line)}</span>);
        if (i < lines.length - 1 && lines[i + 1]?.trim()) lineEls.push(<br key={key++} />);
      }
      elements.push(<React.Fragment key={key++}>{lineEls}</React.Fragment>);
    }
  }
  return <>{elements}</>;
});

function renderInline(text) {
  const parts = [];
  const rx = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIdx = 0, m, key = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(...emojiWrap(text.slice(lastIdx, m.index), key)); key += 10;
    const tok = m[0];
    if (tok.startsWith('`')) parts.push(<code key={key++} className="k8-ic">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (m[2] && m[3]) parts.push(<a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer" className="k8-link">{m[2]}</a>);
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) parts.push(...emojiWrap(text.slice(lastIdx), key));
  return parts.length ? parts : text;
}

/** Wrap plain text segment, replacing emoji chars with KuroEmoji components */
function emojiWrap(str, keyBase = 0) {
  const rendered = renderKuroText(str, 18, true);
  if (typeof rendered === 'string') return [rendered];
  if (Array.isArray(rendered)) return rendered;
  return [rendered];
}


/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT PARSER — extracts think blocks + artifacts
═══════════════════════════════════════════════════════════════════════════ */
function parseContent(content) {
  const result = { think: '', main: content || '', thinkStreaming: false };
  const thinkMatch = content?.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) { result.think = thinkMatch[1]; result.main = content.replace(thinkMatch[0], ''); }
  const openThink = content?.lastIndexOf('<think>');
  if (openThink !== -1 && content?.indexOf('</think>', openThink) === -1) {
    result.think = content.slice(openThink + 7);
    result.main = content.slice(0, openThink);
    result.thinkStreaming = true;
  }
  result.main = result.main.trim();
  return result;
}


/* ═══════════════════════════════════════════════════════════════════════════
   JSON TOOL CALL EXTRACTOR
═══════════════════════════════════════════════════════════════════════════ */
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
      if (ch === '}') { depth--; if (depth === 0) { try { const raw = stripped.slice(idx, i + 1); const parsed = JSON.parse(raw); if (parsed.kuro_tool_call) calls.push({ raw, parsed }); } catch {} break; } }
    }
    pos = idx + 1;
  }
  return calls;
}


/* ═══════════════════════════════════════════════════════════════════════════
   THINK LABEL — classify raw thinking sentences into short summaries
═══════════════════════════════════════════════════════════════════════════ */
function thinkToLabel(raw) {
  const t = (raw || '').toLowerCase();
  const rules = [
    [/\b(understand|clarif|interpret|what .+ (ask|want|mean))\b/, 'Understanding the request'],
    [/\b(plan|approach|strateg|steps|method)\b/, 'Planning approach'],
    [/\b(analy[zs]|examin|review|inspect|assess)\b/, 'Analyzing'],
    [/\b(consider|weigh|evaluat|think about|ponder)\b/, 'Considering options'],
    [/\b(compar|differ|versus|vs|trade.?off|pros|cons)\b/, 'Comparing alternatives'],
    [/\b(code|function|implement|class|module|component|build|program)\b/, 'Working on code'],
    [/\b(debug|bug|error|fix|issue|trace|stack)\b/, 'Debugging'],
    [/\b(search|find|look for|retriev|fetch)\b/, 'Searching'],
    [/\b(format|structure|organiz|layout|arrang)\b/, 'Structuring response'],
    [/\b(math|calcul|comput|equat|formula|numer)\b/, 'Computing'],
    [/\b(explain|describ|break down|elaborate)\b/, 'Formulating explanation'],
    [/\b(summar|conclud|final|wrap|tldr)\b/, 'Summarizing'],
    [/\b(secur|encrypt|auth|permission|access)\b/, 'Checking security'],
    [/\b(optimi[zs]|perform|speed|efficien|fast)\b/, 'Optimizing'],
    [/\b(test|verif|valid|assert|check)\b/, 'Verifying'],
    [/\b(creativ|write|draft|compose|generat)\b/, 'Drafting content'],
    [/\b(research|learn|study|investigat)\b/, 'Researching'],
    [/\b(remember|recall|context|previous|history)\b/, 'Recalling context'],
    [/\b(user|request|question|prompt|input)\b/, 'Processing request'],
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  // Fallback: clean truncation of the sentence
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > 45 ? clean.slice(0, 42) + '\u2026' : clean;
}


/* ═══════════════════════════════════════════════════════════════════════════
   ISLAND — floating glass container
═══════════════════════════════════════════════════════════════════════════ */
const Island = ({ children, className = '', glow = false }) => (
  <div className={`k8-island ${glow ? 'glow' : ''} ${className}`}>{children}</div>
);


/* ═══════════════════════════════════════════════════════════════════════════
   THINKING DROPDOWN — collapsible steps with staggered flash-in
═══════════════════════════════════════════════════════════════════════════ */
const ThinkingDropdown = memo(({ steps, status, isStreaming, hasContent }) => {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(false);
  const startRef = useRef(Date.now());
  const finalElapsed = useRef(0);

  // Start timer when streaming begins
  useEffect(() => {
    if (!isStreaming) return;
    startRef.current = Date.now();
    setExpanded(true);
    setVisible(true);
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000);
      setElapsed(s);
      finalElapsed.current = s;
    }, 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Auto-collapse when content starts flowing (tokens arrived)
  useEffect(() => {
    if (isStreaming && hasContent) {
      const t = setTimeout(() => setExpanded(false), 300);
      return () => clearTimeout(t);
    }
  }, [isStreaming, hasContent]);

  // Fade out when streaming ends and no think points
  useEffect(() => {
    if (!isStreaming) {
      if (steps?.length) {
        setExpanded(false); // collapse to header
      } else {
        const t = setTimeout(() => setVisible(false), 400);
        return () => clearTimeout(t);
      }
    }
  }, [isStreaming]);

  if (!visible && (!steps || !steps.length)) return null;
  const displaySteps = steps || [];
  const showTime = isStreaming ? elapsed : finalElapsed.current;
  const hasThinkPoints = displaySteps.length > 0;
  const waiting = isStreaming && !hasContent; // pre-token phase

  return (
    <div className={`k8-think-drop ${expanded ? 'expanded' : ''} ${isStreaming ? 'streaming' : 'done'} ${!visible && !hasThinkPoints ? 'fading' : ''}`}>
      <button className="k8-think-drop-header" onClick={() => hasThinkPoints && setExpanded(!expanded)}>
        {waiting ? (
          <span className="k8-think-drop-dots">
            <span /><span /><span />
          </span>
        ) : isStreaming ? (
          <span className="k8-think-drop-dots settled">
            <span /><span /><span />
          </span>
        ) : (
          <Brain size={14} className="k8-think-drop-icon" />
        )}
        <span className="k8-think-drop-label">
          {waiting
            ? (hasThinkPoints ? 'Thinking' : (status || 'Connecting\u2026'))
            : isStreaming
              ? (hasThinkPoints ? 'Thinking' : 'Generating')
              : (hasThinkPoints ? `Thought for ${showTime}s` : `${showTime}s`)}
        </span>
        {showTime > 0 && isStreaming && (
          <span className="k8-think-drop-time">{showTime}s</span>
        )}
        {hasThinkPoints && <ChevronDown size={14} className={`k8-chev ${expanded ? 'open' : ''}`} />}
      </button>
      {expanded && hasThinkPoints && (
        <div className="k8-think-drop-body">
          {displaySteps.map((step, i) => (
            <div key={step.id || i} className="k8-think-step" style={{ animationDelay: `${Math.min(i * 60, 500)}ms` }}>
              <span className="k8-think-step-bullet" />
              <span className="k8-think-step-text">{step.text}</span>
              {i === displaySteps.length - 1 && isStreaming && !hasContent && (
                <span className="k8-think-step-ping" />
              )}
            </div>
          ))}
        </div>
      )}
      {elapsed > 15 && isStreaming && !hasContent && (
        <div className="k8-think-drop-hint">Model is loading\u2026</div>
      )}
    </div>
  );
});


/* ═══════════════════════════════════════════════════════════════════════════
   THOUGHT BLOCK — expandable chain-of-thought
═══════════════════════════════════════════════════════════════════════════ */
const ThoughtBlock = memo(({ content, isStreaming }) => {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (isStreaming) setExpanded(true); }, [isStreaming]);
  if (!content && !isStreaming) return null;
  const preview = (content || '').split('\n').filter(l => l.trim()).slice(0, 2).map(l => l.slice(0, 50)).join(' \u2022 ');
  return (
    <div className={`k8-thought ${expanded ? 'expanded' : ''}`}>
      <button className="k8-thought-toggle" onClick={() => setExpanded(!expanded)}>
        {isStreaming ? <KuroCubeSpinner size="xs" /> : <Brain size={14} />}
        <span className="k8-thought-label">Thinking</span>
        {!expanded && <span className="k8-thought-preview">{preview}</span>}
        <ChevronDown size={14} className={`k8-chev ${expanded ? 'open' : ''}`} />
      </button>
      {expanded && <div className="k8-thought-body"><pre>{content}</pre></div>}
    </div>
  );
});


/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE
═══════════════════════════════════════════════════════════════════════════ */
const Message = memo(({ msg, msgIndex, isStreaming, onCopy, onEdit, staggerDelay, onLongPress, isLastInGroup, isFirstInGroup }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);
  const editRef = useRef(null);
  const parsed = parseContent(msg.content);

  const startEdit = () => { setEditValue(msg.content); setEditing(true); setTimeout(() => editRef.current?.focus(), 30); };
  const saveEdit = () => { const t = editValue.trim(); if (t && t !== msg.content) onEdit(msgIndex, t); setEditing(false); };
  const doCopy = () => { navigator.vibrate?.([3,50,3]); onCopy(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  // Long-press handling
  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);
  const handleTouchStart = useCallback((e) => {
    longPressTriggered.current = false;
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      navigator.vibrate?.([10]);
      onLongPress?.(msgIndex, touch.clientX, touch.clientY);
    }, 500);
  }, [msgIndex, onLongPress]);
  const handleTouchEnd = useCallback(() => { clearTimeout(longPressTimer.current); }, []);
  const handleTouchMove = useCallback(() => { clearTimeout(longPressTimer.current); }, []);

  return (
    <div className={`k8-msg ${msg.role}${isLastInGroup ? ' tail' : ''}${isFirstInGroup ? ' group-first' : ''}`} style={staggerDelay ? { '--msg-stagger': staggerDelay } : undefined}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchMove={handleTouchMove}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.(msgIndex, e.clientX, e.clientY); }}>
      <div className="k8-msg-inner">
        {/* Thinking dropdown — summarised think points, collapses after */}
        {msg.role === 'assistant' && (isStreaming || msg.meta?.steps?.length > 0) && (
          <ThinkingDropdown steps={msg.meta?.steps} status={msg.meta?.status} isStreaming={isStreaming} hasContent={!!parsed.main} />
        )}
        {/* Think block */}
        {msg.role === 'assistant' && parsed.think && (
          <ThoughtBlock content={parsed.think} isStreaming={parsed.thinkStreaming} />
        )}
        {/* Image thumbnails */}
        {msg.role === 'user' && msg.images?.length > 0 && (
          <div className="k8-images">{msg.images.map((b64, i) => <img key={i} src={`data:image/jpeg;base64,${b64}`} className="k8-thumb" alt="" />)}</div>
        )}
        {/* Message text */}
        {editing ? (
          <div className="k8-edit-wrap">
            <textarea ref={editRef} className="k8-edit-area" value={editValue} onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }} rows={3} />
            <div className="k8-edit-actions">
              <button className="k8-edit-save" onClick={saveEdit}>Save & Resend</button>
              <button className="k8-edit-cancel" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={`k8-msg-text${isStreaming ? ' streaming' : ''}${isEmojiOnly(parsed.main) ? ' emoji-only' : ''}`}>
            {msg.role === 'assistant'
              ? <MarkdownText text={parsed.main} />
              : renderKuroText(msg.images?.length > 0 ? parsed.main.replace(/^\[Image:[^\]]+\]\n?/gm, '').trim() : parsed.main, isEmojiOnly(parsed.main) ? 40 : 18, true)
            }
            {isStreaming && !parsed.thinkStreaming && <span className="k8-cursor" />}
          </div>
        )}
        {/* Actions */}
        {!isStreaming && !editing && msg.content && (
          <div className="k8-msg-actions">
            <button onClick={doCopy} title="Copy">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
            {msg.role === 'user' && <button onClick={startEdit} title="Edit"><Edit3 size={13} /></button>}
          </div>
        )}
      </div>
    </div>
  );
});


/* ═══════════════════════════════════════════════════════════════════════════
   KURO CUBE — 3D rotating logo
═══════════════════════════════════════════════════════════════════════════ */
const KuroCube = () => (
  <div className="k8-cube-wrap">
    <div className="k8-cube">
      <div className="k8-face k8-ft" /><div className="k8-face k8-bk" />
      <div className="k8-face k8-rt" /><div className="k8-face k8-lt" />
      <div className="k8-face k8-tp" /><div className="k8-face k8-bt" />
    </div>
  </div>
);


/* ═══════════════════════════════════════════════════════════════════════════
   FLASH CARDS — tappable suggestion prompts
═══════════════════════════════════════════════════════════════════════════ */
const FLASH_CARDS = [
  { label: 'Explain this codebase', icon: '{}', prompt: 'Explain this codebase architecture — what are the main components, how do they connect, and what patterns are used?' },
  { label: 'Write me something', icon: '\u270E', prompt: 'Help me write a compelling piece of content. I\'ll describe what I need.' },
  { label: 'Debug an issue', icon: '\u26A0', prompt: 'I have a bug I need help debugging. Let me describe the symptoms.' },
  { label: 'Research a topic', icon: '\u2315', prompt: 'Help me research and deeply understand a topic. I want comprehensive coverage.' },
];


/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE — cube + typing animation + flash cards
═══════════════════════════════════════════════════════════════════════════ */
const EmptyState = ({ onFlashCard, typingText }) => (
  <div className="k8-empty">
    <KuroCube />
    <h1 className="k8-brand">KURO</h1>
    <div className="k8-typing-line">
      <span className="k8-typing-text">{typingText}</span>
      <span className="k8-typing-cursor" />
    </div>
    <div className="k8-flash-grid">
      {FLASH_CARDS.map((card, i) => (
        <button key={i} className="k8-flash" onClick={() => { navigator.vibrate?.([3]); onFlashCard(card.prompt); }} style={{ animationDelay: `${i * 80}ms` }}>
          <span className="k8-flash-icon">{card.icon}</span>
          <span className="k8-flash-label">{card.label}</span>
        </button>
      ))}
    </div>
  </div>
);


/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATION SHEET — glass overlay for history
═══════════════════════════════════════════════════════════════════════════ */
const ConversationSheet = ({ open, conversations, activeId, onSelect, onCreate, onDelete, onClose }) => {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setVisible(true); setClosing(false); }
    else if (visible) { setClosing(true); const t = setTimeout(() => { setVisible(false); setClosing(false); }, 200); return () => clearTimeout(t); }
  }, [open]);
  if (!visible) return null;
  const handleClose = () => { setClosing(true); setTimeout(() => { setVisible(false); setClosing(false); onClose(); }, 200); };
  return (
    <>
      <div className={`k8-sheet-backdrop ${closing ? 'closing' : ''}`} onClick={handleClose} />
      <div className={`k8-sheet ${closing ? 'closing' : ''}`}>
        <div className="k8-sheet-header">
          <span className="k8-sheet-title">Conversations</span>
          <button className="k8-sheet-close" onClick={handleClose}><X size={16} /></button>
        </div>
        <button className="k8-sheet-new" onClick={() => { onCreate(); handleClose(); }}>
          <Plus size={16} /><span>New conversation</span>
        </button>
        <div className="k8-sheet-list">
          {conversations.map(c => (
            <button key={c.id} className={`k8-sheet-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => { onSelect(c.id); handleClose(); }}>
              <MessageSquare size={14} />
              <span className="k8-sheet-item-title">{c.title || 'New chat'}</span>
              <button className="k8-sheet-item-del" onClick={e => { e.stopPropagation(); onDelete(c.id); }}>
                <Trash2 size={12} />
              </button>
            </button>
          ))}
        </div>
      </div>
    </>
  );
};


/* ═══════════════════════════════════════════════════════════════════════════
   DATE SEPARATOR LABEL
═══════════════════════════════════════════════════════════════════════════ */
function formatDateLabel(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (today - target) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function KuroChat() {
  // Conversations — in-memory messages, index in localStorage
  const [conversations, setConversations] = useState(() => {
    const id = String(Date.now());
    return [{ id, title: '', messages: [], projectId: null }];
  });
  const [activeId, setActiveId] = useState(() => String(Date.now()));

  // UI state
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sendSpring, setSendSpring] = useState(false);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [msgContextMenu, setMsgContextMenu] = useState(null);
  const scrollRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  // Settings (sensible defaults, no settings panel)
  const [powerDial] = useState('sovereign');

  // Server-driven config (fetched on mount)
  const [activeAgent] = useState('insights');

  // Refs
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const isLoadingRef = useRef(false);

  // Keep ref in sync for closure access
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Derived state
  const activeConv = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeConv?.messages || [];

  // ── Preempt hook ───────────────────────────────────────────────────
  const { onInputChange: onPreemptInput, getPreemptSession, abortPreempt, preemptState } = usePreempt(activeId, powerDial, getToken());

  const typingText = useCyclingPlaceholder(messages.length === 0 && !input);

  // Persist conversation index
  useEffect(() => {
    const index = conversations.map(c => ({ id: c.id, title: c.title, projectId: c.projectId }));
    try { localStorage.setItem('kuro_convindex_v72', JSON.stringify(index)); } catch {}
  }, [conversations]);

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  // Track message count for stagger animation (only new messages get stagger)
  useEffect(() => { prevMsgCountRef.current = messages.length; }, [messages.length]);

  // Scroll position tracking for FAB
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollFab(distFromBottom > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-driven bounce: IntersectionObserver reveals messages with spring animation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !e.target.classList.contains('k8-revealed')) {
          e.target.classList.add('k8-reveal', 'k8-revealed');
          io.unobserve(e.target);
        }
      });
    }, { root: el, threshold: 0.15, rootMargin: '0px 0px -30px 0px' });
    // Observe existing + future messages via MutationObserver
    const observe = () => {
      el.querySelectorAll('.k8-msg:not(.k8-revealed)').forEach(m => io.observe(m));
    };
    observe();
    const mo = new MutationObserver(observe);
    mo.observe(el, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [activeId]);

  // Toast helper
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // Textarea auto-resize
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }, [input]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSheetOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); createConv(); }
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Drag & drop
  useEffect(() => {
    const onDrag = (e) => { e.preventDefault(); setIsDragging(e.type !== 'dragleave'); };
    const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); };
    window.addEventListener('dragenter', onDrag);
    window.addEventListener('dragover', onDrag);
    window.addEventListener('dragleave', onDrag);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragenter', onDrag); window.removeEventListener('dragover', onDrag); window.removeEventListener('dragleave', onDrag); window.removeEventListener('drop', onDrop); };
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────
  const updateMessages = useCallback((cid, fn) => {
    setConversations(prev => prev.map(c =>
      c.id === cid ? { ...c, messages: typeof fn === 'function' ? fn(c.messages) : fn } : c
    ));
  }, []);

  const createConv = useCallback(() => {
    const n = { id: String(Date.now()), title: '', messages: [], projectId: null };
    setConversations(prev => [n, ...prev]);
    setActiveId(n.id);
    setSheetOpen(false);
  }, []);

  const deleteConv = useCallback((id) => {
    setConversations(prev => {
      const f = prev.filter(c => c.id !== id);
      if (!f.length) { const n = { id: String(Date.now()), title: '', messages: [], projectId: null }; setActiveId(n.id); return [n]; }
      if (id === activeId) setActiveId(f[0].id);
      return f;
    });
  }, [activeId]);

  const handleFiles = useCallback((files) => {
    if (!files?.length) return;
    const file = files[0];
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|py|css|html|csv|sh|yaml|yml)$/i.test(file.name);
    if (!isImage && !isText) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = isImage ? `[Image: ${file.name}]` : `[File: ${file.name}]\n\`\`\`\n${e.target.result}\n\`\`\``;
      const msg = { role: 'user', content, images: isImage ? [e.target.result.split(',')[1]] : undefined };
      updateMessages(activeId, prev => [...prev, msg]);
      if (isImage) sendMessage(msg);
    };
    isImage ? reader.readAsDataURL(file) : reader.readAsText(file);
  }, [activeId]);


  /* ═══════════════════════════════════════════════════════════════════════
     SEND MESSAGE — SSE streaming with rAF-batched token rendering
  ═══════════════════════════════════════════════════════════════════════ */
  const sendMessage = useCallback(async (preset = null, opts = {}) => {
    const msg = preset || { role: 'user', content: input.trim() };
    if (!preset && !input.trim()) return;
    // Send feedback: haptic + spring
    navigator.vibrate?.([5]);
    setSendSpring(true);
    setTimeout(() => setSendSpring(false), 400);

    const cid = activeId;
    const freshMeta = () => ({ steps: [], tokens: 0, elapsed: 0, model: '', status: '' });

    if (opts.historyForPayload) {
      updateMessages(cid, [...opts.historyForPayload, { role: 'assistant', content: '', meta: freshMeta() }]);
    } else if (!preset) {
      updateMessages(cid, prev => [...prev, msg, { role: 'assistant', content: '', meta: freshMeta() }]);
      setInput('');
    } else {
      updateMessages(cid, prev => [...prev, { role: 'assistant', content: '', meta: freshMeta() }]);
    }

    // Title from first message
    if (!messages.length && msg.content) {
      setConversations(prev => prev.map(c => c.id === cid ? { ...c, title: msg.content.slice(0, 40) } : c));
    }

    setIsLoading(true);
    setConnectionError(null);

    const historyForApi = opts.historyForPayload || [...messages, msg];
    const payload = {
      messages: historyForApi.map(m => ({ role: m.role, content: m.content, images: m.images })),
      agent: activeAgent,
      skill: 'chat',
      temperature: 0.7,
      thinking: true,
      sessionId: activeId,
      powerDial,
    };

    // Meta dispatch helpers
    const dispatchMeta = (fn) => {
      updateMessages(cid, prev => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last?.role === 'assistant') {
          u[u.length - 1] = { ...last, meta: fn(last.meta || freshMeta()) };
        }
        return u;
      });
    };
    const setStatus = (text) => dispatchMeta(m => ({ ...m, status: text }));
    // Add thinking point — classifies raw sentence into short label, deduplicates
    const addThinkPoint = (raw) => {
      const label = thinkToLabel(raw);
      dispatchMeta(m => {
        const last = m.steps[m.steps.length - 1];
        if (last?.text === label) return m; // deduplicate consecutive identical labels
        if (m.steps.length >= 8) return { ...m, steps: [...m.steps.slice(-6), { id: `${Date.now()}-${Math.random()}`, text: label }] }; // cap at ~7
        return { ...m, steps: [...m.steps, { id: `${Date.now()}-${Math.random()}`, text: label }] };
      });
    };

    const streamStartMs = Date.now();
    let tokenBuffer = '';
    let toolScanBuffer = '';
    let rafId = null;
    let retries = 0;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = [2000, 5000];

    const flushTokenBuffer = () => {
      rafId = null;
      if (!tokenBuffer) return;
      const chunk = tokenBuffer;
      tokenBuffer = '';
      updateMessages(cid, prev => {
        const u = [...prev];
        const last = u[u.length - 1];
        if (last?.role === 'assistant') u[u.length - 1] = { ...last, content: last.content + chunk };
        return u;
      });
    };
    const scheduleFlush = () => { if (!rafId) rafId = requestAnimationFrame(flushTokenBuffer); };

    // Tool call execution
    const executedToolIds = new Set();
    const handleJsonToolCalls = async (content, convId) => {
      const calls = extractJsonToolCalls(content);
      for (const { raw, parsed } of calls) {
        const toolName = parsed?.kuro_tool_call?.name || 'unknown';
        const toolId = parsed?.kuro_tool_call?.id || `${toolName}-${Date.now()}`;
        if (executedToolIds.has(toolId)) continue;
        executedToolIds.add(toolId);
        const placeholder = `__TOOL_PENDING_${toolId}__`;
        const replaceInMsg = (search, replacement) => {
          updateMessages(convId, prev => {
            const u = [...prev];
            for (let i = u.length - 1; i >= 0; i--) {
              if (u[i].role === 'assistant' && u[i].content.includes(search)) {
                u[i] = { ...u[i], content: u[i].content.replace(search, replacement) };
                break;
              }
            }
            return u;
          });
        };
        replaceInMsg(raw, placeholder);
        try {
          const res = await authFetch('/api/tools/invoke', { method: 'POST', body: JSON.stringify(parsed) });
          if (!res.ok) { replaceInMsg(placeholder, `**Tool error**: ${await res.text().catch(() => `HTTP ${res.status}`)}`); continue; }
          const data = await res.json();
          const tr = data.kuro_tool_result;
          if (!tr) { replaceInMsg(placeholder, '**Tool error**: Invalid response'); continue; }
          const resultBlock = tr.name === 'vision.generate' && tr.ok && tr.result?.imageUrl
            ? `![Generated Image](${tr.result.imageUrl})\n*${tr.result.dimensions?.width || 1024}\u00D7${tr.result.dimensions?.height || 1024} \u00B7 ${tr.result.elapsed || '?'}s*`
            : tr.ok ? `\`\`\`json\n${JSON.stringify(tr.result, null, 2)}\n\`\`\`` : `**Tool error**: ${tr.error}`;
          replaceInMsg(placeholder, resultBlock);
        } catch (err) { replaceInMsg(placeholder, `**Tool error**: ${err.message}`); }
      }
    };

    setStatus('Connecting\u2026');

    const attemptStream = async () => {
      toolScanBuffer = '';
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
          let message = 'Unexpected response from server';
          try { const parsed = JSON.parse(await res.text()); message = parsed.message || parsed.error || message; } catch {}
          updateMessages(cid, prev => {
            const u = [...prev]; const last = u[u.length - 1];
            if (last?.role === 'assistant' && !last.content) u[u.length - 1] = { ...last, content: message };
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
        const STALE_MS = 120000; // 120s — generous for slow models on constrained GPU

        const resetStaleTimer = () => {
          clearTimeout(staleTimer);
          staleTimer = setTimeout(() => {
            setConnectionError('Stream stalled \u2014 reconnecting\u2026');
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

            let d;
            try { d = JSON.parse(raw); } catch { continue; }

            if (d.type === 'token') {
              if (tokens === 0) setStatus('Generating');
              tokens++;
              if (d.content === '\0' || d.content.includes('"kuro_tool_call"')) continue;
              tokenBuffer += d.content;
              toolScanBuffer += d.content;
              scheduleFlush();
              if (tokens % 10 === 0) dispatchMeta(m => ({ ...m, tokens, elapsed: Date.now() - streamStartMs }));
            } else if (d.type === 'thinking') {
              if (d.content) addThinkPoint(d.content);
            } else if (d.type === 'layer') {
              // Layers → status line, not bullet points
              if (d.status === 'active' && d.name) setStatus(d.name);
              // Capture intent from router completion for smarter thinking label
              if (d.status === 'complete' && d.intent) {
                const intentLabels = {
                  code: 'Analyzing code', dev: 'Working on development', reasoning: 'Deep reasoning',
                  research: 'Researching', analysis: 'Analyzing', creative: 'Creating',
                  chat: 'Thinking', general: 'Thinking', fast: 'Quick response',
                  security: 'Checking security', crypto: 'Analyzing security',
                  stealth: 'Processing privately', vision: 'Processing visual',
                  exec: 'Executing', unrestricted: 'Processing',
                };
                setStatus(intentLabels[d.intent] || 'Thinking');
              }
            } else if (d.type === 'model') {
              setStatus('Thinking\u2026');
            } else if (d.type === 'gate') {
              updateMessages(cid, prev => {
                const u = [...prev]; const last = u[u.length - 1];
                if (last?.role === 'assistant' && !last.content) u[u.length - 1] = { ...last, content: d.message || 'Chat limit reached.' };
                return u;
              });
              setIsLoading(false);
              clearTimeout(staleTimer);
              return;
            } else if (d.type === 'error') {
              const errMsg = d.message || 'Stream error';
              updateMessages(cid, prev => {
                const u = [...prev]; const last = u[u.length - 1];
                if (last?.role === 'assistant' && !last.content) u[u.length - 1] = { ...last, content: `Error: ${errMsg}` };
                return u;
              });
              setConnectionError(errMsg);
            } else if (d.type === 'vision_start') {
              setStatus('Generating image\u2026');
              flushTokenBuffer();
              toolScanBuffer = '';
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant'
                  ? { ...m, content: m.content.replace(/\{[\s\S]*?"vision\.generate"[\s\S]*/, '').trim(), visionGenerating: true }
                  : m
              ));
            } else if (d.type === 'vision_result') {
              flushTokenBuffer();
              executedToolIds.add('vision-1');
              const imgMd = `![Generated Image](${d.imageUrl})\n*${d.dimensions?.width || 1024}\u00D7${d.dimensions?.height || 1024} \u00B7 ${d.elapsed || '?'}s*`;
              updateMessages(cid, prev => prev.map((m, i) =>
                i === prev.length - 1 && m.role === 'assistant'
                  ? { ...m, visionGenerating: false, content: (m.content || '') + '\n' + imgMd }
                  : m
              ));
              setStatus(`Image generated (${d.elapsed || '?'}s)`);
            } else if (d.type === 'done') {
              clearTimeout(staleTimer);
              if (rafId) cancelAnimationFrame(rafId);
              flushTokenBuffer();
              dispatchMeta(m => ({ ...m, tokens, model: d.model || '', elapsed: Date.now() - streamStartMs }));
              handleJsonToolCalls(toolScanBuffer, cid).catch(console.error);
              setIsLoading(false);
              setConnectionError(null);
              return;
            }
            // All other event types (capability, routing, redaction, etc.) silently ignored
          }
        }

        // Stream ended without done event
        clearTimeout(staleTimer);
        if (rafId) cancelAnimationFrame(rafId);
        flushTokenBuffer();
        if (toolScanBuffer) handleJsonToolCalls(toolScanBuffer, cid).catch(console.error);
      } catch (err) {
        if (rafId) cancelAnimationFrame(rafId);
        flushTokenBuffer();
        if (err.name === 'AbortError') {
          if (retries < MAX_RETRIES && isLoadingRef.current) {
            retries++;
            setConnectionError(`Reconnecting (${retries + 1}/${MAX_RETRIES + 1})\u2026`);
            await new Promise(r => setTimeout(r, RETRY_DELAY[retries - 1] || 3000));
            return attemptStream();
          }
        }
        updateMessages(cid, prev => {
          const u = [...prev]; const last = u[u.length - 1];
          if (last?.role === 'assistant' && !last.content) u[u.length - 1] = { ...last, content: `Error: ${err.message}` };
          return u;
        });
        setConnectionError(err.message);
      }
      setIsLoading(false);
    };

    await attemptStream();
  }, [input, activeId, activeAgent, messages, powerDial]);

  const handleEditMessage = useCallback((msgIndex, newContent) => {
    const truncated = messages.slice(0, msgIndex);
    const editedMsg = { role: 'user', content: newContent, isEdited: true };
    sendMessage(editedMsg, { historyForPayload: [...truncated, editedMsg] });
  }, [messages, sendMessage]);

  const onFlashCard = useCallback((prompt) => {
    setInput(prompt);
    // Auto-send after a tiny delay for visual feedback
    setTimeout(() => {
      const msg = { role: 'user', content: prompt };
      sendMessage(msg);
    }, 100);
  }, [sendMessage]);

  // ── LiveEdit hook ──────────────────────────────────────────────────
  const {
    correctionPhrase, showBar: showLiveEditBar, adapting, error: liveEditError,
    applyCorrection, dismiss: dismissLiveEdit,
  } = useLiveEdit({
    isStreaming: isLoading,
    sessionId: activeId,
    activeId,
    messages: activeConv?.messages || [],
    input,
    abortRef,
    sendMessage,
    updateMessages,
    setInput,
    setIsLoading,
    authHeaders,
  });


  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className={`k8 ${isDragging ? 'dragging' : ''}`}>

      {/* ── iOS Nav Bar ─── */}
      <div className="k8-nav">
        <button className="k8-nav-btn" onClick={() => setSheetOpen(true)} title="Conversations"><Menu size={18} /></button>
        <span className="k8-nav-title">KURO</span>
        <button className="k8-nav-btn" onClick={createConv} title="New chat"><Plus size={18} /></button>
      </div>

      {/* ── Conversation sheet ─── */}
      <ConversationSheet
        open={sheetOpen}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={createConv}
        onDelete={deleteConv}
        onClose={() => setSheetOpen(false)}
      />

      {/* ── Messages area ─── */}
      <div className="k8-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <EmptyState onFlashCard={onFlashCard} typingText={typingText} />
        ) : (
          <div className="k8-messages">
            {messages.map((m, i) => {
              // Stagger only new messages (added since last render)
              const isNew = i >= prevMsgCountRef.current;
              const stagger = isNew ? `${Math.min((i - prevMsgCountRef.current) * 40, 200)}ms` : undefined;
              // Grouping: is this the last/first message in a consecutive run of same role?
              const nextRole = messages[i + 1]?.role;
              const prevRole = messages[i - 1]?.role;
              const isLastInGroup = nextRole !== m.role;
              const isFirstInGroup = prevRole !== m.role;
              // Date separator
              const showDate = i === 0 || (m.meta?.ts && messages[i-1]?.meta?.ts &&
                new Date(m.meta.ts).toDateString() !== new Date(messages[i-1].meta.ts).toDateString());
              const dateLabel = m.meta?.ts ? formatDateLabel(new Date(m.meta.ts)) : (i === 0 ? 'Today' : null);
              return (
                <React.Fragment key={`${activeId}-${i}`}>
                  {showDate && dateLabel && (
                    <div className="k8-date-sep">
                      <span className="k8-date-line" />
                      <span className="k8-date-label">{dateLabel}</span>
                      <span className="k8-date-line" />
                    </div>
                  )}
                  <Message
                    msg={m}
                    msgIndex={i}
                    isStreaming={isLoading && i === messages.length - 1 && m.role === 'assistant'}
                    onCopy={c => { navigator.clipboard.writeText(c); addToast('Copied to clipboard', 'success'); }}
                    onEdit={handleEditMessage}
                    staggerDelay={stagger}
                    onLongPress={(idx, x, y) => setMsgContextMenu({ idx, x, y })}
                    isLastInGroup={isLastInGroup}
                    isFirstInGroup={isFirstInGroup}
                  />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Scroll-to-bottom FAB ─── */}
      {showScrollFab && (
        <button className="k8-scroll-fab" onClick={() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          setShowScrollFab(false);
        }}>
          <ChevronDown size={18} />
        </button>
      )}

      {/* ── Message context menu (long-press) ─── */}
      {msgContextMenu && (
        <>
          <div className="k8-msgmenu-backdrop" onClick={() => setMsgContextMenu(null)} />
          <div className="k8-msgmenu" style={{ left: Math.min(msgContextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 180), top: msgContextMenu.y }}>
            <button className="k8-msgmenu-item" onClick={() => {
              const m = messages[msgContextMenu.idx];
              navigator.clipboard.writeText(m?.content || '');
              navigator.vibrate?.([3,50,3]);
              addToast('Copied to clipboard', 'success');
              setMsgContextMenu(null);
            }}><Copy size={14} /><span>Copy</span></button>
            {messages[msgContextMenu.idx]?.role === 'user' && (
              <button className="k8-msgmenu-item" onClick={() => {
                handleEditMessage(msgContextMenu.idx, messages[msgContextMenu.idx]?.content);
                setMsgContextMenu(null);
              }}><Edit3 size={14} /><span>Edit</span></button>
            )}
            {(() => {
              const m = messages[msgContextMenu.idx];
              const hasCode = m?.content?.includes('```');
              return hasCode ? (
                <button className="k8-msgmenu-item" onClick={() => {
                  const codeMatch = m.content.match(/```\w*\n?([\s\S]*?)```/);
                  if (codeMatch) { navigator.clipboard.writeText(codeMatch[1].trim()); navigator.vibrate?.([3,50,3]); addToast('Code copied', 'success'); }
                  setMsgContextMenu(null);
                }}><Copy size={14} /><span>Copy Code</span></button>
              ) : null;
            })()}
          </div>
        </>
      )}

      {/* ── Toasts ─── */}
      <div className="k8-toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`k8-toast k8-toast-${t.type}`}>
            {t.type === 'success' && <Check size={14} />}
            {t.type === 'error' && <X size={14} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* ── Connection error ─── */}
      {connectionError && (
        <div className="k8-error">
          <span>{connectionError}</span>
          <button onClick={() => setConnectionError(null)}><X size={12} /></button>
        </div>
      )}

      {/* ── iOS Toolbar ─── */}
      <div className="k8-toolbar">
        {/* ── LiveEdit bar — floats above input when correction detected ── */}
        <LiveEditBar
          phrase={correctionPhrase}
          visible={showLiveEditBar}
          adapting={adapting}
          error={liveEditError}
          onApply={applyCorrection}
          onDismiss={dismissLiveEdit}
        />
        <input type="file" ref={fileInputRef} hidden
          accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.css,.html,.csv"
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="k8-toolbar-row">
          <button className="k8-attach" onClick={() => fileInputRef.current?.click()} title="Attach file">
            <Paperclip size={18} />
          </button>
          <div className={`k8-compose${isLoading ? ' active' : ''}`}>
            <div className="k8-input-main" style={{ position: 'relative' }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); onPreemptInput(e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading) sendMessage();
                  }
                }}
                placeholder="Message KURO\u2026"
                rows={1}
              />
              {/* ── Preempt ghost text overlay ── */}
              {preemptState === 'loaded' && input.trim() && (
                <div className="k8-preempt-ghost" aria-hidden="true">
                  {input}<span className="k8-preempt-hint">{'  \u2193 Tab to complete'}</span>
                </div>
              )}
              {isLoading ? (
                <button className="k8-send stop" onClick={() => { navigator.vibrate?.([10]); abortRef.current?.abort(); setIsLoading(false); }}><Square size={14} /></button>
              ) : (
                <button className={`k8-send${sendSpring ? ' spring' : ''}`} onClick={() => sendMessage()} disabled={!input.trim()}><ArrowUp size={17} /></button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Drop zone ─── */}
      {isDragging && (
        <div className="k8-drop">
          <Plus size={40} />
          <span>Drop to upload</span>
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════════════
         CSS
      ═══════════════════════════════════════════════════════════════════ */}
      <style>{`
/* ═══════════════════════════════════════════════════════════════
   KURO CHAT — iOS Dark Mode
   Matches PhoneApp / MessagesApp design language
   ═══════════════════════════════════════════════════════════════ */

/* ── ROOT ─────────────────────────────────────────────────── */
.k8 {
  /* iOS System Colors (Dark) */
  --bg: #000;
  --surface: rgba(28,28,30,1);
  --surface-2: rgba(44,44,46,1);
  --surface-3: rgba(58,58,60,1);
  --border: rgba(255,255,255,0.08);
  --border-2: rgba(255,255,255,0.15);
  --separator: rgba(255,255,255,0.06);
  --text: rgba(255,255,255,0.92);
  --text-2: rgba(255,255,255,0.55);
  --text-3: rgba(255,255,255,0.30);
  --accent: #a855f7;
  --accent-soft: rgba(168,85,247,0.15);
  --danger: #ff453a;
  --success: #30d158;
  --info: #0a84ff;
  --warm: #ff9f0a;

  /* Bubbles (iOS Messages style) */
  --bubble-user: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
  --bubble-user-bg: #9333ea;
  --bubble-ai: rgba(255,255,255,0.08);
  --nav-bg: rgba(0,0,0,0.85);

  /* Radii */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 22px;
  --radius-bubble: 18px;

  /* Timing */
  --ease-spring: cubic-bezier(0.34,1.56,0.64,1);
  --ease-ios: cubic-bezier(0.25,0.46,0.45,0.94);
  --dur-fast: 150ms;
  --dur-standard: 280ms;

  position: relative;
  flex: 1; min-height: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  display: flex; flex-direction: column;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── iOS NAV BAR ──────────────────────────────────────────── */
.k8-nav {
  flex-shrink: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--nav-bg);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-bottom: 0.5px solid var(--separator);
  z-index: 50;
}
.k8-nav-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}
.k8-nav-btn {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  color: var(--accent);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: opacity var(--dur-fast);
}
.k8-nav-btn:hover { opacity: 0.7; }
.k8-nav-btn:active { opacity: 0.5; transform: scale(0.92); }

/* ── CONVERSATION SHEET (iOS bottom sheet) ────────────────── */
.k8-sheet-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 90;
  animation: k8-fade-in 0.25s var(--ease-ios);
}
@keyframes k8-fade-in { from { opacity: 0; } to { opacity: 1; } }

.k8-sheet {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  max-height: 70%;
  background: var(--surface);
  border-radius: 12px 12px 0 0;
  z-index: 100;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.4);
  animation: k8-sheet-up 0.35s cubic-bezier(0.32,0.72,0,1) both;
}
@keyframes k8-sheet-up {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
.k8-sheet.closing {
  animation: k8-sheet-down 0.25s var(--ease-ios) forwards;
}
@keyframes k8-sheet-down {
  from { transform: translateY(0); }
  to   { transform: translateY(100%); }
}
.k8-sheet-backdrop.closing {
  animation: k8-fade-out 0.25s ease forwards;
}
@keyframes k8-fade-out { from { opacity: 1; } to { opacity: 0; } }

.k8-sheet-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px;
  height: 56px;
  flex-shrink: 0;
  border-bottom: 0.5px solid var(--separator);
}
.k8-sheet-header::before {
  content: '';
  position: absolute;
  top: 8px; left: 50%;
  transform: translateX(-50%);
  width: 36px; height: 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.15);
}
.k8-sheet-title { font-size: 17px; font-weight: 600; color: var(--text); }
.k8-sheet-close {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2);
  border: none;
  border-radius: 50%;
  color: var(--text-2); cursor: pointer;
}
.k8-sheet-close:hover { background: var(--surface-3); color: var(--text); }

.k8-sheet-new {
  display: flex; align-items: center; gap: 10px;
  margin: 12px 16px 4px;
  padding: 12px 16px;
  background: var(--surface-2);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--accent); font-size: 15px; font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast);
}
.k8-sheet-new:hover { background: var(--surface-3); }

.k8-sheet-list {
  flex: 1; overflow-y: auto;
  padding: 4px 16px 20px;
  padding-bottom: max(20px, env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 1px;
}
.k8-sheet-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 12px;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2); font-size: 15px;
  cursor: pointer; text-align: left;
  transition: background 100ms;
}
.k8-sheet-item:hover { background: rgba(255,255,255,0.04); color: var(--text); }
.k8-sheet-item.active { background: var(--accent-soft); color: var(--text); }
.k8-sheet-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k8-sheet-item-del {
  opacity: 0; background: none; border: none;
  color: var(--text-3); cursor: pointer; padding: 4px;
  transition: opacity var(--dur-fast);
}
.k8-sheet-item:hover .k8-sheet-item-del { opacity: 1; }
.k8-sheet-item-del:hover { color: var(--danger); }

/* ── MESSAGES SCROLL ──────────────────────────────────────── */
.k8-scroll {
  flex: 1; overflow-y: auto;
  padding: 12px 16px 24px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.k8-messages {
  max-width: 680px;
  margin: 0 auto;
  display: flex; flex-direction: column;
  /* Gap handled per-message via margin-top for HIG grouping */
}

/* ── MESSAGE (Apple HIG spacing + grouping) ──────────────── */
.k8-msg {
  display: flex;
  position: relative;
  animation: k8-msg-in 0.45s cubic-bezier(0.34,1.4,0.64,1) both;
  animation-delay: var(--msg-stagger, 0ms);
  margin-top: 2px;
}
.k8-msg.group-first { margin-top: 10px; }
.k8-messages > .k8-msg:first-child { margin-top: 0; }
@keyframes k8-msg-in {
  0%   { opacity: 0; transform: translateY(16px) scale(0.92); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
  80%  { transform: translateY(1px) scale(0.998); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.k8-msg.user { justify-content: flex-end; }
.k8-msg-inner { max-width: 80%; min-width: 0; position: relative; }

/* User bubble — gradient purple (iMessage outgoing) */
.k8-msg.user .k8-msg-inner {
  background: var(--bubble-user);
  color: #fff;
  padding: 9px 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
}
/* Grouped radius: full round when mid-group, tail corner when last */
.k8-msg.user .k8-msg-inner {
  border-radius: var(--radius-bubble) var(--radius-bubble) 6px var(--radius-bubble);
}
.k8-msg.user.group-first .k8-msg-inner { border-radius: var(--radius-bubble) var(--radius-bubble) 6px var(--radius-bubble); }
.k8-msg.user:not(.group-first) .k8-msg-inner { border-radius: var(--radius-bubble) 6px 6px var(--radius-bubble); }
.k8-msg.user.tail .k8-msg-inner { border-radius: var(--radius-bubble) 6px 4px var(--radius-bubble); }
.k8-msg.user.group-first.tail .k8-msg-inner { border-radius: var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble); }

/* User tail — SVG clip path approach for the iMessage nub */
.k8-msg.user.tail .k8-msg-inner::after {
  content: '';
  position: absolute;
  bottom: 0; right: -6px;
  width: 12px; height: 16px;
  background: var(--bubble-user-bg);
  clip-path: path('M 0 0 C 0 0, 0 16, 12 16 C 6 16, 0 12, 0 0 Z');
}

.k8-msg.user .k8-msg-text { color: #fff; }

/* Assistant bubble — dark gray (iMessage incoming) */
.k8-msg.assistant .k8-msg-inner {
  background: var(--bubble-ai);
  padding: 9px 14px;
}
.k8-msg.assistant .k8-msg-inner {
  border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 6px;
}
.k8-msg.assistant.group-first .k8-msg-inner { border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 6px; }
.k8-msg.assistant:not(.group-first) .k8-msg-inner { border-radius: 6px var(--radius-bubble) var(--radius-bubble) 6px; }
.k8-msg.assistant.tail .k8-msg-inner { border-radius: 6px var(--radius-bubble) var(--radius-bubble) 4px; }
.k8-msg.assistant.group-first.tail .k8-msg-inner { border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 4px; }

/* Assistant tail — mirrored nub */
.k8-msg.assistant.tail .k8-msg-inner::after {
  content: '';
  position: absolute;
  bottom: 0; left: -6px;
  width: 12px; height: 16px;
  background: var(--bubble-ai);
  clip-path: path('M 12 0 C 12 0, 12 16, 0 16 C 6 16, 12 12, 12 0 Z');
}

.k8-msg-text {
  font-size: 15.5px; line-height: 1.5;
  word-break: break-word;
}
.k8-msg.user .k8-msg-text { white-space: pre-wrap; }

/* ── SCROLL-DRIVEN BOUNCE (IntersectionObserver-powered) ─── */
.k8-msg.k8-reveal {
  animation: k8-bounce-in 0.55s cubic-bezier(0.22,1.3,0.36,1) both;
}
@keyframes k8-bounce-in {
  0%   { opacity: 0; transform: translateY(24px) scale(0.88); }
  40%  { opacity: 1; transform: translateY(-4px) scale(1.02); }
  65%  { transform: translateY(2px) scale(0.995); }
  82%  { transform: translateY(-1px) scale(1.002); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── KURO EMOJI ENGINE ────────────────────────────────────── */
.ke {
  display: inline-block;
  vertical-align: -0.15em;
  margin: 0 1px;
  overflow: visible;
}
.ke path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* After draw completes: fill fades in, stroke stays */
.ke.ke-filled path {
  fill: currentColor;
  fill-opacity: 0.85;
  stroke: currentColor;
  stroke-width: 0.8;
  stroke-opacity: 0.5;
  transition: fill-opacity 0.6s ease, stroke-width 0.4s ease, stroke-opacity 0.4s ease;
}
/* Drawing phase: thicker stroke, no fill */
.ke.ke-drawing path {
  fill: none;
  stroke-width: 1.4;
}
/* Emoji-only messages: large centered display */
.k8-msg-text.emoji-only {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 0;
}
.k8-msg-text.emoji-only .ke {
  width: 40px; height: 40px;
}
/* Emoji in user bubbles: white */
.k8-msg.user .ke path { color: #fff; }
/* Emoji in assistant bubbles: softer white */
.k8-msg.assistant .ke path { color: rgba(255,255,255,0.85); }
/* Fallback emoji (not in KURO set) */
.ke-fallback {
  font-size: 1em;
  line-height: 1;
}

/* ── CURSOR ───────────────────────────────────────────────── */
.k8-cursor {
  display: inline-block;
  width: 2px; height: 1.1em;
  vertical-align: text-bottom;
  margin-left: 1px;
  background: var(--accent);
  border-radius: 1px;
  animation: k8-cursor-blink 1s steps(2, start) infinite;
  user-select: none;
}
@keyframes k8-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.streaming .k8-cursor {
  animation: k8-cursor-glow 1.4s ease-in-out infinite;
  box-shadow: 0 0 6px var(--accent), 0 0 14px rgba(168,85,247,0.1);
}
@keyframes k8-cursor-glow {
  0%, 100% { opacity: 1; box-shadow: 0 0 6px var(--accent), 0 0 14px rgba(168,85,247,0.1); }
  50% { opacity: 0.4; box-shadow: 0 0 2px var(--accent); }
}

/* ── TOKEN SHIMMER ────────────────────────────────────────── */
.k8-msg-text.streaming { position: relative; }
.k8-msg-text.streaming::before {
  content: '';
  position: absolute;
  inset: -2px -4px;
  background: linear-gradient(90deg, transparent 0%, rgba(168,85,247,0.04) 45%, rgba(168,85,247,0.08) 50%, rgba(168,85,247,0.04) 55%, transparent 100%);
  background-size: 200% 100%;
  animation: k8-shimmer 2.5s ease-in-out infinite;
  pointer-events: none;
  border-radius: 4px;
  z-index: 0;
}
@keyframes k8-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── MESSAGE ACTIONS (iOS tinted style) ───────────────────── */
.k8-msg-actions {
  display: flex; gap: 2px; margin-top: 4px;
  animation: k8-actions-in 0.3s ease 0.15s both;
}
@keyframes k8-actions-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
.k8-msg-actions button {
  width: 30px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: rgba(255,255,255,0.3); cursor: pointer;
  transition: color 120ms, background 120ms;
}
.k8-msg-actions button:hover { color: var(--accent); background: rgba(168,85,247,0.08); }
.k8-msg-actions button:active { transform: scale(0.9); }

/* ── EDIT (iOS-style text field) ──────────────────────────── */
.k8-edit-wrap { width: 100%; }
.k8-edit-area {
  width: 100%;
  background: rgba(255,255,255,0.08);
  color: var(--text);
  border: 0.5px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 15px; font-family: inherit;
  resize: none; outline: none;
  transition: border-color 150ms, background 150ms;
}
.k8-edit-area:focus {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.2);
}
.k8-edit-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.k8-edit-save {
  padding: 7px 18px; border-radius: 16px; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  background: var(--accent); border: none; color: #fff;
  transition: filter 100ms;
}
.k8-edit-save:hover { filter: brightness(1.1); }
.k8-edit-save:active { transform: scale(0.96); }
.k8-edit-cancel {
  padding: 7px 16px; border-radius: 16px; cursor: pointer;
  font-size: 13px; font-weight: 500; font-family: inherit;
  background: rgba(255,255,255,0.08); border: none; color: var(--text-2);
  transition: background 100ms;
}
.k8-edit-cancel:hover { background: rgba(255,255,255,0.12); }

/* ── IMAGES ───────────────────────────────────────────────── */
.k8-images { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.k8-thumb {
  max-width: 200px; max-height: 150px;
  border-radius: 12px; object-fit: cover;
}

/* ── THINKING DROPDOWN (iOS grouped inset card) ───────────── */
.k8-think-drop {
  background: rgba(255,255,255,0.04);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
  overflow: hidden;
  animation: k8-msg-in 0.25s var(--ease-ios);
}
.k8-think-drop.done { opacity: 0.7; }
.k8-think-drop-header {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: none; border: none;
  color: var(--text-2); font-size: 13px;
  cursor: pointer; text-align: left;
  transition: background 100ms;
}
.k8-think-drop-header:hover { background: rgba(255,255,255,0.03); }
.k8-think-drop-label { font-weight: 500; color: var(--text-2); }
.streaming .k8-think-drop-label { color: var(--accent); }
.k8-think-drop-icon { color: var(--accent); opacity: 0.6; }
.k8-think-drop-time {
  font-size: 11px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono', ui-monospace, monospace;
  margin-left: auto; margin-right: 4px;
}

/* Thinking dots — iOS typing indicator style */
.k8-think-drop-dots {
  display: flex; gap: 3px; align-items: flex-end;
  height: 14px;
}
.k8-think-drop-dots span {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: k8-dot-bounce 1.4s ease-in-out infinite;
  will-change: transform, opacity;
}
.k8-think-drop-dots span:nth-child(2) { animation-delay: 0.16s; }
.k8-think-drop-dots span:nth-child(3) { animation-delay: 0.32s; }
@keyframes k8-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
  40% { transform: translateY(-5px); opacity: 1; }
}
.k8-think-drop-dots.settled span {
  animation: none;
  opacity: 0.2;
  transform: translateY(0);
}

.k8-think-drop-body {
  padding: 0 12px 10px;
  display: flex; flex-direction: column; gap: 0;
  animation: k8-dropdown-expand 0.25s var(--ease-ios);
  transform-origin: top;
}
@keyframes k8-dropdown-expand {
  from { opacity: 0; max-height: 0; }
  to   { opacity: 1; max-height: 400px; }
}

.k8-think-step {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0;
  animation: k8-step-flash 0.3s var(--ease-ios) both;
  min-height: 22px;
}
@keyframes k8-step-flash {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
}
.k8-think-step-bullet {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.4;
  flex-shrink: 0;
  transition: opacity 0.2s;
}
.k8-think-step:last-child .k8-think-step-bullet { opacity: 1; }
.k8-think-step-text { font-size: 12px; color: var(--text-3); line-height: 1.4; }
.k8-think-step:last-child .k8-think-step-text { color: var(--text-2); }
.k8-think-step-ping {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: k8-step-ping 1.5s ease-in-out infinite;
  flex-shrink: 0;
  margin-left: auto;
}
@keyframes k8-step-ping {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}
.k8-think-drop-hint {
  padding: 0 12px 8px;
  font-size: 11px; color: var(--warm);
  opacity: 0.6;
  animation: k8-thinking-fade 2s ease-in-out infinite;
}
.k8-think-drop.fading {
  animation: k8-think-fadeout 0.3s ease forwards;
}
@keyframes k8-think-fadeout {
  to { opacity: 0; max-height: 0; margin: 0; padding: 0; overflow: hidden; }
}
@keyframes k8-thinking-fade {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* ── THOUGHT BLOCK ────────────────────────────────────────── */
.k8-thought {
  background: rgba(255,255,255,0.04);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
  overflow: hidden;
}
.k8-thought-toggle {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: none; border: none;
  color: var(--text-2); font-size: 13px;
  cursor: pointer; text-align: left;
}
.k8-thought-label { font-weight: 500; color: var(--accent); }
.k8-thought-preview { flex: 1; color: var(--text-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.k8-chev { transition: transform 0.2s; }
.k8-chev.open { transform: rotate(180deg); }
.k8-thought-body { padding: 0 12px 12px; }
.k8-thought-body pre {
  margin: 0; padding: 10px;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px; color: var(--text-2);
  white-space: pre-wrap; word-break: break-word;
}

/* ── MARKDOWN ─────────────────────────────────────────────── */
.k8-codeblock {
  position: relative;
  background: rgba(0,0,0,0.35);
  border: 0.5px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  margin: 8px 0;
  overflow: hidden;
  font-size: 13px; line-height: 1.55;
  font-family: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
}
.k8-codeblock code {
  display: block;
  padding: 12px 14px;
  overflow-x: auto;
  color: rgba(255,255,255,0.85);
}
.k8-lang {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  background: rgba(255,255,255,0.04);
  border-bottom: 0.5px solid rgba(255,255,255,0.06);
  font-size: 11px; color: rgba(255,255,255,0.3);
  text-transform: uppercase; letter-spacing: 0.5px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
.k8-ic {
  background: rgba(255,255,255,0.08);
  padding: 2px 6px; border-radius: 5px;
  font-size: 0.9em;
  font-family: 'SF Mono', ui-monospace, monospace;
  color: rgba(255,255,255,0.85);
}
.k8-h { margin: 12px 0 4px; font-weight: 600; color: var(--text); }
h3.k8-h { font-size: 1.1em; }
h4.k8-h { font-size: 1em; }
.k8-li { margin-left: 16px; padding-left: 4px; list-style: disc; display: list-item; }
.k8-li.k8-ol { list-style: decimal; }
.k8-link { color: var(--accent); text-decoration: none; }
.k8-link:hover { text-decoration: underline; }
.k8-line { display: inline; }
.k8-img {
  max-width: 100%; max-height: 400px;
  border-radius: 12px; object-fit: contain;
  margin: 8px 0; display: block;
}

/* ── EMPTY STATE ──────────────────────────────────────────── */
.k8-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 48px 24px;
  text-align: center;
  min-height: 60vh;
}
.k8-brand {
  font-size: 32px; font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0 0 4px;
  color: var(--text);
}

/* ── TYPING ANIMATION ─────────────────────────────────────── */
.k8-typing-line {
  height: 24px;
  margin-bottom: 32px;
  font-size: 15px;
  color: var(--text-3);
  display: flex; align-items: center; justify-content: center;
}
.k8-typing-text { min-height: 1em; }
.k8-typing-cursor {
  display: inline-block;
  width: 2px; height: 17px;
  background: var(--accent);
  margin-left: 1px;
  animation: k8-cursor-blink 0.9s ease-in-out infinite;
  vertical-align: middle;
  border-radius: 1px;
}

/* ── 3D CUBE ──────────────────────────────────────────────── */
.k8-cube-wrap {
  perspective: 600px;
  width: 72px; height: 72px;
  margin: 0 auto 12px;
}
.k8-cube {
  width: 44px; height: 44px;
  position: relative;
  transform-style: preserve-3d;
  animation: k8-spin 20s linear infinite;
  margin: 14px auto;
}
@keyframes k8-spin {
  from { transform: rotateX(-22deg) rotateY(-25deg); }
  to   { transform: rotateX(-22deg) rotateY(335deg); }
}
.k8-face {
  position: absolute; width: 44px; height: 44px;
  background: linear-gradient(135deg,
    rgba(91,33,182,0.25) 0%,
    rgba(76,29,149,0.18) 50%,
    rgba(49,10,101,0.32) 100%);
  border: 1px solid rgba(139,92,246,0.18);
}
.k8-ft { transform: translateZ(22px); }
.k8-bk { transform: rotateY(180deg) translateZ(22px); }
.k8-rt { transform: rotateY(90deg) translateZ(22px); }
.k8-lt { transform: rotateY(-90deg) translateZ(22px); }
.k8-tp { transform: rotateX(90deg) translateZ(22px); }
.k8-bt { transform: rotateX(-90deg) translateZ(22px); }

/* ── FLASH CARDS (iOS style suggestion pills) ─────────────── */
.k8-flash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  max-width: 340px;
  width: 100%;
}
.k8-flash {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: var(--surface);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 13px; font-weight: 500;
  cursor: pointer; text-align: left;
  transition: background 100ms, transform 100ms;
  animation: k8-flash-in 0.35s var(--ease-ios) both;
}
@keyframes k8-flash-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.k8-flash:hover { background: var(--surface-2); color: var(--text); }
.k8-flash:active { transform: scale(0.97); }
.k8-flash-icon {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-soft);
  border-radius: 8px;
  font-size: 14px;
  flex-shrink: 0;
}
.k8-flash-label { line-height: 1.3; }

/* ── iOS TOOLBAR (bottom input) ───────────────────────────── */
.k8-toolbar {
  flex-shrink: 0;
  padding: 8px 12px;
  padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
  background: var(--nav-bg);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-top: 0.5px solid var(--separator);
  z-index: 50;
  position: relative;
}
.k8-toolbar-row {
  display: flex; align-items: flex-end; gap: 8px;
}
.k8-attach {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  color: var(--accent); cursor: pointer;
  flex-shrink: 0;
  transition: opacity var(--dur-fast);
}
.k8-attach:hover { opacity: 0.7; }
.k8-attach:active { opacity: 0.5; }

.k8-compose {
  flex: 1; min-width: 0;
  display: flex;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 6px 6px 6px 14px;
  transition: border-color var(--dur-fast);
}
.k8-compose:focus-within {
  border-color: rgba(168,85,247,0.4);
}
.k8-compose.active {
  border-color: rgba(168,85,247,0.3);
}

.k8-input-main { display: flex; align-items: flex-end; gap: 6px; flex: 1; }
.k8-input-main textarea {
  flex: 1;
  background: none; border: none;
  color: var(--text);
  font-size: 16px; line-height: 1.4;
  resize: none; outline: none;
  min-height: 22px; max-height: 120px;
  font-family: inherit; padding: 4px 0;
}
.k8-input-main textarea::placeholder { color: var(--text-3); }

.k8-send {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent);
  border: none; border-radius: 50%;
  color: #fff; cursor: pointer;
  flex-shrink: 0;
  transition: filter 100ms, transform 100ms;
}
.k8-send:hover { filter: brightness(1.1); }
.k8-send:active { transform: scale(0.9); }
.k8-send:disabled { opacity: 0.3; cursor: not-allowed; }
.k8-send.stop { background: var(--danger); }
.k8-send.spring { animation: k8-send-spring 300ms var(--ease-spring); }
@keyframes k8-send-spring {
  0%   { transform: scale(0.75); }
  50%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}

/* ── CONNECTION ERROR ─────────────────────────────────────── */
.k8-error {
  position: absolute;
  bottom: 100px; left: 16px; right: 16px;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: rgba(255,69,58,0.12);
  border: 1px solid rgba(255,69,58,0.2);
  border-radius: var(--radius-sm);
  z-index: 55;
  font-size: 13px; color: var(--danger);
  animation: k8-msg-in 0.25s var(--ease-ios);
}
.k8-error button {
  background: none; border: none;
  color: var(--danger); cursor: pointer;
  opacity: 0.6; padding: 2px;
  margin-left: auto;
}
.k8-error button:hover { opacity: 1; }

/* ── PREEMPT GHOST TEXT ───────────────────────────────────── */
.k8-preempt-ghost {
  position: absolute;
  top: 0; left: 0; right: 36px;
  padding: 4px 0;
  font-size: 16px; line-height: 1.4;
  font-family: inherit;
  color: transparent;
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}
.k8-preempt-hint {
  color: rgba(168, 85, 247, 0.3);
  font-style: italic;
}

/* ── DROP ZONE ────────────────────────────────────────────── */
.k8-drop {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  background: rgba(0,0,0,0.92);
  border: 2px dashed var(--accent);
  z-index: 200;
  animation: k8-fade-in 0.2s ease;
}
.k8-drop svg { color: var(--accent); }
.k8-drop span { font-size: 15px; color: var(--text-2); }

/* ── SCROLL-TO-BOTTOM FAB ────────────────────────────────── */
.k8-scroll-fab {
  position: absolute;
  bottom: 80px; right: 16px;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface);
  border: none;
  border-radius: 50%;
  color: var(--text-2); cursor: pointer;
  box-shadow: 0 2px 12px rgba(0,0,0,0.4);
  z-index: 55;
  animation: k8-msg-in 0.2s var(--ease-ios);
  transition: background 100ms, color 100ms;
}
.k8-scroll-fab:hover { background: var(--surface-2); color: var(--text); }
.k8-scroll-fab:active { transform: scale(0.9); }

/* ── DATE SEPARATORS ──────────────────────────────────────── */
.k8-date-sep {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0 4px;
}
.k8-date-line {
  flex: 1; height: 0.5px;
  background: var(--separator);
}
.k8-date-label {
  font-size: 11px; color: var(--text-3);
  font-weight: 600; letter-spacing: 0.3px;
  text-transform: uppercase;
  white-space: nowrap;
}

/* ── TOAST SYSTEM ─────────────────────────────────────────── */
.k8-toast-stack {
  position: absolute;
  top: 52px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px;
  z-index: 200;
  pointer-events: none;
  width: min(calc(100% - 32px), 380px);
}
.k8-toast {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 13px; font-weight: 500;
  animation: k8-toast-in 0.3s var(--ease-spring), k8-toast-out 0.3s ease 2.7s forwards;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
.k8-toast-success { color: var(--success); }
.k8-toast-error { color: var(--danger); }
.k8-toast-info { color: var(--info); }
@keyframes k8-toast-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes k8-toast-out {
  from { opacity: 1; }
  to   { opacity: 0; transform: translateY(-4px); }
}

/* ── CONTEXT MENU (iOS action sheet style) ────────────────── */
.k8-msgmenu-backdrop {
  position: fixed; inset: 0; z-index: 150;
  background: rgba(0,0,0,0.3);
}
.k8-msgmenu {
  position: fixed; z-index: 151;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  padding: 4px;
  min-width: 170px;
  animation: k8-msg-in 0.15s var(--ease-spring);
}
.k8-msgmenu-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 12px 16px;
  background: none; border: none;
  border-radius: var(--radius-sm);
  color: var(--text); font-size: 15px; font-family: inherit;
  cursor: pointer; text-align: left;
  transition: background 100ms;
}
.k8-msgmenu-item:hover { background: rgba(255,255,255,0.06); }

/* ── CODE BLOCK COPY BUTTON ──────────────────────────────── */
.k8-code-copy {
  position: relative; top: auto; right: auto;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: rgba(255,255,255,0.3); cursor: pointer;
  opacity: 1;
  transition: color 120ms, background 120ms;
}
.k8-code-copy:hover { color: var(--accent); background: rgba(168,85,247,0.1); }
.k8-code-copy:active { transform: scale(0.9); }

/* ── RESPONSIVE ───────────────────────────────────────────── */
@media (max-width: 768px) {
  .k8-nav { padding: 0 4px; }
  .k8-scroll { padding: 8px 12px 20px; }
  .k8-messages { /* gap handled by margin-top */ }
  .k8-msg-text { font-size: 15px; line-height: 1.5; }
  .k8-msg-inner { max-width: 88%; }
  .k8-toolbar { padding: 6px 8px; padding-bottom: max(6px, env(safe-area-inset-bottom, 0px)); }
  .k8-flash-grid { grid-template-columns: 1fr; max-width: 260px; }
  .k8-brand { font-size: 26px; }
  .k8-cube { width: 36px; height: 36px; }
  .k8-face { width: 36px; height: 36px; }
  .k8-ft { transform: translateZ(18px); } .k8-bk { transform: rotateY(180deg) translateZ(18px); }
  .k8-rt { transform: rotateY(90deg) translateZ(18px); } .k8-lt { transform: rotateY(-90deg) translateZ(18px); }
  .k8-tp { transform: rotateX(90deg) translateZ(18px); } .k8-bt { transform: rotateX(-90deg) translateZ(18px); }
  .k8-cube-wrap { width: 56px; height: 56px; }
  .k8-empty { padding: 32px 16px; min-height: 50vh; }
  .k8-codeblock { font-size: 12px; }
  .k8-codeblock code { padding: 10px 12px; }
  .k8-scroll-fab { bottom: 70px; right: 10px; }
  .k8-toast-stack { top: 50px; }
}
@media (max-width: 430px) {
  .k8-toolbar { padding: 6px 6px; padding-bottom: max(6px, env(safe-area-inset-bottom, 0px)); }
  .k8-msg-inner { max-width: 90%; }
  .k8-brand { font-size: 22px; }
  .k8-scroll-fab { right: 8px; }
}

/* ── REDUCED MOTION ───────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .k8-cube { animation: none; transform: rotateX(-22deg) rotateY(-25deg); }
  .k8-msg { animation: none !important; transform: none !important; opacity: 1 !important; }
  .k8-msg.k8-reveal { animation: none !important; }
  .k8-cursor { animation: none; opacity: 1; }
  .streaming .k8-cursor { animation: none; box-shadow: none; }
  .k8-msg-text.streaming::before { animation: none; opacity: 0; }
  .k8-send.spring { animation: none; }
  .k8-think-drop-dots span { animation: none; opacity: 0.5; }
  .k8-think-step { animation: none; opacity: 1; }
  .k8-think-step-ping { animation: none; opacity: 0.5; }
  .k8-think-drop-hint { animation: none; opacity: 0.6; }
  .k8-think-drop-body { animation: none; }
  .k8-sheet { animation: none; transform: translateY(0); }
  .k8-sheet.closing { animation: none; }
  .k8-sheet-backdrop, .k8-sheet-backdrop.closing { animation: none; }
  .k8-flash { animation: none; }
  .k8-scroll-fab { transition: none; }
  .k8-toast { animation: none; }
}
      `}</style>
    </div>
  );
}
