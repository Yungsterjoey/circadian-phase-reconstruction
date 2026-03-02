/**
 * KURO::MEDIA v1.0 — AI Media Generation & Enhancement
 *
 * GPU-backed image/video generation (FLUX, Hunyuan) and enhancement
 * (upscale, face restore, background removal). Proxied through
 * /api/media/* endpoints to a dedicated inference server.
 *
 * State machine: consent gate -> server status -> wake flow -> main UI
 * Auto-sleep after 15 min idle. All CSS prefixed km-.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Image, Video, Wand2, Sparkles, Eraser, ZoomIn,
  Moon, Sun, Download, Loader, Play, ChevronDown, ChevronUp,
  AlertTriangle, Check, X, Clock, Power,
} from 'lucide-react';


/* ==========================================================================
   AUTH HELPER
   ========================================================================== */
function getToken() {
  return localStorage.getItem('kuro_token') || '';
}

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      'X-KURO-Token': getToken(),
      ...opts.headers,
    },
  });
}

function apiJSON(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function haptic(pattern = [3]) {
  try { navigator.vibrate?.(pattern); } catch {}
}


/* ==========================================================================
   CONSTANTS
   ========================================================================== */
const CONSENT_KEY = 'kuro_media_consent';
const IDLE_WARNING_MS = 10 * 60 * 1000; // 10 min
const IDLE_SLEEP_MS = 15 * 60 * 1000;   // 15 min

const ENHANCE_OPS = [
  { id: 'upscale', label: 'Upscale', icon: ZoomIn },
  { id: 'face_restore', label: 'Face Restore', icon: Sparkles },
  { id: 'remove_bg', label: 'Remove BG', icon: Eraser },
];

const GEN_MODES = [
  { id: 'photo', label: 'Photo (FLUX)', icon: Image },
  { id: 'video', label: 'Video (Hunyuan)', icon: Video },
];

const PHOTO_DEFAULTS = { width: 1024, height: 1024, steps: 30, seed: -1 };
const VIDEO_DEFAULTS = { width: 832, height: 544, steps: 50, frames: 49, seed: -1 };


/* ==========================================================================
   ELAPSED TIMER HOOK
   ========================================================================== */
function useElapsedTimer(running) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (!running) { setElapsed(0); startRef.current = null; return; }
    startRef.current = Date.now();
    const iv = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(iv);
  }, [running]);

  return elapsed;
}

function fmtElapsed(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}


/* ==========================================================================
   IDLE TRACKER HOOK
   ========================================================================== */
function useIdleTracker(serverOnline, onSleep) {
  const lastActivityRef = useRef(Date.now());
  const [idleWarning, setIdleWarning] = useState(null); // seconds remaining, or null

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleWarning(null);
  }, []);

  useEffect(() => {
    if (!serverOnline) return;
    const iv = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= IDLE_SLEEP_MS) {
        setIdleWarning(null);
        onSleep();
      } else if (idle >= IDLE_WARNING_MS) {
        const remaining = Math.ceil((IDLE_SLEEP_MS - idle) / 1000);
        setIdleWarning(remaining);
      } else {
        setIdleWarning(null);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [serverOnline, onSleep]);

  return { idleWarning, touch };
}


/* ==========================================================================
   CONSENT GATE
   ========================================================================== */
function ConsentGate({ onAccept }) {
  return (
    <div className="km-consent">
      <div className="km-consent-card">
        <div className="km-consent-icon">
          <Wand2 size={40} strokeWidth={1.5} />
        </div>
        <h2 className="km-consent-title">KURO::MEDIA</h2>
        <p className="km-consent-subtitle">AI Image & Video Generation</p>
        <div className="km-consent-divider" />
        <p className="km-consent-text">
          Your media is processed on a dedicated GPU instance. No data leaves KURO infrastructure.
          Generated outputs are stored temporarily and auto-deleted after 24 hours.
        </p>
        <p className="km-consent-text km-consent-text-dim">
          By continuing, you agree to use this tool responsibly and in accordance with the KURO Terms of Service.
        </p>
        <button className="km-btn km-btn-primary km-consent-accept" onClick={() => { haptic(); onAccept(); }}>
          <Check size={16} /> Accept & Continue
        </button>
      </div>
    </div>
  );
}


/* ==========================================================================
   SLEEPING / WAKE SCREEN
   ========================================================================== */
function SleepScreen({ onWake, waking, wakeStatus }) {
  return (
    <div className="km-sleep">
      <div className="km-sleep-card">
        <div className="km-sleep-icon">
          <Moon size={48} strokeWidth={1.2} />
        </div>
        <h2 className="km-sleep-title">KURO::MEDIA is sleeping</h2>
        <p className="km-sleep-sub">The GPU instance is powered down to save resources.</p>
        {waking ? (
          <div className="km-wake-status">
            <Loader size={18} className="km-spin" />
            <span>{wakeStatus || 'Starting GPU instance...'}</span>
          </div>
        ) : (
          <button className="km-btn km-btn-primary km-wake-btn" onClick={() => { haptic([3, 50, 3]); onWake(); }}>
            <Power size={16} /> Wake GPU
          </button>
        )}
      </div>
    </div>
  );
}


/* ==========================================================================
   ENHANCE TAB
   ========================================================================== */
function EnhanceTab({ touch }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [operation, setOperation] = useState('upscale');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const elapsed = useElapsedTimer(processing);

  const handleFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  }, [handleFile]);

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);

  const doEnhance = useCallback(async () => {
    if (!file || processing) return;
    haptic();
    touch();
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('operation', operation);
      const res = await api('/api/media/enhance', { method: 'POST', body: fd });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setResult(data.output_url);
    } catch (e) {
      setError(e.message);
    }
    setProcessing(false);
  }, [file, operation, processing, touch]);

  const clearFile = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="km-enhance">
      {/* Drop zone */}
      {!preview ? (
        <div
          className={`km-dropzone ${dragOver ? 'km-dropzone-active' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <Upload size={32} strokeWidth={1.5} className="km-dropzone-icon" />
          <p className="km-dropzone-text">Drop image here or tap to upload</p>
          <p className="km-dropzone-hint">PNG, JPG, WebP up to 20MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="km-hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="km-preview-wrap">
          <button className="km-preview-clear" onClick={clearFile}><X size={14} /></button>
          <img src={preview} alt="Input" className="km-preview-img" />
        </div>
      )}

      {/* Operation selector */}
      <div className="km-ops">
        {ENHANCE_OPS.map(op => {
          const Icon = op.icon;
          return (
            <button
              key={op.id}
              className={`km-pill ${operation === op.id ? 'km-pill-active' : ''}`}
              onClick={() => { haptic(); setOperation(op.id); }}
            >
              <Icon size={14} /> {op.label}
            </button>
          );
        })}
      </div>

      {/* Enhance button */}
      <button
        className="km-btn km-btn-primary km-enhance-go"
        disabled={!file || processing}
        onClick={doEnhance}
      >
        {processing ? (
          <><Loader size={16} className="km-spin" /> Processing... {fmtElapsed(elapsed)}</>
        ) : (
          <><Wand2 size={16} /> Enhance</>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="km-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="km-result">
          <div className="km-result-label">Result</div>
          <div className="km-result-compare">
            {preview && (
              <div className="km-result-side">
                <span className="km-result-tag">Original</span>
                <img src={preview} alt="Original" className="km-result-img" />
              </div>
            )}
            <div className="km-result-side">
              <span className="km-result-tag">Enhanced</span>
              <img src={result} alt="Enhanced" className="km-result-img" />
            </div>
          </div>
          <a href={result} download className="km-btn km-btn-secondary km-dl-btn">
            <Download size={16} /> Download
          </a>
        </div>
      )}
    </div>
  );
}


/* ==========================================================================
   GENERATE TAB
   ========================================================================== */
function GenerateTab({ touch }) {
  const [mode, setMode] = useState('photo');
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState({ ...PHOTO_DEFAULTS });
  const [paramsOpen, setParamsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const elapsed = useElapsedTimer(generating);

  // Sync defaults when mode changes
  useEffect(() => {
    setParams(mode === 'video' ? { ...VIDEO_DEFAULTS } : { ...PHOTO_DEFAULTS });
  }, [mode]);

  const setParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const doGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    haptic();
    touch();
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        prompt: prompt.trim(),
        width: params.width,
        height: params.height,
        steps: params.steps,
        seed: params.seed,
      };
      if (mode === 'video') body.frames = params.frames;

      const endpoint = mode === 'video' ? '/api/media/generate/video' : '/api/media/generate/photo';
      const res = await apiJSON(endpoint, body);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setResult({ url: data.output_url, type: mode });
    } catch (e) {
      setError(e.message);
    }
    setGenerating(false);
  }, [prompt, params, mode, generating, touch]);

  return (
    <div className="km-generate">
      {/* Mode selector */}
      <div className="km-ops">
        {GEN_MODES.map(m => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              className={`km-pill ${mode === m.id ? 'km-pill-active' : ''}`}
              onClick={() => { haptic(); setMode(m.id); setResult(null); setError(null); }}
            >
              <Icon size={14} /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Prompt */}
      <textarea
        className="km-prompt"
        placeholder="Describe what you want to create..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
      />

      {/* Parameters */}
      <button
        className="km-params-toggle"
        onClick={() => { haptic(); setParamsOpen(p => !p); }}
      >
        Parameters {paramsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {paramsOpen && (
        <div className="km-params">
          <div className="km-param-row">
            <label>Width</label>
            <input
              type="number"
              value={params.width}
              onChange={(e) => setParam('width', parseInt(e.target.value) || 512)}
              min={256} max={2048} step={64}
            />
          </div>
          <div className="km-param-row">
            <label>Height</label>
            <input
              type="number"
              value={params.height}
              onChange={(e) => setParam('height', parseInt(e.target.value) || 512)}
              min={256} max={2048} step={64}
            />
          </div>
          <div className="km-param-row">
            <label>Steps</label>
            <input
              type="number"
              value={params.steps}
              onChange={(e) => setParam('steps', parseInt(e.target.value) || 20)}
              min={1} max={150}
            />
          </div>
          {mode === 'video' && (
            <div className="km-param-row">
              <label>Frames</label>
              <input
                type="number"
                value={params.frames}
                onChange={(e) => setParam('frames', parseInt(e.target.value) || 25)}
                min={1} max={120}
              />
            </div>
          )}
          <div className="km-param-row">
            <label>Seed</label>
            <input
              type="number"
              value={params.seed}
              onChange={(e) => setParam('seed', parseInt(e.target.value))}
              placeholder="-1 = random"
            />
          </div>
        </div>
      )}

      {/* Generate button */}
      <button
        className="km-btn km-btn-primary km-gen-go"
        disabled={!prompt.trim() || generating}
        onClick={doGenerate}
      >
        {generating ? (
          <><Loader size={16} className="km-spin" /> Generating... {fmtElapsed(elapsed)}</>
        ) : (
          <><Sparkles size={16} /> Generate {mode === 'video' ? 'Video' : 'Photo'}</>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="km-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="km-result">
          <div className="km-result-label">Output</div>
          {result.type === 'video' ? (
            <video
              src={result.url}
              controls
              playsInline
              className="km-result-media"
            />
          ) : (
            <img src={result.url} alt="Generated" className="km-result-media" />
          )}
          <a href={result.url} download className="km-btn km-btn-secondary km-dl-btn">
            <Download size={16} /> Download
          </a>
        </div>
      )}
    </div>
  );
}


/* ==========================================================================
   MAIN APP COMPONENT
   ========================================================================== */
export default function KuroMediaApp() {
  /* ── Consent ── */
  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === '1');

  const acceptConsent = useCallback(() => {
    localStorage.setItem(CONSENT_KEY, '1');
    setConsented(true);
  }, []);

  /* ── Server status ── */
  const [serverStatus, setServerStatus] = useState('checking'); // checking | offline | waking | online | error
  const [wakeStatus, setWakeStatus] = useState('');
  const [activeTab, setActiveTab] = useState('enhance');

  const checkStatus = useCallback(async () => {
    try {
      const res = await api('/api/media/status');
      if (!res.ok) throw new Error('Status check failed');
      const data = await res.json();
      if (data.waking) setServerStatus('waking');
      else if (data.online) setServerStatus('online');
      else setServerStatus('offline');
    } catch {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    if (consented) checkStatus();
  }, [consented, checkStatus]);

  /* ── Wake via SSE ── */
  const doWake = useCallback(() => {
    setServerStatus('waking');
    setWakeStatus('Starting GPU instance...');

    const ctrl = new AbortController();
    api('/api/media/wake', { method: 'POST', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Wake failed');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'waking') {
                setWakeStatus(evt.message || 'Provisioning GPU...');
              } else if (evt.type === 'ready') {
                setServerStatus('online');
                return;
              } else if (evt.type === 'error') {
                setServerStatus('offline');
                setWakeStatus('');
                return;
              }
            } catch {}
          }
        }
        // Stream ended without ready event -- check status
        await checkStatus();
      })
      .catch(() => {
        setServerStatus('offline');
        setWakeStatus('');
      });

    return () => ctrl.abort();
  }, [checkStatus]);

  /* ── Auto-sleep ── */
  const doSleep = useCallback(async () => {
    try {
      await api('/api/media/sleep', { method: 'POST' });
    } catch {}
    setServerStatus('offline');
  }, []);

  const { idleWarning, touch } = useIdleTracker(serverStatus === 'online', doSleep);

  /* ── Render ── */
  if (!consented) {
    return (
      <div className="km-root">
        <ConsentGate onAccept={acceptConsent} />
        <MediaStyles />
      </div>
    );
  }

  if (serverStatus === 'checking') {
    return (
      <div className="km-root">
        <div className="km-loading">
          <Loader size={24} className="km-spin" />
          <span>Connecting to KURO::MEDIA...</span>
        </div>
        <MediaStyles />
      </div>
    );
  }

  if (serverStatus === 'offline' || serverStatus === 'waking') {
    return (
      <div className="km-root">
        <SleepScreen
          onWake={doWake}
          waking={serverStatus === 'waking'}
          wakeStatus={wakeStatus}
        />
        <MediaStyles />
      </div>
    );
  }

  return (
    <div className="km-root">
      {/* Idle warning chip */}
      {idleWarning !== null && (
        <div className="km-idle-chip">
          <Clock size={13} />
          GPU idle — will sleep in {Math.ceil(idleWarning / 60)}m
          <button className="km-idle-dismiss" onClick={() => { haptic(); touch(); }}>Keep Awake</button>
        </div>
      )}

      {/* Tab bar */}
      <div className="km-tabs">
        <button
          className={`km-tab ${activeTab === 'enhance' ? 'km-tab-active' : ''}`}
          onClick={() => { haptic(); setActiveTab('enhance'); }}
        >
          <Wand2 size={15} /> ENHANCE
        </button>
        <button
          className={`km-tab ${activeTab === 'generate' ? 'km-tab-active' : ''}`}
          onClick={() => { haptic(); setActiveTab('generate'); }}
        >
          <Sparkles size={15} /> GENERATE
        </button>
      </div>

      {/* Content */}
      <div className="km-content">
        {activeTab === 'enhance' ? (
          <EnhanceTab touch={touch} />
        ) : (
          <GenerateTab touch={touch} />
        )}
      </div>

      <MediaStyles />
    </div>
  );
}


/* ==========================================================================
   STYLES
   ========================================================================== */
function MediaStyles() {
  return (
    <style>{`
/* ── Root ─────────────────────────────────────────────────────────────── */
.km-root {
  width: 100%; height: 100%;
  background: #000;
  color: #f5f5f7;
  font-family: -apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
  font-size: 15px;
  display: flex; flex-direction: column;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  position: relative;
}

/* ── Idle chip ────────────────────────────────────────────────────────── */
.km-idle-chip {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  z-index: 50;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 20px;
  font-size: 12px; color: #f59e0b;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  white-space: nowrap;
  animation: km-fadeIn 0.3s ease;
}
.km-idle-dismiss {
  background: rgba(245, 158, 11, 0.2);
  border: none; border-radius: 10px;
  color: #f59e0b; font-size: 11px; font-weight: 600;
  padding: 3px 10px; cursor: pointer;
  margin-left: 4px;
}
.km-idle-dismiss:active { opacity: 0.7; }

/* ── Tabs ─────────────────────────────────────────────────────────────── */
.km-tabs {
  display: flex; gap: 2px;
  padding: 8px 12px 0;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.km-tab {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 0 8px;
  background: none; border: none;
  color: rgba(255,255,255,0.4);
  font-size: 12px; font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  min-height: 44px;
}
.km-tab-active {
  color: #a855f7;
  border-bottom-color: #a855f7;
}
.km-tab:active { opacity: 0.7; }

/* ── Content scroll ───────────────────────────────────────────────────── */
.km-content {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  padding: 16px 14px 24px;
  -webkit-overflow-scrolling: touch;
}

/* ── Loading ──────────────────────────────────────────────────────────── */
.km-loading {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: rgba(255,255,255,0.5); font-size: 14px;
}

/* ── Consent gate ─────────────────────────────────────────────────────── */
.km-consent {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.km-consent-card {
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 32px 24px;
  max-width: 380px; width: 100%;
  text-align: center;
  animation: km-fadeIn 0.4s ease;
}
.km-consent-icon {
  color: #a855f7;
  margin-bottom: 16px;
}
.km-consent-title {
  font-size: 22px; font-weight: 700;
  letter-spacing: 1px;
  margin: 0 0 4px;
}
.km-consent-subtitle {
  font-size: 13px; color: rgba(255,255,255,0.45);
  margin: 0 0 16px;
}
.km-consent-divider {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 0 0 16px;
}
.km-consent-text {
  font-size: 13px; line-height: 1.6;
  color: rgba(255,255,255,0.7);
  margin: 0 0 12px;
}
.km-consent-text-dim { color: rgba(255,255,255,0.35); font-size: 12px; }
.km-consent-accept { margin-top: 8px; width: 100%; }

/* ── Sleep / Wake ─────────────────────────────────────────────────────── */
.km-sleep {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.km-sleep-card {
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  padding: 40px 24px;
  max-width: 380px; width: 100%;
  text-align: center;
  animation: km-fadeIn 0.4s ease;
}
.km-sleep-icon { color: rgba(255,255,255,0.25); margin-bottom: 20px; }
.km-sleep-title {
  font-size: 20px; font-weight: 700;
  margin: 0 0 8px;
}
.km-sleep-sub {
  font-size: 13px; color: rgba(255,255,255,0.4);
  margin: 0 0 24px;
}
.km-wake-status {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  color: #a855f7; font-size: 14px;
  animation: km-fadeIn 0.3s ease;
}
.km-wake-btn { width: 100%; }

/* ── Buttons ──────────────────────────────────────────────────────────── */
.km-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 20px;
  border: none; border-radius: 12px;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  min-height: 44px;
  font-family: inherit;
}
.km-btn:active { transform: scale(0.97); opacity: 0.85; }
.km-btn:disabled { opacity: 0.35; pointer-events: none; }
.km-btn-primary {
  background: #a855f7; color: #fff;
}
.km-btn-secondary {
  background: rgba(168,85,247,0.12);
  color: #a855f7;
  border: 1px solid rgba(168,85,247,0.25);
}

/* ── Pills ────────────────────────────────────────────────────────────── */
.km-ops {
  display: flex; gap: 8px;
  margin: 14px 0;
  flex-wrap: wrap;
}
.km-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  color: rgba(255,255,255,0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 44px;
  font-family: inherit;
}
.km-pill-active {
  background: rgba(168,85,247,0.15);
  border-color: rgba(168,85,247,0.4);
  color: #a855f7;
}
.km-pill:active { transform: scale(0.96); }

/* ── Drop zone ────────────────────────────────────────────────────────── */
.km-dropzone {
  width: 100%; height: 200px;
  background: rgba(28,28,30,1);
  border: 2px dashed rgba(255,255,255,0.1);
  border-radius: 16px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.km-dropzone:active { opacity: 0.85; }
.km-dropzone-active {
  border-color: #a855f7;
  box-shadow: 0 0 24px rgba(168,85,247,0.2), inset 0 0 24px rgba(168,85,247,0.05);
}
.km-dropzone-icon { color: rgba(255,255,255,0.25); }
.km-dropzone-text { color: rgba(255,255,255,0.5); font-size: 14px; margin: 0; }
.km-dropzone-hint { color: rgba(255,255,255,0.25); font-size: 12px; margin: 0; }

/* ── Preview ──────────────────────────────────────────────────────────── */
.km-preview-wrap {
  position: relative;
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  overflow: hidden;
  max-height: 240px;
  display: flex; align-items: center; justify-content: center;
}
.km-preview-img {
  width: 100%; max-height: 240px;
  object-fit: contain;
}
.km-preview-clear {
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(0,0,0,0.7);
  border: 1px solid rgba(255,255,255,0.15);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 2;
}
.km-preview-clear:active { opacity: 0.7; }

/* ── Enhance action ───────────────────────────────────────────────────── */
.km-enhance-go, .km-gen-go { width: 100%; margin-top: 4px; }

/* ── Prompt textarea ──────────────────────────────────────────────────── */
.km-prompt {
  width: 100%; box-sizing: border-box;
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px 16px;
  color: #f5f5f7;
  font-size: 16px; line-height: 1.5;
  font-family: inherit;
  resize: vertical;
  min-height: 100px;
  outline: none;
  transition: border-color 0.2s;
}
.km-prompt::placeholder { color: rgba(255,255,255,0.25); }
.km-prompt:focus { border-color: rgba(168,85,247,0.4); }

/* ── Parameters ───────────────────────────────────────────────────────── */
.km-params-toggle {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none;
  color: rgba(255,255,255,0.4);
  font-size: 13px; font-weight: 500;
  cursor: pointer; padding: 8px 0;
  min-height: 44px;
  font-family: inherit;
}
.km-params-toggle:active { opacity: 0.6; }
.km-params {
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 12px;
  animation: km-fadeIn 0.2s ease;
}
.km-param-row {
  display: flex; align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}
.km-param-row + .km-param-row {
  border-top: 1px solid rgba(255,255,255,0.04);
}
.km-param-row label {
  color: rgba(255,255,255,0.5);
  font-size: 13px;
}
.km-param-row input {
  width: 90px; text-align: right;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 6px 10px;
  color: #f5f5f7; font-size: 14px;
  font-family: inherit;
  outline: none;
  min-height: 36px;
}
.km-param-row input:focus { border-color: rgba(168,85,247,0.4); }

/* ── Error ────────────────────────────────────────────────────────────── */
.km-error {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 12px;
  color: #ef4444; font-size: 13px;
  margin-top: 12px;
  animation: km-fadeIn 0.2s ease;
}

/* ── Result ────────────────────────────────────────────────────────────── */
.km-result {
  margin-top: 16px;
  animation: km-fadeIn 0.35s ease;
}
.km-result-label {
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.35);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 10px;
}
.km-result-compare {
  display: flex; gap: 8px;
}
@media (max-width: 500px) {
  .km-result-compare { flex-direction: column; }
}
.km-result-side {
  flex: 1; position: relative;
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  overflow: hidden;
}
.km-result-tag {
  position: absolute; top: 8px; left: 8px;
  background: rgba(0,0,0,0.7);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 10px; font-weight: 600;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase; letter-spacing: 0.5px;
  z-index: 2;
}
.km-result-img {
  width: 100%; display: block;
  object-fit: contain;
  max-height: 300px;
}
.km-result-media {
  width: 100%; display: block;
  border-radius: 12px;
  background: rgba(28,28,30,1);
  border: 1px solid rgba(255,255,255,0.06);
  max-height: 400px;
  object-fit: contain;
}
.km-dl-btn {
  width: 100%;
  margin-top: 10px;
  text-decoration: none;
}

/* ── Hidden ───────────────────────────────────────────────────────────── */
.km-hidden { display: none; }

/* ── Spin animation ───────────────────────────────────────────────────── */
.km-spin { animation: km-rotate 1s linear infinite; }
@keyframes km-rotate { to { transform: rotate(360deg); } }

/* ── Fade in ──────────────────────────────────────────────────────────── */
@keyframes km-fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Scrollbar ────────────────────────────────────────────────────────── */
.km-content::-webkit-scrollbar { width: 4px; }
.km-content::-webkit-scrollbar-track { background: transparent; }
.km-content::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
}
    `}</style>
  );
}
