/**
 * KURO::PREEMPT — KuroChat.jsx Integration Patch
 * 
 * Minimal changes to wire preempt into existing KuroChatApp.
 * Apply these additions to your KuroChat.jsx v7.2.
 * 
 * THREE changes:
 *   1. Import + init the hook
 *   2. Wire textarea onChange
 *   3. Handle preempt SSE events in stream parser
 */


// ═══════════════════════════════════════════════════════════════
// CHANGE 1: Add import and init (near top of KuroChatApp)
// ═══════════════════════════════════════════════════════════════

// Add this import alongside your other imports:
//   import usePreempt from './usePreempt';

// Inside KuroChatApp function body, near other hooks:
//   const messagesRef = useRef(messages); // keep current messages in ref
//   useEffect(() => { messagesRef.current = messages; }, [messages]);
//   const { onInputChange, getPreemptSession, abortPreempt } = usePreempt(sessionId, messagesRef, modelMode);


// ═══════════════════════════════════════════════════════════════
// CHANGE 2: Wire textarea onChange (in your input area JSX)
// ═══════════════════════════════════════════════════════════════

// Find your textarea/input onChange handler and ADD the preempt call:
//
//   onChange={(e) => {
//     setInput(e.target.value);        // existing
//     onInputChange(e.target.value);   // ← ADD THIS LINE
//   }}
//
// That's it. The hook handles debouncing, word detection, everything.
// User sees absolutely nothing — no spinners, no network indicators.


// ═══════════════════════════════════════════════════════════════
// CHANGE 3: Handle preempt events in your SSE stream parser
// ═══════════════════════════════════════════════════════════════

// In your stream parsing logic (where you handle SSE `data:` lines),
// add handling for the preempt event types. These are cosmetic —
// the token events are already the standard `type: 'token'` format,
// so they render automatically. This just lets you show fluid transitions.

/*
  // Inside your SSE line parser:
  
  if (parsed.type === 'preempt_start') {
    // Optional: could set a state flag for UI polish
    // Preempted tokens arrive as normal 'token' events but much faster
    console.log(`[PREEMPT] Flushing ${parsed.buffered} cached tokens`);
  }
  
  if (parsed.type === 'preempt_end') {
    // Transition from cached → live streaming
    // Optional: brief visual indicator that live inference is continuing
    console.log(`[PREEMPT] ${parsed.flushed} tokens flushed, continuing live`);
  }
  
  if (parsed.type === 'token') {
    // This already works in your existing code.
    // Preempted tokens have parsed.preempted === true but render identically.
    // The only difference: they arrive ~100x faster than live inference.
    appendToken(parsed.content);
  }
  
  if (parsed.type === 'done' && parsed.preempted) {
    // Full response was pre-computed before user hit send
    console.log(`[PREEMPT] Complete response served from buffer`);
  }
*/


// ═══════════════════════════════════════════════════════════════
// OPTIONAL: Abort on mode switch or input clear
// ═══════════════════════════════════════════════════════════════

// In your mode switch handler:
//   abortPreempt();

// In any "clear chat" or "new conversation" handler:
//   abortPreempt();


// ═══════════════════════════════════════════════════════════════
// HOW IT FEELS TO THE USER
// ═══════════════════════════════════════════════════════════════

/*
  TRADITIONAL (every other LLM):
  ┌─────────────────────────────────────────────────────────────┐
  │ User types "Explain quantum entanglement in simple terms"   │
  │ User hits Send                                              │
  │ [1-3s] Layers process...                                    │
  │ [2-5s] First token arrives from model                       │
  │ [10-30s] Full response streams in                           │
  │ Total perceived wait: 3-8s before first content             │
  └─────────────────────────────────────────────────────────────┘

  KURO::PREEMPT:
  ┌─────────────────────────────────────────────────────────────┐
  │ User types "Explain quantum" → [silent speculation starts]  │
  │ User types "entanglement" → [speculation continues/updates] │
  │ User types "in simple terms" → [model already 40 tokens in] │
  │ User hits Send                                              │
  │ [~50ms] 40 pre-computed tokens flush instantly              │
  │ [seamless] Live streaming continues from token 41           │
  │ Total perceived wait: NEAR ZERO                             │
  └─────────────────────────────────────────────────────────────┘

  The response appears to START before the user finishes pressing Send.
  Layer animations and thinking blocks play during the flush for visual continuity.
*/
