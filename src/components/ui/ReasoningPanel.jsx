/**
 * ReasoningPanel — KURO Phase 3.7
 *
 * Collapsible panel rendered above each assistant message.
 * Auto-expands during streaming to show live activity.
 * Shows: thinking steps, token count, elapsed time, tools, sources, runner.
 *
 * Props:
 *   meta       — { steps: [], tools: [], sources: [], runner: null, tokens: 0, model: '', elapsed: 0 }
 *   isStreaming — bool (true while model is generating)
 *
 * CSS lives in liquid-glass.css under the "ReasoningPanel" section.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, ChevronDown, ChevronUp,
  Check, AlertCircle, Clock,
  ExternalLink, Code, Activity, Cpu,
} from 'lucide-react';
import KuroCubeSpinner from './KuroCubeSpinner';

const EMPTY_META = { steps: [], tools: [], sources: [], runner: null, tokens: 0, model: '', elapsed: 0 };

const ReasoningPanel = ({ meta, isStreaming }) => {
  const [userToggled, setUserToggled] = useState(false);
  const [userWantsOpen, setUserWantsOpen] = useState(false);
  const prevStreamingRef = useRef(false);

  const { steps = [], tools = [], sources = [], runner = null, tokens = 0, model = '', elapsed = 0 } = meta || EMPTY_META;
  const hasContent = steps.length > 0 || tools.length > 0 || sources.length > 0 || runner != null || tokens > 0;

  // Auto-expand when streaming starts, collapse when it ends (unless user overrode)
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // Stream just started — auto-expand unless user explicitly closed
      if (!userToggled) setUserWantsOpen(true);
    }
    if (!isStreaming && prevStreamingRef.current) {
      // Stream ended — auto-collapse unless user explicitly opened
      if (!userToggled) setUserWantsOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, userToggled]);

  const open = userToggled ? userWantsOpen : (isStreaming || userWantsOpen);

  const handleToggle = () => {
    setUserToggled(true);
    setUserWantsOpen(v => !v);
  };

  // Don't render if nothing to show and not streaming
  if (!hasContent && !isStreaming) return null;

  // Elapsed time formatting
  const elapsedSec = elapsed > 0 ? (elapsed / 1000).toFixed(1) : null;
  // Tokens per second
  const tps = elapsed > 500 && tokens > 0 ? (tokens / (elapsed / 1000)).toFixed(1) : null;

  // Latest step for the header label
  const latestStep = steps.length > 0 ? steps[steps.length - 1].text : null;

  return (
    <div className={`rp${isStreaming ? ' rp-live' : ''}`}>
      <button
        className="rp-header"
        onClick={handleToggle}
        aria-expanded={open}
        type="button"
      >
        <span className="rp-icon">
          {isStreaming ? <KuroCubeSpinner size="xs" /> : <Brain size={13} />}
        </span>
        <span className="rp-label">
          {isStreaming
            ? (latestStep || 'Processing\u2026')
            : (hasContent ? 'Reasoning' : 'Done')}
        </span>
        {isStreaming && tokens > 0 && (
          <span className="rp-live-stats">
            <Activity size={10} />
            <span>{tokens} tok</span>
            {tps && <span>{tps}/s</span>}
          </span>
        )}
        {!isStreaming && tokens > 0 && (
          <span className="rp-done-stats">
            {tokens} tokens{elapsedSec && <> in {elapsedSec}s</>}
          </span>
        )}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="rp-body">

          {/* ── Live stream bar ── */}
          {isStreaming && (
            <div className="rp-stream-bar">
              <div className="rp-stream-fill" style={{ animationDuration: '2s' }} />
            </div>
          )}

          {/* ── Steps ── */}
          {steps.length > 0 && (
            <ul className="rp-steps">
              {steps.map((s, i) => (
                <li key={s.id} className={`rp-step${i === steps.length - 1 && isStreaming ? ' rp-step-active' : ''}`}>
                  <span className="rp-step-dot" />
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}

          {/* ── Model / perf summary ── */}
          {(model || tokens > 0) && !isStreaming && (
            <div className="rp-perf">
              {model && <span className="rp-perf-model"><Cpu size={10} />{model}</span>}
              {tokens > 0 && <span className="rp-perf-tok">{tokens} tokens</span>}
              {elapsedSec && <span className="rp-perf-time">{elapsedSec}s</span>}
              {tps && <span className="rp-perf-tps">{tps} tok/s</span>}
            </div>
          )}

          {/* ── Tools ── */}
          {tools.length > 0 && (
            <div className="rp-section">
              <div className="rp-section-title">Tools</div>
              {tools.map(t => (
                <div key={t.id} className={`rp-tool rp-tool-${t.status}`}>
                  {t.status === 'ok'      && <Check        size={11} />}
                  {t.status === 'error'   && <AlertCircle  size={11} />}
                  {t.status === 'pending' && <Clock        size={11} />}
                  <span className="rp-tool-name">{t.name}</span>
                  {t.durationMs != null && (
                    <span className="rp-tool-dur">{t.durationMs}ms</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Sources ── */}
          {sources.length > 0 && (
            <div className="rp-section">
              <div className="rp-section-title">Sources</div>
              <div className="rp-sources">
                {sources.slice(0, 5).map((r, i) => (
                  <a
                    key={i}
                    className="rp-source-card"
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="rp-source-num">{i + 1}</span>
                    <span className="rp-source-title">{r.title}</span>
                    <ExternalLink size={10} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ── Runner ── */}
          {runner && (
            <div className="rp-section">
              <div className="rp-section-title">Execution</div>
              <div className={`rp-runner rp-runner-${runner.status}`}>
                <Code size={11} />
                <span className="rp-runner-cmd">{runner.cmd}</span>
                <span className="rp-runner-badge">{runner.status}</span>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default ReasoningPanel;
