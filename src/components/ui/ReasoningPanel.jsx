/**
 * ReasoningPanel — KURO Phase 3.6
 *
 * Collapsible panel rendered above each assistant message.
 * Shows high-level step summaries, tool execution, web sources,
 * and runner status — never raw <think> or chain-of-thought.
 *
 * Props:
 *   meta       — { steps: [], tools: [], sources: [], runner: null }
 *   isStreaming — bool (true while model is generating)
 *
 * CSS lives in liquid-glass.css under the "ReasoningPanel" section.
 */

import React, { useState } from 'react';
import {
  Brain, ChevronDown, ChevronUp,
  Check, AlertCircle, Clock,
  ExternalLink, Code,
} from 'lucide-react';
import KuroCubeSpinner from './KuroCubeSpinner';

const EMPTY_META = { steps: [], tools: [], sources: [], runner: null };

const ReasoningPanel = ({ meta, isStreaming }) => {
  const [open, setOpen] = useState(false);

  const { steps = [], tools = [], sources = [], runner = null } = meta || EMPTY_META;
  const hasContent = steps.length > 0 || tools.length > 0 || sources.length > 0 || runner != null;

  // Only render if there's something to show or the model is streaming
  if (!hasContent && !isStreaming) return null;

  return (
    <div className="rp">
      <button
        className="rp-header"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        type="button"
      >
        <span className="rp-icon">
          {isStreaming ? <KuroCubeSpinner size="xs" /> : <Brain size={13} />}
        </span>
        <span className="rp-label">
          {isStreaming && !hasContent ? 'Working\u2026' : 'Reasoning'}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="rp-body">

          {/* ── Steps ── */}
          {steps.length > 0 && (
            <ul className="rp-steps">
              {steps.map(s => (
                <li key={s.id} className="rp-step">
                  <span className="rp-step-dot" />
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
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
