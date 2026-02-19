import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Menu, Square, Brain, Layers, X, MessageSquare, Plus, Trash2, ChevronDown, ChevronRight, Image, FileText, Code, Globe, ShoppingBag, Sparkles, XCircle, Cpu, Check, RefreshCw, Shield, Lock, Zap, Flame, Eye, Lightbulb, FlaskConical, Target, Database, Key, Clock, Activity, Server, Search, Atom, Download, Copy, Share2, FileCode, ImageIcon, Archive, CheckCircle, AlertTriangle } from 'lucide-react'
import GlassEngine from '../3d/GlassEngine'

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
const MODEL_REGISTRY = {
  'kuro-core': { name: 'KURO::CORE', base: 'huihui_ai/devstral-abliterated:24b', tier: 'sovereign', ctx: 32768, description: 'Sovereign base', iconModel: 'cube', color: '#a855f7' },
  'kuro-forge': { name: 'KURO::FORGE', base: 'huihui_ai/qwen2.5-coder-abliterate:14b-instruct-q8_0', tier: 'sovereign', ctx: 32768, description: 'Qwen Coder 2.5 14B', iconModel: 'pyramid', color: '#f97316' },
  'kuro-sentinel': { name: 'KURO::SENTINEL', base: 'huihui_ai/gemma3-abliterated:latest', tier: 'specialist', ctx: 16384, vision: true, description: 'Visual analysis', iconModel: 'sphere', color: '#22c55e' },
  'kuro-logic': { name: 'KURO::LOGIC', base: 'huihui_ai/deepseek-r1-abliterated:14b-qwen-distill-q6_K', tier: 'specialist', ctx: 32768, description: 'Deep reasoning', iconModel: 'icosahedron', color: '#6366f1' },
  'kuro-cipher': { name: 'KURO::CIPHER', base: 'huihui_ai/qwen3-abliterated:14b-q8_0', tier: 'specialist', ctx: 16384, description: 'Cryptography', iconModel: 'dodecahedron', color: '#06b6d4' },
  'kuro-phantom': { name: 'KURO::PHANTOM', base: 'huihui_ai/qwen3-abliterated:14b-v2-q8_0', tier: 'specialist', ctx: 16384, description: 'Stealth ops', iconModel: 'torus', color: '#8b5cf6' },
  'kuro-exe': { name: 'KURO::EXECUTIONER', base: 'huihui_ai/qwen3-abliterated:14b-v2-q8_0', tier: 'specialist', ctx: 32768, description: 'Unrestricted', iconModel: 'diamond', color: '#ef4444' },
  'kuro-shopper': { name: 'KURO::SHOPPER', base: 'huihui_ai/qwen3-abliterated:8b-q8_0', tier: 'utility', ctx: 16384, description: 'Shopping & web', iconModel: 'sphere', color: '#ec4899' },
  'kuro-scout': { name: 'KURO::SCOUT', base: 'huihui_ai/dolphin3-abliterated:8b-llama3.1-q4_K_M', tier: 'utility', ctx: 8192, description: 'Fast recon', iconModel: 'pyramid', color: '#eab308' },
};

const LAYER_NAMES = { 0: 'Iron Dome', 0.25: 'Nephilim Gate', 1: 'IFF Gate', 1.5: 'Babylon Protocol', 2: 'Edubba Archive', 3: 'Semantic Router', 4: 'Memory Engine', 5: 'Model Router', 6: 'Fire Control', 7: 'Reasoning Engine', 8: 'Maat Refiner', 9: 'Output Enhancer', 10: 'Stream Controller', 10.5: 'Feedback Loop' };
const LAYER_COLORS = { 0: '#ef4444', 0.25: '#991b1b', 1: '#f97316', 1.5: '#c2410c', 2: '#eab308', 3: '#22c55e', 4: '#14b8a6', 5: '#06b6d4', 6: '#3b82f6', 7: '#6366f1', 8: '#8b5cf6', 9: '#a855f7', 10: '#d946ef', 10.5: '#ec4899' };
const LAYER_BRAINS = { 0: 'kuro-scout', 0.25: 'nephilim', 1: 'kuro-scout', 1.5: 'babylon', 2: 'kuro-core', 3: 'kuro-scout', 4: 'kuro-core', 5: 'kuro-core', 6: 'kuro-logic', 7: 'kuro-logic', 8: 'kuro-phantom', 9: 'kuro-core', 10: 'kuro-core', 10.5: 'kuro-scout' };

const SKILL_ROUTING = {
  image: { primary: 'kuro-sentinel', fallback: 'kuro-core' },
  code: { primary: 'kuro-forge', fallback: 'kuro-cipher' },
  research: { primary: 'kuro-logic', fallback: 'kuro-phantom' },
  web: { primary: 'kuro-shopper', fallback: 'kuro-scout' },
  shopping: { primary: 'kuro-shopper', fallback: 'kuro-scout' },
  file: { primary: 'kuro-core', fallback: 'kuro-phantom' },
  fast: { primary: 'kuro-scout', fallback: 'kuro-shopper' },
  unrestricted: { primary: 'kuro-exe', fallback: 'kuro-core' },
};

const SKILLS = [
  { id: 'image', icon: Image, label: 'Vision', color: '#22c55e', iconModel: 'sphere' },
  { id: 'code', icon: Code, label: 'Code', color: '#f97316', iconModel: 'pyramid' },
  { id: 'research', icon: Sparkles, label: 'Research', color: '#6366f1', iconModel: 'icosahedron' },
  { id: 'web', icon: Globe, label: 'Web', color: '#06b6d4', iconModel: 'torus' },
  { id: 'shopping', icon: ShoppingBag, label: 'Shop', color: '#ec4899', iconModel: 'sphere' },
  { id: 'file', icon: FileText, label: 'Files', color: '#3b82f6', iconModel: 'cube' },
  { id: 'fast', icon: Zap, label: 'Fast', color: '#eab308', iconModel: 'pyramid' },
  { id: 'unrestricted', icon: Shield, label: 'Exec', color: '#ef4444', iconModel: 'diamond' },
];

const REASONING_PROMPTS = { 0: '', 1: '\n\nProvide brief reasoning.', 2: '\n\nThink step-by-step. Use <reasoning>...</reasoning> tags.', 3: '\n\nEngage maximum depth. Use <think>...</think> then <reasoning>...</reasoning> tags.' };

// ═══════════════════════════════════════════════════════════════════════════════
// TRUE TONE COLOR PALETTE (Reduced contrast for warm displays)
// ═══════════════════════════════════════════════════════════════════════════════
const TRUE_TONE = {
  textPrimary: 'rgba(240, 238, 235, 0.92)',
  textSecondary: 'rgba(200, 195, 190, 0.75)',
  textMuted: 'rgba(160, 155, 150, 0.6)',
  accent: '#b794f6',
  accentGlow: 'rgba(183, 148, 246, 0.4)',
  codeBg: 'rgba(30, 28, 35, 0.85)',
  bubbleBg: 'rgba(45, 42, 55, 0.65)',
  userBubbleBg: 'rgba(139, 92, 246, 0.25)',
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
const detectLang = (code) => {
  if (/^import .* from|^export |const .* = \(|=>/m.test(code)) return 'javascript';
  if (/^def |^class |^import |^from .* import/m.test(code)) return 'python';
  if (/<[a-z]+>|className=|style=/i.test(code)) return 'jsx';
  if (/^\s*[\{\[]|":\s*["\d\[\{]/m.test(code)) return 'json';
  if (/^SELECT |^INSERT |^CREATE TABLE/im.test(code)) return 'sql';
  if (/^\s*\.|^\s*#|@media/m.test(code)) return 'css';
  if (/^#!/.test(code)) return 'bash';
  return 'text';
};
const langColors = { javascript: '#f7df1e', python: '#3776ab', jsx: '#61dafb', json: '#292929', css: '#264de4', bash: '#4eaa25', sql: '#e38c00', text: '#888' };
const langLabels = { javascript: 'JS', python: 'PY', jsx: 'JSX', json: 'JSON', css: 'CSS', bash: 'SH', sql: 'SQL', text: 'TXT' };

// Better tag extraction supporting multiple instances (from v8_4)
const extractAllTags = (text, tag) => {
  if (!text) return { contents: [], remaining: text || '', hasOpen: false };
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const contents = [];
  let remaining = text;
  let hasOpen = false;
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match;
  while ((match = regex.exec(text)) !== null) contents.push(match[1].trim());
  remaining = remaining.replace(regex, '');
  const lastOpen = remaining.lastIndexOf(openTag);
  if (lastOpen !== -1 && remaining.indexOf(closeTag, lastOpen) === -1) {
    hasOpen = true;
    const streamContent = remaining.slice(lastOpen + openTag.length);
    if (streamContent) contents.push(streamContent);
    remaining = remaining.slice(0, lastOpen);
  }
  return { contents, remaining: remaining.trim(), hasOpen };
};

const generateArtifact = (content, metadata) => {
  const artifact = { version: '1.0', type: 'kuro-artifact', created: new Date().toISOString(), metadata, content, signature: crypto.randomUUID() };
  return new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
};

const encryptForExport = async (content) => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(content));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const exportedKey = await crypto.subtle.exportKey('raw', key);
  return { encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))), iv: btoa(String.fromCharCode(...iv)), key: btoa(String.fromCharCode(...new Uint8Array(exportedKey))) };
};

// ═══════════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER (from ZIP version)
// ═══════════════════════════════════════════════════════════════════════════════
const renderMarkdown = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  
  lines.forEach((line, lineIdx) => {
    if (line.startsWith('###')) {
      elements.push(<div key={lineIdx} className="md-heading">{line.replace(/^###\s*/, '')}</div>);
      return;
    }
    if (line.startsWith('##')) {
      elements.push(<div key={lineIdx} className="md-subheading">{line.replace(/^##\s*/, '')}</div>);
      return;
    }
    
    const parts = [];
    let remaining = line;
    let partIdx = 0;
    const inlineRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let match;
    let lastIndex = 0;
    
    while ((match = inlineRegex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={partIdx++}>{remaining.slice(lastIndex, match.index)}</span>);
      }
      const matched = match[0];
      if (matched.startsWith('**') && matched.endsWith('**')) {
        parts.push(<span key={partIdx++} className="md-shimmer">{matched.slice(2, -2)}</span>);
      } else if (matched.startsWith('*') && matched.endsWith('*')) {
        parts.push(<em key={partIdx++} className="md-italic">{matched.slice(1, -1)}</em>);
      } else if (matched.startsWith('`') && matched.endsWith('`')) {
        parts.push(<code key={partIdx++} className="md-inline-code">{matched.slice(1, -1)}</code>);
      }
      lastIndex = match.index + matched.length;
    }
    
    if (lastIndex < remaining.length) {
      parts.push(<span key={partIdx++}>{remaining.slice(lastIndex)}</span>);
    }
    
    if (parts.length > 0) {
      elements.push(<div key={lineIdx} className="md-line">{parts}</div>);
    } else if (line.trim() === '') {
      elements.push(<div key={lineIdx} className="md-break" />);
    } else {
      elements.push(<div key={lineIdx} className="md-line">{line}</div>);
    }
  });
  
  return <div className="md-content">{elements}</div>;
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLASS ENGINE 3D ICONS (from v8_3/ZIP)
// ═══════════════════════════════════════════════════════════════════════════════
const SovereignLogo = ({ active }) => (
  <div style={{ width: 80, height: 80 }}><GlassEngine type="cube" color="#a855f7" size={80} active={active} /></div>
);

const ModelIcon = ({ model, size = 32, active = false }) => {
  const m = MODEL_REGISTRY[model];
  if (!m) return <div style={{ width: size, height: size, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }} />;
  return <div style={{ width: size, height: size }}><GlassEngine type={m.iconModel} color={m.color} size={size} active={active} /></div>;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TERMINAL TEXT ANIMATION (from v8_4 - HIG Apple-style)
// ═══════════════════════════════════════════════════════════════════════════════
const TerminalText = ({ text, isStreaming, speed = 'normal', className = '' }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTextRef = useRef('');
  const animationRef = useRef(null);
  
  const speeds = { fast: { charDelay: 8, chunkSize: 3 }, normal: { charDelay: 12, chunkSize: 2 }, slow: { charDelay: 20, chunkSize: 1 } };
  const config = speeds[speed] || speeds.normal;
  
  useEffect(() => {
    if (!text) { setDisplayedText(''); prevTextRef.current = ''; return; }
    if (isStreaming) { setDisplayedText(text); prevTextRef.current = text; return; }
    if (text.length <= prevTextRef.current.length) { setDisplayedText(text); prevTextRef.current = text; return; }
    
    const newChars = text.slice(prevTextRef.current.length);
    let currentIndex = 0;
    setIsAnimating(true);
    
    const animate = () => {
      if (currentIndex < newChars.length) {
        currentIndex += config.chunkSize;
        setDisplayedText(prevTextRef.current + newChars.slice(0, currentIndex));
        animationRef.current = setTimeout(animate, config.charDelay);
      } else {
        setDisplayedText(text);
        prevTextRef.current = text;
        setIsAnimating(false);
      }
    };
    animate();
    return () => { if (animationRef.current) clearTimeout(animationRef.current); };
  }, [text, isStreaming, config.charDelay, config.chunkSize]);
  
  useEffect(() => () => { if (animationRef.current) clearTimeout(animationRef.current); }, []);
  
  return (
    <span className={`terminal-text ${isAnimating ? 'animating' : ''} ${className}`}>
      {displayedText}
      {(isStreaming || isAnimating) && <span className="terminal-cursor">▊</span>}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// COG PILL - Modern pill with LIVE indicator (from v8_4)
// ═══════════════════════════════════════════════════════════════════════════════
const CogPill = ({ type, content, isStreaming, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const ref = useRef(null);
  
  useEffect(() => {
    if (ref.current && isStreaming) ref.current.scrollTop = ref.current.scrollHeight;
  }, [content, isStreaming]);
  
  if (!content && !isStreaming) return null;
  
  const configs = {
    think: { icon: Brain, color: '#a855f7', title: 'Thinking', bg: 'rgba(168,85,247,0.06)' },
    reasoning: { icon: Lightbulb, color: '#22c55e', title: 'Reasoning', bg: 'rgba(34,197,94,0.06)' },
    incubation: { icon: FlaskConical, color: '#06b6d4', title: 'Incubation', bg: 'rgba(6,182,212,0.06)' },
    critique: { icon: Target, color: '#ef4444', title: 'Red Team', bg: 'rgba(239,68,68,0.06)' },
    plan: { icon: Database, color: '#f59e0b', title: 'Plan', bg: 'rgba(245,158,11,0.06)' },
    fireControl: { icon: Flame, color: '#f97316', title: 'Fire Control', bg: 'rgba(249,115,22,0.06)' },
  };
  const cfg = configs[type] || configs.think;
  const Icon = cfg.icon;
  
  return (
    <div className="cog-pill" style={{ '--pill-color': cfg.color, '--pill-bg': cfg.bg }}>
      <button className="pill-head" onClick={() => setExpanded(!expanded)}>
        <div className="pill-icon"><Icon size={12} /></div>
        <span>{cfg.title}</span>
        {isStreaming && <span className="pill-live">LIVE</span>}
        <div className="pill-chevron">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</div>
      </button>
      {expanded && (
        <div className="pill-body" ref={ref}>
          <TerminalText text={content} isStreaming={isStreaming} speed="fast" />
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FILE & CODE PILLS (from v8_4)
// ═══════════════════════════════════════════════════════════════════════════════
const FilePill = ({ file }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const handleDownload = () => {
    if (file.content) {
      const blob = new Blob([file.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name || 'file'; a.click();
      URL.revokeObjectURL(url);
    }
  };
  
  const handleCopy = () => { navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  
  return (
    <div className="file-pill">
      <button className="pill-head" onClick={() => setExpanded(!expanded)}>
        <FileCode size={14} />
        <span className="file-name">{file.name || file.path?.split('/').pop() || 'file'}</span>
        <div className="pill-actions">
          <button onClick={(e) => { e.stopPropagation(); handleCopy(); }} className="action-btn">{copied ? <CheckCircle size={12} /> : <Copy size={12} />}</button>
          <button onClick={(e) => { e.stopPropagation(); handleDownload(); }} className="action-btn"><Download size={12} /></button>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>
      {expanded && <div className="pill-body code"><pre><code>{file.content}</code></pre></div>}
    </div>
  );
};

const CodePill = ({ code, language }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const lang = language || detectLang(code);
  const color = langColors[lang] || langColors.text;
  
  const copyCode = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  
  return (
    <div className="code-pill" style={{ '--code-color': color }}>
      <button className="pill-head" onClick={() => setExpanded(!expanded)}>
        <Code size={14} />
        <span className="lang-tag">{lang.toUpperCase()}</span>
        <div className="pill-actions">
          <button onClick={(e) => { e.stopPropagation(); copyCode(); }} className="action-btn">{copied ? <CheckCircle size={12} /> : <Copy size={12} />}</button>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>
      {expanded && <div className="pill-body code"><pre><code>{code}</code></pre></div>}
    </div>
  );
};

const VisionPill = ({ image, analysis }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="vision-pill">
      <button className="pill-head" onClick={() => setExpanded(!expanded)}>
        <Eye size={14} />
        <span>Vision Analysis</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <div className="pill-body vision">
          {image && <img src={image.data || image.url || image} alt="" />}
          {analysis && <TerminalText text={analysis} speed="normal" />}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════
const MessageActions = ({ content, onGenerateArtifact, onExportImage }) => {
  const [copied, setCopied] = useState(false);
  const copyContent = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="message-actions">
      <button onClick={copyContent}>{copied ? <CheckCircle size={12} /> : <Copy size={12} />}<span>Copy</span></button>
      <button onClick={onGenerateArtifact}><Archive size={12} /><span>Artifact</span></button>
      <button onClick={onExportImage}><Share2 size={12} /><span>Export</span></button>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE BUBBLE - Combining best of all versions
// ═══════════════════════════════════════════════════════════════════════════════
const MessageBubble = ({ msg, isStreaming, settings, onArtifact, onExport, onFileDownload }) => {
  let content = msg.content || '';
  
  // Extract all cognitive tags using improved extraction
  const thinkData = extractAllTags(content, 'think');
  content = thinkData.remaining;
  const reasonData = extractAllTags(content, 'reasoning');
  content = reasonData.remaining;
  const planData = extractAllTags(content, 'plan');
  content = planData.remaining;
  const incubData = extractAllTags(content, 'incubation');
  content = incubData.remaining;
  const critData = extractAllTags(content, 'critique');
  content = critData.remaining;
  
  // Combine with protocol SSE data if present
  const thinkContent = thinkData.contents.join('\n\n');
  const reasonContent = reasonData.contents.join('\n\n');
  const planContent = planData.contents.join('\n\n');
  const incubationContent = incubData.contents.join('\n\n') || msg.protocols?.incubation || '';
  const critiqueContent = critData.contents.join('\n\n') || msg.protocols?.redTeam || '';
  const fireControlContent = msg.protocols?.fireControl || '';
  
  // Extract files
  const fileRegex = /<file\s+path=["']([^"']+)["'][^>]*>([\s\S]*?)<\/file>/gi;
  const files = [];
  let match;
  while ((match = fileRegex.exec(content)) !== null) {
    files.push({ name: match[1].split('/').pop(), path: match[1], content: match[2].trim() });
  }
  content = content.replace(fileRegex, '');
  
  // Extract code blocks
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const codeBlocks = [];
  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({ language: match[1] || 'text', code: match[2].trim() });
  }
  content = content.replace(codeBlockRegex, '');
  
  const isThinking = thinkData.hasOpen || reasonData.hasOpen || planData.hasOpen || incubData.hasOpen || critData.hasOpen;
  
  return (
    <div className={`msg ${msg.role}`}>
      {msg.role === 'user' ? (
        <div className="msg-body">
          {msg.attachments?.length > 0 && (
            <div className="msg-attachments">
              {msg.attachments.map((a, i) => <div key={i} className="attachment"><img src={a.data || a.url} alt="" /></div>)}
            </div>
          )}
          {msg.skill && <div className="skill-badge" style={{ '--skill-color': SKILLS.find(s => s.id === msg.skill)?.color || '#a855f7' }}>{msg.skill.toUpperCase()}</div>}
          <span>{msg.content}</span>
        </div>
      ) : (
        <div className="msg-body">
          {settings?.showThinking && (thinkContent || isStreaming && thinkData.hasOpen) && (
            <CogPill type="think" content={thinkContent} isStreaming={isStreaming && thinkData.hasOpen} />
          )}
          {(reasonContent || isStreaming && reasonData.hasOpen) && (
            <CogPill type="reasoning" content={reasonContent} isStreaming={isStreaming && reasonData.hasOpen} />
          )}
          {(planContent || isStreaming && planData.hasOpen) && (
            <CogPill type="plan" content={planContent} isStreaming={isStreaming && planData.hasOpen} />
          )}
          {incubationContent && <CogPill type="incubation" content={incubationContent} isStreaming={false} />}
          {critiqueContent && <CogPill type="critique" content={critiqueContent} isStreaming={false} />}
          {fireControlContent && <CogPill type="fireControl" content={fireControlContent} isStreaming={false} />}
          
          {files.length > 0 && files.map((f, i) => <FilePill key={i} file={f} />)}
          {codeBlocks.length > 0 && codeBlocks.map((b, i) => <CodePill key={i} code={b.code} language={b.language} />)}
          {msg.vision && <VisionPill image={msg.vision.image} analysis={msg.vision.analysis} />}
          
          <div className="msg-main">
            <TerminalText text={content.trim()} isStreaming={isStreaming && !isThinking} />
          </div>
          
          {!isStreaming && content.trim() && (
            <MessageActions content={msg.content} onGenerateArtifact={() => onArtifact?.(msg)} onExportImage={() => onExport?.(msg)} />
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODALS (from v8_3)
// ═══════════════════════════════════════════════════════════════════════════════
const ArtifactModal = ({ visible, artifact, onClose, onSave }) => {
  if (!visible) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><Archive size={14} /><span>KURO Artifact</span><button onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body">
          <div className="artifact-preview"><pre>{JSON.stringify(artifact, null, 2)}</pre></div>
        </div>
        <div className="modal-foot">
          <button className="btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn-pri" onClick={onSave}><Download size={14} />Save Artifact</button>
        </div>
      </div>
    </div>
  );
};

const ExportModal = ({ visible, onClose, onExport, excerpts }) => {
  const [selected, setSelected] = useState([]);
  const [exporting, setExporting] = useState(false);
  const toggle = i => setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);
  const handleExport = async () => { setExporting(true); await onExport(selected.map(i => excerpts[i])); setExporting(false); onClose(); };
  if (!visible) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><Share2 size={14} /><span>Export Encrypted</span><button onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body">
          <div className="export-list">
            {excerpts.map((e, i) => (
              <button key={i} className={`export-item ${selected.includes(i) ? 'selected' : ''}`} onClick={() => toggle(i)}>
                <div className="check">{selected.includes(i) && <CheckCircle size={14} />}</div>
                <span>{(e.content || '').slice(0, 80)}...</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn-pri" onClick={handleExport} disabled={!selected.length || exporting}>{exporting ? 'Encrypting...' : `Export ${selected.length}`}</button>
        </div>
      </div>
    </div>
  );
};

const DeadDropModal = ({ visible, mode, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({ alias: '', payload: '', expiry: '24h', selfDestruct: true });
  const submit = () => { onSubmit(formData); onClose(); setFormData({ alias: '', payload: '', expiry: '24h', selfDestruct: true }); };
  if (!visible) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><Key size={14} /><span>Dead Drop: {mode}</span><button onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body">
          <label className="field-label">Alias</label>
          <input className="field-input" value={formData.alias} onChange={e => setFormData({ ...formData, alias: e.target.value })} placeholder="Enter alias..." />
          {mode === 'deposit' && (
            <>
              <label className="field-label">Payload</label>
              <textarea className="field-textarea" value={formData.payload} onChange={e => setFormData({ ...formData, payload: e.target.value })} placeholder="Enter payload..." rows={4} />
              <label className="field-label">Expiry</label>
              <select className="field-select" value={formData.expiry} onChange={e => setFormData({ ...formData, expiry: e.target.value })}>
                <option value="1h">1 Hour</option><option value="24h">24 Hours</option><option value="7d">7 Days</option><option value="30d">30 Days</option>
              </select>
              <label className="toggle-field">
                <input type="checkbox" checked={formData.selfDestruct} onChange={e => setFormData({ ...formData, selfDestruct: e.target.checked })} />
                <span>Self-destruct after retrieval</span>
              </label>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-sec" onClick={onClose}>Cancel</button>
          <button className="btn-pri" onClick={submit}>{mode === 'deposit' ? 'Deposit' : 'Retrieve'}</button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════
const LayerStack = ({ layers, activeLayer, blocked }) => {
  if (blocked) return <div className="layer-stack"><div className="blocked"><AlertTriangle size={14} /> Request blocked by {blocked}</div></div>;
  return (
    <div className="layer-stack">
      {Object.entries(LAYER_NAMES).map(([num, name]) => {
        const n = parseFloat(num);
        const isActive = activeLayer === n;
        const isComplete = layers.includes(n);
        return (
          <div key={num} className={`layer-row ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`} style={{ '--layer-color': LAYER_COLORS[n] }}>
            <div className="layer-dot" /><span>{name}</span><span className="layer-stat">{isComplete ? '✓' : isActive ? '...' : ''}</span>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTIONER APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function ExecutionerApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentModel, setCurrentModel] = useState('kuro-core');
  const [activeSkill, setActiveSkill] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [layers, setLayers] = useState([]);
  const [activeLayer, setActiveLayer] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [showSidebar, setShowSidebar] = useState(false);
  const [showPanel, setShowPanel] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [settings, setSettings] = useState({ showThinking: true, showLayers: true, reasoningLevel: 2, temperature: 0.7, autoModel: true });
  const [dropModal, setDropModal] = useState({ visible: false, mode: 'deposit' });
  const [artifactModal, setArtifactModal] = useState({ visible: false, artifact: null });
  const [exportModal, setExportModal] = useState({ visible: false, excerpts: [] });
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }, [messages]);
  useEffect(() => { if (settings.autoModel && activeSkill && SKILL_ROUTING[activeSkill]) setCurrentModel(SKILL_ROUTING[activeSkill].primary); }, [activeSkill, settings.autoModel]);

  const send = async () => {
    if (!input.trim() && !attachments.length) return;
    const userMsg = { role: 'user', content: input + (settings.reasoningLevel > 0 ? REASONING_PROMPTS[settings.reasoningLevel] : ''), skill: activeSkill, attachments: attachments.length ? [...attachments] : undefined };
    setMessages(m => [...m, userMsg]);
    setInput(''); setAttachments([]); setStreaming(true); setLayers([]); setActiveLayer(null); setBlocked(null);
    const assistantMsg = { role: 'assistant', content: '', protocols: {} };
    setMessages(m => [...m, assistantMsg]);
    try {
      abortRef.current = new AbortController();
      const token = localStorage.getItem('kuro_token') || '';
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KURO-Token': token },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })), model: currentModel, skill: activeSkill, sessionId, images: attachments.filter(a => a.type === 'image').map(a => a.data), temperature: settings.temperature }),
        signal: abortRef.current.signal,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'layer') { if (data.status === 'active') setActiveLayer(data.layer); else if (data.status === 'complete') { setLayers(l => [...l, data.layer]); setActiveLayer(null); } }
            else if (data.type === 'blocked') setBlocked(data.layer || 'Iron Dome');
            else if (data.type === 'model') setCurrentModel(data.model);
            else if (data.type === 'protocol') setMessages(m => { const u = [...m]; const l = u[u.length - 1]; if (l.role === 'assistant') l.protocols = { ...l.protocols, [data.protocol]: data.simulation || data.critique || data.result || '' }; return u; });
            else if (data.type === 'token') setMessages(m => { const u = [...m]; const l = u[u.length - 1]; if (l.role === 'assistant') l.content += data.content; return u; });
            else if (data.type === 'error') setMessages(m => { const u = [...m]; const l = u[u.length - 1]; if (l.role === 'assistant') l.content += `\n\n⚠️ Error: ${data.message}`; return u; });
          } catch {}
        }
      }
    } catch (e) { if (e.name !== 'AbortError') setMessages(m => { const u = [...m]; const l = u[u.length - 1]; if (l?.role === 'assistant') l.content += `\n\n⚠️ Connection error: ${e.message}`; return u; }); }
    setStreaming(false); setActiveLayer(null);
  };

  const stop = () => { abortRef.current?.abort(); setStreaming(false); };
  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const handleFile = (e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setAttachments(a => [...a, { type: file.type.startsWith('image/') ? 'image' : 'file', name: file.name, data: reader.result }]); reader.readAsDataURL(file); e.target.value = ''; };
  const removeAttachment = (i) => setAttachments(a => a.filter((_, idx) => idx !== i));
  const handleGenerateArtifact = (msg) => setArtifactModal({ visible: true, artifact: { content: msg.content, metadata: { model: currentModel, skill: msg.skill } } });
  const saveArtifact = () => { const blob = generateArtifact(artifactModal.artifact.content, artifactModal.artifact.metadata); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'kuro-artifact.json'; a.click(); URL.revokeObjectURL(url); setArtifactModal({ visible: false, artifact: null }); };
  const handleExportImage = (msg) => setExportModal({ visible: true, excerpts: messages.filter(m => m.role === 'assistant') });
  const performExport = async (content) => { const encrypted = await encryptForExport(content); const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'kuro-export.enc.json'; a.click(); URL.revokeObjectURL(url); };
  const handleShadow = (a) => setDropModal({ visible: true, mode: a });
  const submitDrop = async (d) => { try { await fetch(`/api/shadow/drop/${dropModal.mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); } catch {} };
  const newConversation = () => { setMessages([]); setActiveConv(null); };
  const modelData = MODEL_REGISTRY[currentModel] || MODEL_REGISTRY['kuro-core'];

  return (
    <div className="exe">
      {showSidebar && (<><div className="overlay" onClick={() => setShowSidebar(false)} /><div className="sidebar"><div className="sidebar-head"><span>Conversations</span><button onClick={() => setShowSidebar(false)}><X size={16} /></button></div><button className="new-btn" onClick={newConversation}><Plus size={14} />New Conversation</button><div className="conv-list">{conversations.map((c, i) => (<div key={i} className={`conv-row ${activeConv === i ? 'active' : ''}`} onClick={() => setActiveConv(i)}><MessageSquare size={14} /><span>{c.title || `Conversation ${i + 1}`}</span><button className="del-btn"><Trash2 size={12} /></button></div>))}{conversations.length === 0 && <div className="empty-conv">No conversations yet</div>}</div></div></>)}
      <div className="main">
        <div className="toolbar"><button className="tb-btn" onClick={() => setShowSidebar(true)}><Menu size={18} /></button><div className="tb-title"><ModelIcon model={currentModel} size={24} active={streaming} /><span>{modelData.name}</span></div><button className={`tb-btn ${showPanel === 'skills' ? 'active' : ''}`} onClick={() => setShowPanel(showPanel === 'skills' ? null : 'skills')}><Sparkles size={18} /></button><button className={`tb-btn ${showPanel === 'model' ? 'active' : ''}`} onClick={() => setShowPanel(showPanel === 'model' ? null : 'model')}><Cpu size={18} /></button><button className={`tb-btn ${showPanel === 'layers' ? 'active' : ''}`} onClick={() => setShowPanel(showPanel === 'layers' ? null : 'layers')}><Layers size={18} /></button><button className={`tb-btn ${showPanel === 'settings' ? 'active' : ''}`} onClick={() => setShowPanel(showPanel === 'settings' ? null : 'settings')}><Activity size={18} /></button></div>
        {showPanel === 'skills' && (<div className="panel skills-panel"><div className="panel-head"><Sparkles size={14} /><span>Skills</span><button onClick={() => setShowPanel(null)}><X size={14} /></button></div><div className="skills-grid">{SKILLS.map(s => (<button key={s.id} className={`skill-btn ${activeSkill === s.id ? 'active' : ''}`} style={{ '--s-color': s.color }} onClick={() => setActiveSkill(activeSkill === s.id ? null : s.id)}><s.icon size={18} /><span>{s.label}</span></button>))}</div>{activeSkill && (<button className="model-link" onClick={() => setShowPanel('model')}><span>Using {MODEL_REGISTRY[SKILL_ROUTING[activeSkill]?.primary]?.name}</span><ChevronRight size={12} /></button>)}</div>)}
        {showPanel === 'model' && (<div className="panel"><div className="panel-head"><Cpu size={14} /><span>Model</span><button onClick={() => setShowPanel(null)}><X size={14} /></button></div><div className="panel-scroll"><div className="panel-section">{Object.entries(MODEL_REGISTRY).map(([id, m]) => (<button key={id} className={`model-row ${currentModel === id ? 'active' : ''}`} style={{ '--m-color': m.color }} onClick={() => { setCurrentModel(id); setShowPanel(null); }}><ModelIcon model={id} size={36} active={currentModel === id} /><div className="model-meta"><span className="model-name">{m.name}</span><span className="model-desc">{m.description}</span></div>{currentModel === id && <Check size={16} style={{ color: m.color }} />}</button>))}</div></div></div>)}
        {showPanel === 'layers' && (<div className="panel"><div className="panel-head"><Layers size={14} /><span>Pipeline</span><button onClick={() => setShowPanel(null)}><X size={14} /></button></div><div className="panel-scroll"><div className="panel-section"><LayerStack layers={layers} activeLayer={activeLayer} blocked={blocked} /></div><div className="panel-section"><div className="sec-label">Dead Drops</div><button className="model-row" onClick={() => handleShadow('deposit')}><Key size={18} /><span className="model-meta"><span className="model-name">Deposit</span></span></button><button className="model-row" onClick={() => handleShadow('retrieve')}><Lock size={18} /><span className="model-meta"><span className="model-name">Retrieve</span></span></button></div></div></div>)}
        {showPanel === 'settings' && (<div className="panel"><div className="panel-head"><Activity size={14} /><span>Settings</span><button onClick={() => setShowPanel(null)}><X size={14} /></button></div><div className="panel-scroll"><div className="panel-section"><button className={`hig-toggle ${settings.showThinking ? 'on' : ''}`} style={{ '--toggle-color': '#a855f7' }} onClick={() => setSettings(s => ({ ...s, showThinking: !s.showThinking }))}><Brain size={16} /><span>Show Thinking</span><div className="toggle-track"><div className="toggle-thumb" /></div></button><button className={`hig-toggle ${settings.showLayers ? 'on' : ''}`} style={{ '--toggle-color': '#22c55e' }} onClick={() => setSettings(s => ({ ...s, showLayers: !s.showLayers }))}><Layers size={16} /><span>Show Layers</span><div className="toggle-track"><div className="toggle-thumb" /></div></button><button className={`hig-toggle ${settings.autoModel ? 'on' : ''}`} style={{ '--toggle-color': '#06b6d4' }} onClick={() => setSettings(s => ({ ...s, autoModel: !s.autoModel }))}><Cpu size={16} /><span>Auto Model</span><div className="toggle-track"><div className="toggle-thumb" /></div></button></div><div className="panel-section"><div className="sec-label">Reasoning Level <span className="val">{settings.reasoningLevel}</span></div><input type="range" className="hig-slider" min={0} max={3} value={settings.reasoningLevel} onChange={e => setSettings(s => ({ ...s, reasoningLevel: parseInt(e.target.value) }))} /></div><div className="panel-section"><div className="sec-label">Temperature <span className="val">{settings.temperature.toFixed(1)}</span></div><input type="range" className="hig-slider" min={0} max={100} value={settings.temperature * 100} onChange={e => setSettings(s => ({ ...s, temperature: parseInt(e.target.value) / 100 }))} /></div></div></div>)}
        <div className="messages" ref={messagesRef}>{messages.length === 0 ? (<div className="empty"><SovereignLogo active={false} /><div className="title">KURO::EXECUTIONER</div><div className="hint">Sovereign Intelligence Platform</div></div>) : (messages.map((m, i) => (<MessageBubble key={i} msg={m} isStreaming={streaming && i === messages.length - 1 && m.role === 'assistant'} settings={settings} onArtifact={handleGenerateArtifact} onExport={handleExportImage} />)))}</div>
        <div className="input-area">{activeSkill && (<div className="active-skill" style={{ color: SKILLS.find(s => s.id === activeSkill)?.color, borderColor: SKILLS.find(s => s.id === activeSkill)?.color }}>{(() => { const S = SKILLS.find(s => s.id === activeSkill); return S ? <S.icon size={12} /> : null; })()}<span>{activeSkill.toUpperCase()}</span><button onClick={() => setActiveSkill(null)}><XCircle size={12} /></button></div>)}{attachments.length > 0 && (<div className="attachments">{attachments.map((a, i) => (<div key={i} className="att-preview">{a.type === 'image' ? <img src={a.data} alt="" /> : <div className="att-file"><FileText size={20} /></div>}<button onClick={() => removeAttachment(i)}><X size={10} /></button></div>))}</div>)}<div className="input-row"><label className="ctrl-btn"><input type="file" hidden onChange={handleFile} accept="image/*,.pdf,.txt,.md,.json" /><Image size={16} /></label><textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Message KURO..." rows={1} />{streaming ? (<button className="send-btn stop" onClick={stop}><Square size={16} /></button>) : (<button className="send-btn" onClick={send} disabled={!input.trim() && !attachments.length}><Send size={16} /></button>)}</div></div>
      </div>
      <DeadDropModal visible={dropModal.visible} mode={dropModal.mode} onClose={() => setDropModal({ ...dropModal, visible: false })} onSubmit={submitDrop} />
      <ArtifactModal visible={artifactModal.visible} artifact={artifactModal.artifact} onClose={() => setArtifactModal({ visible: false, artifact: null })} onSave={saveArtifact} />
      <ExportModal visible={exportModal.visible} onClose={() => setExportModal({ visible: false, excerpts: [] })} onExport={performExport} excerpts={exportModal.excerpts} />
      <style>{`
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
input,textarea{-webkit-user-select:text;user-select:text}
.exe{display:flex;height:100%;background:#08080c;color:${TRUE_TONE.textPrimary};font-family:-apple-system,BlinkMacSystemFont,'SF Pro',system-ui,sans-serif;position:relative;overflow:hidden;padding-top:env(safe-area-inset-top);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05)}
.tb-btn{padding:10px;border-radius:10px;background:transparent;border:none;color:rgba(255,255,255,0.5);cursor:pointer;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;transition:all .2s cubic-bezier(.4,0,.2,1)}
.tb-btn:hover,.tb-btn.active{background:rgba(168,85,247,0.15);color:#a855f7}
.tb-title{flex:1;display:flex;align-items:center;gap:10px;font-weight:700;font-size:14px;color:${TRUE_TONE.textSecondary}}
.panel{position:absolute;top:60px;right:10px;width:300px;max-width:calc(100vw - 20px);background:rgba(12,12,16,0.98);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:16px;z-index:100;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.7);animation:panelIn .3s cubic-bezier(.16,1,.3,1);display:flex;flex-direction:column;max-height:calc(100vh - 120px)}
@keyframes panelIn{from{opacity:0;transform:translateY(-10px) scale(.97)}to{opacity:1;transform:none}}
.panel-head{display:flex;align-items:center;gap:8px;padding:14px 16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;font-weight:600;flex-shrink:0}
.panel-head button{margin-left:auto;padding:6px;background:transparent;border:none;color:rgba(255,255,255,0.4);cursor:pointer;border-radius:6px;transition:all .15s}
.panel-head button:hover{background:rgba(255,255,255,0.08);color:#fff}
.panel-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.panel-section{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.04)}
.panel-section:last-child{border-bottom:none}
.sec-label{display:flex;align-items:center;justify-content:space-between;font-size:10px;color:${TRUE_TONE.textMuted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.sec-label .val{color:${TRUE_TONE.accent};font-weight:600;text-transform:none}
.hig-toggle{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;color:${TRUE_TONE.textSecondary};font-size:12px;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1)}
.hig-toggle:hover{background:rgba(255,255,255,0.05)}
.hig-toggle.on{background:rgba(168,85,247,0.08);border-color:var(--toggle-color);color:#fff}
.hig-toggle span{flex:1;text-align:left}
.toggle-track{width:40px;height:24px;background:rgba(255,255,255,0.1);border-radius:12px;position:relative;transition:all .3s cubic-bezier(.4,0,.2,1)}
.hig-toggle.on .toggle-track{background:var(--toggle-color)}
.toggle-thumb{position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.hig-toggle.on .toggle-thumb{transform:translateX(16px)}
.hig-slider{width:100%;height:6px;-webkit-appearance:none;background:rgba(255,255,255,0.1);border-radius:3px;outline:none}
.hig-slider::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;background:#fff;border-radius:50%;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform .15s cubic-bezier(.4,0,.2,1)}
.hig-slider::-webkit-slider-thumb:active{transform:scale(1.15)}
.model-row{display:flex;align-items:center;gap:12px;width:100%;padding:12px;margin:4px 0;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;cursor:pointer;transition:all .2s}
.model-row:hover{background:rgba(255,255,255,0.05)}
.model-row.active{background:rgba(168,85,247,0.1);border-color:var(--m-color)}
.model-meta{flex:1;text-align:left}
.model-name{display:block;font-size:12px;font-weight:600;color:#fff}
.model-desc{display:block;font-size:10px;color:${TRUE_TONE.textMuted}}
.layer-stack{display:flex;flex-direction:column;gap:4px}
.layer-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;font-size:11px;transition:all .2s}
.layer-row.active{background:rgba(255,255,255,0.05)}
.layer-dot{width:8px;height:8px;border-radius:50%;background:var(--layer-color);box-shadow:0 0 8px var(--layer-color);transition:all .3s}
.layer-row.complete .layer-dot{animation:dotPulse .4s cubic-bezier(.4,0,.2,1)}
@keyframes dotPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.4)}}
.layer-row span{flex:1;color:${TRUE_TONE.textSecondary}}
.layer-stat{color:${TRUE_TONE.textMuted}}
.blocked{background:rgba(239,68,68,0.1);color:#ef4444;display:flex;align-items:center;gap:8px;padding:12px;border-radius:8px}
.skills-panel{width:280px}
.skills-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px}
.skill-btn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;color:${TRUE_TONE.textSecondary};font-size:10px;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1)}
.skill-btn:hover{background:rgba(255,255,255,0.05);color:var(--s-color);border-color:var(--s-color);transform:translateY(-2px)}
.skill-btn.active{background:rgba(168,85,247,0.15);border-color:var(--s-color);color:var(--s-color)}
.model-link{display:flex;align-items:center;gap:6px;width:100%;padding:12px;background:transparent;border:none;border-top:1px solid rgba(255,255,255,0.05);color:${TRUE_TONE.textMuted};font-size:11px;cursor:pointer;transition:all .15s}
.model-link:hover{color:${TRUE_TONE.accent}}
.messages{flex:1;overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;color:${TRUE_TONE.textMuted}}
.empty .title{font-size:14px;font-weight:600;letter-spacing:2px;margin-top:16px;margin-bottom:8px}
.empty .hint{font-size:12px}
.msg{margin-bottom:16px;animation:msgIn .35s cubic-bezier(.16,1,.3,1)}
@keyframes msgIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.msg.user .msg-body{background:${TRUE_TONE.userBubbleBg};border:1px solid rgba(168,85,247,0.25);border-radius:18px 18px 4px 18px;padding:12px 16px;margin-left:40px}
.msg.assistant .msg-body{background:${TRUE_TONE.bubbleBg};border:1px solid rgba(255,255,255,0.06);border-radius:18px 18px 18px 4px;padding:12px 16px;margin-right:40px}
.msg-main{white-space:pre-wrap;line-height:1.6}
.msg-attachments{display:flex;gap:8px;margin-bottom:8px}
.msg-attachments .attachment{width:60px;height:60px;border-radius:10px;overflow:hidden}
.msg-attachments img{width:100%;height:100%;object-fit:cover}
.skill-badge{display:inline-block;padding:4px 10px;margin-bottom:8px;border:1px solid var(--skill-color);border-radius:12px;font-size:10px;font-weight:600;color:var(--skill-color)}
.terminal-text{display:inline}
.terminal-cursor{display:inline-block;width:8px;color:${TRUE_TONE.accent};animation:cursorBlink 1s steps(2) infinite;margin-left:2px}
@keyframes cursorBlink{0%,100%{opacity:1}50%{opacity:0}}
.cog-pill{margin-bottom:12px;background:var(--pill-bg);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;animation:pillIn .3s cubic-bezier(.16,1,.3,1)}
@keyframes pillIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pill-head{display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;background:transparent;border:none;color:var(--pill-color);font-size:12px;font-weight:500;cursor:pointer;text-align:left;transition:all .2s}
.pill-head:hover{background:rgba(255,255,255,0.02)}
.pill-icon{width:24px;height:24px;border-radius:7px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center}
.pill-head>span{flex:1}
.pill-live{padding:2px 6px;background:var(--pill-color);color:#000;border-radius:4px;font-size:9px;font-weight:700;animation:livePulse 1.5s ease-in-out infinite}
@keyframes livePulse{0%,100%{opacity:1}50%{opacity:.6}}
.pill-chevron{color:${TRUE_TONE.textMuted};transition:transform .2s}
.pill-body{padding:12px 14px;border-top:1px solid rgba(255,255,255,0.05);font-size:13px;line-height:1.6;max-height:300px;overflow-y:auto}
.pill-body.code{background:${TRUE_TONE.codeBg};font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px}
.pill-body pre{margin:0;white-space:pre-wrap}
.pill-body.vision{display:flex;flex-direction:column;gap:12px}
.pill-body.vision img{max-width:100%;border-radius:10px}
.file-pill,.code-pill{margin-bottom:12px;background:rgba(168,85,247,0.04);border:1px solid rgba(168,85,247,0.15);border-radius:14px;overflow:hidden}
.file-pill .pill-head,.code-pill .pill-head{color:#c084fc}
.pill-actions{display:flex;align-items:center;gap:4px}
.action-btn{padding:6px;background:transparent;border:none;color:inherit;cursor:pointer;opacity:.6;border-radius:6px;transition:all .15s}
.action-btn:hover{opacity:1;background:rgba(255,255,255,0.08)}
.lang-tag{padding:2px 8px;background:rgba(255,255,255,0.08);border-radius:6px;font-size:10px;font-weight:600;color:var(--code-color)}
.file-name{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vision-pill{margin-bottom:12px;background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.15);border-radius:14px;overflow:hidden}
.vision-pill .pill-head{color:#4ade80}
.message-actions{display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05)}
.message-actions button{display:flex;align-items:center;gap:4px;padding:6px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;color:${TRUE_TONE.textMuted};font-size:11px;cursor:pointer;transition:all .15s}
.message-actions button:hover{background:rgba(255,255,255,0.08);color:#fff}
.input-area{padding:12px 16px;padding-bottom:max(12px,env(safe-area-inset-bottom));background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.05)}
.active-skill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;margin-bottom:8px;border:1px solid;border-radius:12px;font-size:11px;font-weight:500}
.active-skill button{padding:2px;background:transparent;border:none;color:inherit;cursor:pointer}
.attachments{display:flex;gap:8px;margin-bottom:8px}
.att-preview{position:relative;width:60px;height:60px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.05)}
.att-preview img{width:100%;height:100%;object-fit:cover}
.att-preview .att-file{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${TRUE_TONE.textMuted}}
.att-preview button{position:absolute;top:2px;right:2px;padding:4px;background:rgba(0,0,0,0.6);border:none;border-radius:50%;color:#fff;cursor:pointer}
.input-row{display:flex;align-items:flex-end;gap:8px}
.ctrl-btn{padding:12px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:${TRUE_TONE.textMuted};cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1)}
.ctrl-btn:hover,.ctrl-btn.active{background:rgba(168,85,247,0.15);color:${TRUE_TONE.accent};border-color:rgba(168,85,247,0.3)}
.ctrl-btn input{display:none}
.input-row textarea{flex:1;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:20px;color:#fff;font-size:14px;resize:none;outline:none;max-height:120px;transition:all .2s}
.input-row textarea:focus{border-color:rgba(168,85,247,0.5);background:rgba(255,255,255,0.05)}
.input-row textarea::placeholder{color:${TRUE_TONE.textMuted}}
.send-btn{padding:12px;background:linear-gradient(135deg,#a855f7,#6366f1);border:none;border-radius:50%;color:#fff;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1)}
.send-btn:hover:not(:disabled){transform:scale(1.08);box-shadow:0 0 24px ${TRUE_TONE.accentGlow}}
.send-btn:active{transform:scale(.95)}
.send-btn:disabled{opacity:.5;cursor:not-allowed}
.send-btn.stop{background:#ef4444}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;animation:fadeIn .2s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.sidebar{position:fixed;top:0;left:0;bottom:0;width:280px;background:rgba(12,12,16,0.98);backdrop-filter:blur(20px);border-right:1px solid rgba(255,255,255,0.08);z-index:201;display:flex;flex-direction:column;animation:slideIn .3s cubic-bezier(.16,1,.3,1)}
@keyframes slideIn{from{transform:translateX(-100%)}to{transform:none}}
.sidebar-head{display:flex;align-items:center;justify-content:space-between;padding:16px;font-size:14px;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.05)}
.sidebar-head button{padding:8px;background:transparent;border:none;color:rgba(255,255,255,0.5);cursor:pointer}
.new-btn{display:flex;align-items:center;justify-content:center;gap:8px;margin:12px;padding:12px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:12px;color:${TRUE_TONE.accent};font-size:13px;font-weight:500;cursor:pointer;transition:all .2s}
.new-btn:hover{background:rgba(168,85,247,0.25)}
.conv-list{flex:1;overflow-y:auto;padding:0 8px}
.conv-row{display:flex;align-items:center;gap:10px;padding:12px;margin-bottom:4px;border-radius:10px;color:${TRUE_TONE.textSecondary};font-size:13px;cursor:pointer;transition:all .15s}
.conv-row:hover{background:rgba(255,255,255,0.05)}
.conv-row.active{background:rgba(168,85,247,0.15);color:#fff}
.conv-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.del-btn{padding:6px;background:transparent;border:none;color:rgba(255,255,255,0.3);cursor:pointer;opacity:0;transition:opacity .15s}
.conv-row:hover .del-btn{opacity:1}
.del-btn:hover{color:#ef4444}
.empty-conv{padding:20px;text-align:center;color:${TRUE_TONE.textMuted};font-size:12px}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:300;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s}
.modal{width:90%;max-width:400px;background:rgba(16,16,20,0.98);border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;animation:modalIn .3s cubic-bezier(.16,1,.3,1)}
@keyframes modalIn{from{opacity:0;transform:scale(.95) translateY(20px)}to{opacity:1;transform:none}}
.modal-head{display:flex;align-items:center;gap:10px;padding:16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;font-weight:600}
.modal-head button{margin-left:auto;padding:6px;background:transparent;border:none;color:${TRUE_TONE.textMuted};cursor:pointer;border-radius:6px}
.modal-head button:hover{background:rgba(255,255,255,0.08)}
.modal-body{padding:16px;max-height:60vh;overflow-y:auto}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px;border-top:1px solid rgba(255,255,255,0.05)}
.btn-sec{padding:10px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:${TRUE_TONE.textSecondary};font-size:13px;cursor:pointer;transition:all .15s}
.btn-sec:hover{background:rgba(255,255,255,0.1)}
.btn-pri{display:flex;align-items:center;gap:6px;padding:10px 16px;background:linear-gradient(135deg,#a855f7,#6366f1);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.btn-pri:hover:not(:disabled){transform:scale(1.02);box-shadow:0 4px 20px ${TRUE_TONE.accentGlow}}
.btn-pri:disabled{opacity:.5;cursor:not-allowed}
.field-label{display:block;font-size:11px;color:${TRUE_TONE.textMuted};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;margin-top:12px}
.field-label:first-child{margin-top:0}
.field-input,.field-textarea,.field-select{width:100%;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:#fff;font-size:13px;outline:none;transition:all .15s}
.field-input:focus,.field-textarea:focus,.field-select:focus{border-color:rgba(168,85,247,0.5)}
.field-textarea{resize:none}
.field-select{cursor:pointer}
.toggle-field{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12px;color:${TRUE_TONE.textSecondary};cursor:pointer}
.toggle-field input{width:16px;height:16px}
.artifact-preview{background:${TRUE_TONE.codeBg};border-radius:10px;padding:12px;max-height:200px;overflow-y:auto}
.artifact-preview pre{margin:0;font-size:11px;color:${TRUE_TONE.textSecondary};white-space:pre-wrap}
.export-list{display:flex;flex-direction:column;gap:8px}
.export-item{display:flex;align-items:flex-start;gap:10px;padding:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;color:${TRUE_TONE.textSecondary};font-size:12px;text-align:left;cursor:pointer;transition:all .15s}
.export-item:hover{background:rgba(255,255,255,0.05)}
.export-item.selected{background:rgba(168,85,247,0.1);border-color:rgba(168,85,247,0.3)}
.export-item .check{width:20px;height:20px;border:1px solid rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${TRUE_TONE.accent}}
.export-item.selected .check{background:${TRUE_TONE.accent};border-color:${TRUE_TONE.accent};color:#000}
.md-content{line-height:1.6}
.md-heading{font-size:15px;font-weight:700;color:#fff;margin:16px 0 8px}
.md-subheading{font-size:14px;font-weight:600;color:${TRUE_TONE.textSecondary};margin:12px 0 6px}
.md-line{margin:4px 0}
.md-break{height:8px}
.md-shimmer{color:${TRUE_TONE.accent};font-style:italic;text-shadow:0 0 10px ${TRUE_TONE.accentGlow}}
.md-italic{font-style:italic;color:${TRUE_TONE.textSecondary}}
.md-inline-code{padding:2px 6px;background:${TRUE_TONE.codeBg};border-radius:4px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px;color:#e879f9}
@media(max-width:600px){.panel{right:5px;left:5px;width:auto;max-width:none}.msg.user .msg-body,.msg.assistant .msg-body{margin-left:0;margin-right:0}.skills-grid{grid-template-columns:repeat(4,1fr)}}
@media(prefers-reduced-motion:reduce){*,.panel,.msg,.cog-pill,.modal{animation:none !important;transition-duration:.01ms !important}.terminal-cursor,.pill-live{animation:none}}
      `}</style>
    </div>
  );
}
