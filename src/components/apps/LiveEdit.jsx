/**
 * KURO::LIVE EDIT — Frontend Module
 * 
 * Strategy A: Abort & Restart
 * 
 * How it feels:
 *   1. KURO is streaming a response
 *   2. User starts typing in the input box
 *   3. After 2+ words and 500ms pause (or punctuation), correction detected
 *   4. Floating pill: "Redirect: <phrase>" with [Apply] [x]
 *   5. User clicks Apply (or Enter)
 *   6. "Adapting..." shown briefly
 *   7. New stream starts with correction context — feels like a pivot
 * 
 * Detection:
 *   - Only while assistant is streaming
 *   - 500ms pause OR punctuation (. , ? !)
 *   - Min 2 words / 8 chars, max 120 chars
 *   - Max 5 corrections/min (matches server)
 *   - Ignores pure deletion
 * 
 * Exports: useLiveEdit hook + LiveEditBar component
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Zap, X, ArrowRight, Loader2 } from 'lucide-react';

const DETECTION_DELAY_MS = 500;
const MIN_WORDS = 2;
const MIN_CHARS = 8;
const MAX_CHARS = 120;
const MAX_CORRECTIONS_PER_MIN = 5;
const PUNCTUATION = /[.,?!;:]$/;
const ADAPTING_DISPLAY_MS = 600;


// ═══════════════════════════════════════════════════════════════════════════
// useLiveEdit HOOK
// ═══════════════════════════════════════════════════════════════════════════
export function useLiveEdit({
  isStreaming,
  sessionId,
  activeId,
  messages,
  input,
  abortRef,
  sendMessage,
  updateMessages,
  setInput,
  setIsLoading,
  authHeaders,
}) {
  const [correctionPhrase, setCorrectionPhrase] = useState('');
  const [showBar, setShowBar] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [error, setError] = useState(null);

  const detectionTimer = useRef(null);
  const correctionTimestamps = useRef([]);
  const lastInputLength = useRef(0);

  // Reset on conversation change or stream end
  useEffect(() => {
    if (!isStreaming) {
      setCorrectionPhrase('');
      setShowBar(false);
      setAdapting(false);
    }
  }, [isStreaming, activeId]);

  // Detect correction phrase while streaming
  useEffect(() => {
    if (!isStreaming || !input) {
      clearTimeout(detectionTimer.current);
      if (!input) { setCorrectionPhrase(''); setShowBar(false); }
      return;
    }

    // Ignore pure deletion
    if (input.length < lastInputLength.current) {
      lastInputLength.current = input.length;
      return;
    }
    lastInputLength.current = input.length;

    const trimmed = input.trim();
    if (trimmed.length < MIN_CHARS) {
      setCorrectionPhrase(''); setShowBar(false);
      return;
    }

    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount < MIN_WORDS) return;

    // Immediate on punctuation
    if (PUNCTUATION.test(trimmed)) {
      setCorrectionPhrase(trimmed.slice(0, MAX_CHARS));
      setShowBar(true);
      return;
    }

    // Debounced on pause
    clearTimeout(detectionTimer.current);
    detectionTimer.current = setTimeout(() => {
      const current = input.trim();
      if (current.length >= MIN_CHARS && current.split(/\s+/).length >= MIN_WORDS) {
        setCorrectionPhrase(current.slice(0, MAX_CHARS));
        setShowBar(true);
      }
    }, DETECTION_DELAY_MS);

    return () => clearTimeout(detectionTimer.current);
  }, [input, isStreaming]);

  // Apply correction
  const applyCorrection = useCallback(async () => {
    if (!correctionPhrase || adapting) return;

    // Client-side rate limit
    const now = Date.now();
    correctionTimestamps.current = correctionTimestamps.current.filter(t => now - t < 60000);
    if (correctionTimestamps.current.length >= MAX_CORRECTIONS_PER_MIN) {
      setError('Too many corrections — wait a moment');
      setTimeout(() => setError(null), 3000);
      return;
    }
    correctionTimestamps.current.push(now);

    setAdapting(true);
    setShowBar(false);
    setError(null);

    try {
      // Tell server to abort current stream
      const hdrs = typeof authHeaders === 'function' ? authHeaders() : authHeaders;
      const res = await fetch('/api/stream/correct', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          sessionId: String(activeId),
          correction: correctionPhrase,
        }),
      });

      const result = await res.json();

      if (!result.accepted) {
        setAdapting(false);
        setError(result.reason || 'Correction rejected');
        setTimeout(() => setError(null), 3000);
        return;
      }

      const correction = correctionPhrase;
      const partialResponse = result.partialContent || '';
      setInput('');
      setCorrectionPhrase('');

      // Let abort propagate + show "Adapting..."
      await new Promise(r => setTimeout(r, ADAPTING_DISPLAY_MS));

      // Find last user message and build corrected version
      const msgs = [...messages];
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break; }
      }

      if (lastUserIdx === -1) { setAdapting(false); return; }

      // Context-aware correction: include what the model had already generated
      // so it can preserve good content and only pivot the relevant part
      let correctionContext = '';
      if (partialResponse.trim()) {
        correctionContext = `\n\n[You had begun responding with the following before the user redirected you:]\n"""\n${partialResponse.trim()}\n"""\n\n[User correction during response: ${correction}]\n\nIncorporate the user's correction. Preserve any useful content from your partial response above, but pivot to address the correction.`;
      } else {
        correctionContext = `\n\n[User correction during response: ${correction}]`;
      }

      const correctedMsg = {
        role: 'user',
        content: `${msgs[lastUserIdx].content}${correctionContext}`,
      };

      // Replace messages: keep up to last user, swap corrected, fresh assistant
      const newMessages = [
        ...msgs.slice(0, lastUserIdx),
        correctedMsg,
        { role: 'assistant', content: '', redactionCount: 0 },
      ];

      updateMessages(activeId, newMessages);
      setAdapting(false);
      sendMessage(correctedMsg);

    } catch (err) {
      setAdapting(false);
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    }
  }, [correctionPhrase, activeId, adapting, messages, updateMessages, sendMessage, setInput, authHeaders]);

  const dismiss = useCallback(() => {
    setCorrectionPhrase('');
    setShowBar(false);
  }, []);

  return {
    correctionPhrase,
    showBar: showBar && isStreaming && !!correctionPhrase,
    adapting,
    error,
    applyCorrection,
    dismiss,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// LiveEditBar COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export function LiveEditBar({ phrase, visible, adapting, error, onApply, onDismiss }) {
  if (!visible && !adapting && !error) return null;

  return (
    <div className="liveedit-container">
      {adapting && (
        <div className="liveedit-adapting">
          <Loader2 size={14} className="liveedit-spin" />
          <span>Adapting...</span>
        </div>
      )}

      {error && !adapting && (
        <div className="liveedit-error"><span>{error}</span></div>
      )}

      {visible && !adapting && !error && (
        <div className="liveedit-bar">
          <div className="liveedit-icon"><Zap size={14} /></div>
          <div className="liveedit-content">
            <span className="liveedit-label">Redirect</span>
            <span className="liveedit-phrase">{phrase}</span>
          </div>
          <button className="liveedit-apply" onClick={onApply}>
            <ArrowRight size={14} /><span>Apply</span>
          </button>
          <button className="liveedit-dismiss" onClick={onDismiss}><X size={14} /></button>
        </div>
      )}

      <style>{`
.liveedit-container {
  position: absolute;
  bottom: 100%;
  left: 0; right: 0;
  margin-bottom: 8px;
  z-index: 55;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.liveedit-container > * { pointer-events: all; }

.liveedit-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(168, 85, 247, 0.12);
  border: 1px solid rgba(168, 85, 247, 0.3);
  border-radius: 100px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  animation: liveeditIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  max-width: calc(100% - 32px);
}
@keyframes liveeditIn {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.liveedit-icon { display: flex; align-items: center; color: #a855f7; flex-shrink: 0; }
.liveedit-content { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.liveedit-label {
  font-size: 11px; font-weight: 600; color: #a855f7;
  text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0;
}
.liveedit-phrase {
  font-size: 13px; color: rgba(255,255,255,0.85);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}

.liveedit-apply {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 12px;
  background: rgba(168, 85, 247, 0.25);
  border: 1px solid rgba(168, 85, 247, 0.4);
  border-radius: 100px;
  color: #c084fc; font-size: 12px; font-weight: 500;
  cursor: pointer; flex-shrink: 0; transition: all 0.15s ease;
}
.liveedit-apply:hover { background: rgba(168, 85, 247, 0.4); color: white; }

.liveedit-dismiss {
  display: flex; align-items: center; padding: 4px;
  background: none; border: none;
  color: rgba(255,255,255,0.4); cursor: pointer;
  flex-shrink: 0; border-radius: 50%;
}
.liveedit-dismiss:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); }

.liveedit-adapting {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: rgba(168, 85, 247, 0.15);
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: 100px;
  backdrop-filter: blur(20px);
  animation: liveeditIn 0.2s ease;
  color: #c084fc; font-size: 13px; font-weight: 500;
}
.liveedit-spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.liveedit-error {
  padding: 6px 14px;
  background: rgba(255, 55, 95, 0.12);
  border: 1px solid rgba(255, 55, 95, 0.3);
  border-radius: 100px;
  backdrop-filter: blur(20px);
  animation: liveeditIn 0.2s ease;
  font-size: 12px; color: #ff6b8a;
}

@media (max-width: 768px) {
  .liveedit-bar { border-radius: 16px; padding: 8px 10px; gap: 8px; }
  .liveedit-label { display: none; }
  .liveedit-phrase { font-size: 12px; }
  .liveedit-apply span { display: none; }
}
      `}</style>
    </div>
  );
}
