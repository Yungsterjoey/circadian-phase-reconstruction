/**
 * KURO::LIVE EDIT — Frontend Module (mobile-tuned for KuroChatApp)
 *
 * Strategy A (abort & restart). Server already wired in server.cjs via
 * layers/liveedit/{stream_controller,liveedit_routes}.cjs.
 *
 * Mobile intent model:
 *   Typing while streaming opens a two-button pill:
 *     • Redirect now  → abort current stream, restart with correction context
 *     • Send next     → queue phrase, auto-send on clean stream completion
 *     • ✕             → dismiss, keep input
 *
 * Detection: ≥2 words, ≥8 chars, 500ms pause OR punctuation, ignore pure
 * deletion, truncate to 120 chars, client rate-limit 5/min (mirrors server).
 *
 * Keyboard-aware: pill rides visualViewport so it sits above the iOS keyboard.
 * Editing-aware: suppresses detection while a past-msg edit is open.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Zap, X, CornerDownRight, Loader2, ArrowRight } from 'lucide-react';

const DETECTION_DELAY_MS = 500;
const MIN_WORDS = 2;
const MIN_CHARS = 8;
const MAX_CHARS = 120;
const MAX_CORRECTIONS_PER_MIN = 5;
const PUNCTUATION = /[.,?!;:]$/;
const ADAPTING_DISPLAY_MS = 600;
const ERROR_DISPLAY_MS = 3000;


// ═══════════════════════════════════════════════════════════════════════════
// useLiveEdit HOOK
// ═══════════════════════════════════════════════════════════════════════════
export function useLiveEdit({
  isStreaming,
  activeId,
  messages,
  input,
  sendMessage,
  updateMessages,
  setInput,
  setIsLoading,
  authHeaders,
  editingActive,
}) {
  const [correctionPhrase, setCorrectionPhrase] = useState('');
  const [showBar, setShowBar] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [error, setError] = useState(null);
  const [queuedPhrase, setQueuedPhrase] = useState('');

  const detectionTimer = useRef(null);
  const correctionTimestamps = useRef([]);
  const lastInputLength = useRef(0);
  const prevStreamingRef = useRef(false);
  const abortedForCorrectionRef = useRef(false);
  const queueFiredForStreamRef = useRef(false);

  // Reset when conversation changes or stream ends
  useEffect(() => {
    if (!isStreaming) {
      setCorrectionPhrase('');
      setShowBar(false);
      setAdapting(false);
      clearTimeout(detectionTimer.current);
    }
  }, [isStreaming, activeId]);

  // Clear queue and pill on conversation switch
  useEffect(() => {
    setQueuedPhrase('');
    setCorrectionPhrase('');
    setShowBar(false);
    setError(null);
    abortedForCorrectionRef.current = false;
    queueFiredForStreamRef.current = false;
  }, [activeId]);

  // Detection: phrase recognition while streaming
  useEffect(() => {
    if (!isStreaming || editingActive || !input) {
      clearTimeout(detectionTimer.current);
      if (!input) { setCorrectionPhrase(''); setShowBar(false); }
      return;
    }

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

    if (PUNCTUATION.test(trimmed)) {
      setCorrectionPhrase(trimmed.slice(0, MAX_CHARS));
      setShowBar(true);
      return;
    }

    clearTimeout(detectionTimer.current);
    detectionTimer.current = setTimeout(() => {
      const current = input.trim();
      if (current.length >= MIN_CHARS && current.split(/\s+/).length >= MIN_WORDS) {
        setCorrectionPhrase(current.slice(0, MAX_CHARS));
        setShowBar(true);
      }
    }, DETECTION_DELAY_MS);

    return () => clearTimeout(detectionTimer.current);
  }, [input, isStreaming, editingActive]);

  // Queue auto-fire on clean stream completion (isStreaming true→false)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      if (abortedForCorrectionRef.current) {
        abortedForCorrectionRef.current = false;
        return;
      }
      if (queuedPhrase && !queueFiredForStreamRef.current) {
        queueFiredForStreamRef.current = true;
        const phrase = queuedPhrase;
        setQueuedPhrase('');
        setTimeout(() => {
          sendMessage({ role: 'user', content: phrase });
          queueFiredForStreamRef.current = false;
        }, 150);
      }
    }

    if (!wasStreaming && isStreaming) {
      queueFiredForStreamRef.current = false;
    }
  }, [isStreaming, queuedPhrase, sendMessage]);

  const checkRateLimit = () => {
    const now = Date.now();
    correctionTimestamps.current = correctionTimestamps.current.filter(t => now - t < 60000);
    if (correctionTimestamps.current.length >= MAX_CORRECTIONS_PER_MIN) return false;
    correctionTimestamps.current.push(now);
    return true;
  };

  const applyRedirect = useCallback(async () => {
    if (!correctionPhrase || adapting) return;

    if (!checkRateLimit()) {
      setError('Too many corrections — wait a moment');
      setTimeout(() => setError(null), ERROR_DISPLAY_MS);
      return;
    }

    navigator.vibrate?.([10]);
    setAdapting(true);
    setShowBar(false);
    setError(null);
    abortedForCorrectionRef.current = true;

    const phrase = correctionPhrase;
    const savedInput = input;

    try {
      const hdrs = typeof authHeaders === 'function' ? authHeaders() : (authHeaders || {});
      const res = await fetch('/api/stream/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...hdrs },
        body: JSON.stringify({
          sessionId: String(activeId),
          correction: phrase,
        }),
      });

      const result = await res.json();

      if (!result.accepted) {
        setAdapting(false);
        abortedForCorrectionRef.current = false;
        setError(result.reason || 'Correction rejected');
        setInput(savedInput);
        setTimeout(() => setError(null), ERROR_DISPLAY_MS);
        return;
      }

      setInput('');
      setCorrectionPhrase('');

      await new Promise(r => setTimeout(r, ADAPTING_DISPLAY_MS));

      const msgs = [...messages];
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx === -1) { setAdapting(false); return; }

      const correctedMsg = {
        role: 'user',
        content: `${msgs[lastUserIdx].content}\n\n[User correction during response: ${phrase}]`,
        isEdited: true,
      };

      const newMessages = [
        ...msgs.slice(0, lastUserIdx),
        correctedMsg,
        { role: 'assistant', content: '', redactionCount: 0 },
      ];

      updateMessages(activeId, newMessages);
      setAdapting(false);
      sendMessage(correctedMsg, { historyForPayload: [...msgs.slice(0, lastUserIdx), correctedMsg] });
    } catch (err) {
      setAdapting(false);
      abortedForCorrectionRef.current = false;
      setError(err.message || 'Network error');
      setInput(savedInput);
      setTimeout(() => setError(null), ERROR_DISPLAY_MS);
    }
  }, [correctionPhrase, adapting, activeId, messages, input, sendMessage, updateMessages, setInput, authHeaders]);

  const applyQueue = useCallback(() => {
    if (!correctionPhrase) return;
    navigator.vibrate?.([10, 30, 10]);
    setQueuedPhrase(correctionPhrase.slice(0, MAX_CHARS));
    setCorrectionPhrase('');
    setShowBar(false);
    setInput('');
  }, [correctionPhrase, setInput]);

  const dismiss = useCallback(() => {
    setCorrectionPhrase('');
    setShowBar(false);
  }, []);

  const cancelQueue = useCallback(() => {
    if (!queuedPhrase) return;
    navigator.vibrate?.([5]);
    setInput(prev => prev ? `${queuedPhrase} ${prev}` : queuedPhrase);
    setQueuedPhrase('');
  }, [queuedPhrase, setInput]);

  return {
    correctionPhrase,
    showBar: showBar && isStreaming && !!correctionPhrase && !editingActive,
    adapting,
    error,
    queuedPhrase,
    applyRedirect,
    applyQueue,
    dismiss,
    cancelQueue,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// LiveEditBar COMPONENT
// Portal-rendered, keyboard-aware, two-button intent pill.
// ═══════════════════════════════════════════════════════════════════════════
export function LiveEditBar({
  phrase, visible, adapting, error,
  queuedPhrase,
  onRedirect, onQueue, onDismiss, onCancelQueue,
}) {
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const reposition = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBottomOffset(kb);
    };
    reposition();
    vv.addEventListener('resize', reposition);
    vv.addEventListener('scroll', reposition);
    return () => {
      vv.removeEventListener('resize', reposition);
      vv.removeEventListener('scroll', reposition);
    };
  }, []);

  const showAny = visible || adapting || error || queuedPhrase;
  if (!showAny) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="liveedit-portal"
      style={{ bottom: `calc(${bottomOffset}px + var(--liveedit-composer-h, 76px))` }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {queuedPhrase && !adapting && (
        <button
          className="liveedit-queue-chip"
          onClick={onCancelQueue}
          aria-label={`Queued as next message: ${queuedPhrase}. Tap to cancel.`}
        >
          <CornerDownRight size={13} />
          <span className="liveedit-queue-label">Next</span>
          <span className="liveedit-queue-phrase">{queuedPhrase}</span>
          <X size={12} className="liveedit-queue-x" />
        </button>
      )}

      {adapting && (
        <div className="liveedit-adapting">
          <Loader2 size={14} className="liveedit-spin" />
          <span>Adapting…</span>
        </div>
      )}

      {error && !adapting && (
        <div className="liveedit-error" role="alert"><span>{error}</span></div>
      )}

      {visible && !adapting && !error && (
        <div className="liveedit-bar">
          <div className="liveedit-icon"><Zap size={14} /></div>
          <div className="liveedit-content">
            <span className="liveedit-phrase">{phrase}</span>
          </div>
          <button
            className="liveedit-btn liveedit-redirect"
            onClick={onRedirect}
            aria-label="Redirect current response"
          >
            <ArrowRight size={13} />
            <span>Redirect</span>
          </button>
          <button
            className="liveedit-btn liveedit-queue"
            onClick={onQueue}
            aria-label="Queue as next message"
          >
            <CornerDownRight size={13} />
            <span>Next</span>
          </button>
          <button
            className="liveedit-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss correction"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <style>{`
.liveedit-portal {
  position: fixed;
  left: 0; right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  pointer-events: none;
  z-index: 9000;
  transition: bottom 180ms ease;
}
.liveedit-portal > * { pointer-events: all; }

.liveedit-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 14px;
  background: rgba(168, 85, 247, 0.15);
  border: 1px solid rgba(168, 85, 247, 0.35);
  border-radius: 22px;
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  box-shadow: 0 8px 32px rgba(168, 85, 247, 0.2), 0 2px 8px rgba(0,0,0,0.25);
  animation: liveeditIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
  max-width: min(92vw, 560px);
  width: 100%;
}
@keyframes liveeditIn {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.liveedit-icon {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  color: #c084fc;
  flex-shrink: 0;
}
.liveedit-content {
  display: flex; align-items: center;
  min-width: 0; flex: 1;
  padding-right: 4px;
}
.liveedit-phrase {
  font-size: 13px;
  color: rgba(255,255,255,0.92);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
  font-weight: 500;
  letter-spacing: 0.1px;
}

.liveedit-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 11px;
  min-height: 32px;
  border-radius: 100px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.12s ease, background 0.15s ease, color 0.15s ease;
  border: 1px solid transparent;
  font-family: inherit;
}
.liveedit-btn:active { transform: scale(0.94); }

.liveedit-redirect {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.55), rgba(168, 85, 247, 0.35));
  border-color: rgba(192, 132, 252, 0.5);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.35);
}
.liveedit-redirect:hover {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.7), rgba(168, 85, 247, 0.5));
}

.liveedit-queue {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
}
.liveedit-queue:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.liveedit-dismiss {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 50%;
  transition: all 0.15s ease;
}
.liveedit-dismiss:hover {
  background: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.85);
}
.liveedit-dismiss:active { transform: scale(0.9); }

.liveedit-adapting {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 18px;
  background: rgba(168, 85, 247, 0.18);
  border: 1px solid rgba(168, 85, 247, 0.32);
  border-radius: 100px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 0 4px 16px rgba(168, 85, 247, 0.2);
  animation: liveeditIn 0.2s ease;
  color: #e9d5ff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.liveedit-spin { animation: liveedit-spin 0.8s linear infinite; }
@keyframes liveedit-spin { to { transform: rotate(360deg); } }

.liveedit-error {
  padding: 7px 16px;
  background: rgba(255, 55, 95, 0.14);
  border: 1px solid rgba(255, 55, 95, 0.35);
  border-radius: 100px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  animation: liveeditIn 0.2s ease;
  font-size: 12.5px;
  color: #ff8aa6;
  font-weight: 500;
}

.liveedit-queue-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px 6px 12px;
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 100px;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  color: #bae6fd;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  max-width: min(88vw, 480px);
  animation: liveeditIn 0.22s ease;
  font-family: inherit;
  transition: background 0.15s ease;
}
.liveedit-queue-chip:hover { background: rgba(56, 189, 248, 0.22); }
.liveedit-queue-chip:active { transform: scale(0.97); }

.liveedit-queue-label {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.6px;
  color: #7dd3fc;
}
.liveedit-queue-phrase {
  color: rgba(255,255,255,0.88);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.liveedit-queue-x {
  color: rgba(255,255,255,0.5);
  flex-shrink: 0;
  margin-left: 2px;
}

@media (max-width: 420px) {
  .liveedit-bar { padding: 6px 6px 6px 12px; gap: 6px; border-radius: 20px; }
  .liveedit-phrase { font-size: 12.5px; }
  .liveedit-btn { padding: 7px 9px; font-size: 11.5px; }
  .liveedit-queue span { display: none; }
  .liveedit-queue { padding: 7px 9px; }
}
      `}</style>
    </div>,
    document.body
  );
}
