/**
 * usePreempt v2 — KURO::PREEMPT Frontend Hook (Hardened)
 * 
 * RT-03: Sends X-KURO-Token auth header on all requests
 * RT-06: Only sends sessionId + partialInput (no messages)
 * RT-08: No priority hints, no keepalive on speculate, sendBeacon for abort only
 * 
 * Usage:
 *   const { onInputChange, getPreemptSession, abortPreempt } = usePreempt(sessionId, mode, token);
 */

import { useRef, useCallback, useState } from 'react';

const WORD_DEBOUNCE_MS = 800;
const MIN_WORDS = 3; // Raised from 2 — need more signal before burning GPU

export default function usePreempt(sessionId, mode, token) {
  const timerRef = useRef(null);
  const lastSentRef = useRef('');
  const activeRef = useRef(false);
  const loadedTimerRef = useRef(null);
  const [preemptState, setPreemptState] = useState('idle'); // 'idle' | 'preempting' | 'loaded'

  const onInputChange = useCallback((value) => {
    if (!sessionId || !token) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = value.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);

    if (words.length < MIN_WORDS) return;

    // Detect word boundary
    const lastChar = value.slice(-1);
    const isWordBoundary = /[\s.,!?;:]/.test(lastChar);

    const delay = isWordBoundary ? WORD_DEBOUNCE_MS : WORD_DEBOUNCE_MS * 1.5;

    timerRef.current = setTimeout(() => {
      _sendSpeculation(trimmed);
    }, delay);

  }, [sessionId, mode, token]);

  /**
   * RT-03: Auth header included
   * RT-06: No messages sent — server looks up session context
   * RT-08: Standard fetch, no priority/keepalive
   */
  const _sendSpeculation = useCallback(async (input) => {
    if (input === lastSentRef.current) return;

    // RT-08: Cap payload size — don't send walls of text
    if (input.length > 1000) return;

    lastSentRef.current = input;
    activeRef.current = true;

    setPreemptState('preempting');
    if (loadedTimerRef.current) clearTimeout(loadedTimerRef.current);

    try {
      await fetch('/api/preempt/speculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KURO-Token': token  // RT-03
        },
        body: JSON.stringify({
          sessionId,
          partialInput: input,
          mode: mode || 'main'
          // RT-06: No messages field
        })
      });
      // Heuristic: model likely has buffered tokens after ~2.5s
      loadedTimerRef.current = setTimeout(() => setPreemptState('loaded'), 2500);
    } catch (e) {
      // Speculative — failure is acceptable
      setPreemptState('idle');
    }
  }, [sessionId, mode, token]);

  /**
   * Returns sessionId for stream handler to claim.
   * Call right before POST /api/stream.
   */
  const getPreemptSession = useCallback(() => {
    if (loadedTimerRef.current) clearTimeout(loadedTimerRef.current);
    setPreemptState('idle');
    if (!activeRef.current) return null;
    activeRef.current = false;
    lastSentRef.current = '';
    return sessionId;
  }, [sessionId]);

  /**
   * RT-08: sendBeacon for abort (fire-and-forget, works on page unload)
   * Standard fetch fallback for browsers without sendBeacon
   */
  const abortPreempt = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (loadedTimerRef.current) clearTimeout(loadedTimerRef.current);
    lastSentRef.current = '';
    activeRef.current = false;
    setPreemptState('idle');

    if (!sessionId || !token) return;

    const payload = JSON.stringify({ sessionId, token });

    // sendBeacon for reliability on tab close / nav away
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/preempt/abort', blob);
    } else {
      fetch('/api/preempt/abort', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KURO-Token': token
        },
        body: payload
      }).catch(() => {});
    }
  }, [sessionId, token]);

  return { onInputChange, getPreemptSession, abortPreempt, preemptState };
}
