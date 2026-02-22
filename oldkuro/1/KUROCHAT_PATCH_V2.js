/**
 * KURO::PREEMPT v2 — KuroChat.jsx Integration (3 Changes)
 * 
 * All RT issues addressed in backend. Frontend changes are minimal.
 */


// ═══ CHANGE 1: Import + Init ═══
// Add import:
//   import usePreempt from './usePreempt';
//
// Inside KuroChatApp, near other hooks:
//
//   const token = localStorage.getItem('kuro_token');
//   const { onInputChange, getPreemptSession, abortPreempt } = usePreempt(sessionId, modelMode, token);
//
// Note: token is passed for RT-03 auth. No messagesRef needed (RT-06 server-side lookup).


// ═══ CHANGE 2: Wire textarea ═══
// Your textarea onChange — add ONE line:
//
//   onChange={(e) => {
//     setInput(e.target.value);
//     onInputChange(e.target.value);   // ← this line
//   }}


// ═══ CHANGE 3: Abort on cleanup ═══
// In mode switch, new conversation, or component unmount:
//
//   // Mode switch handler:
//   const handleModeSwitch = (newMode) => {
//     abortPreempt();
//     setModelMode(newMode);
//   };
//
//   // Cleanup:
//   useEffect(() => {
//     return () => abortPreempt();
//   }, []);


// ═══ THAT'S IT ═══
// 
// No SSE parser changes needed. Preempted tokens arrive as standard
// { type: 'token', content: '...' } events — your existing renderer
// handles them automatically. They just arrive ~100x faster.
//
// The preempt_start / preempt_end events are informational.
// If you want a subtle visual indicator:
//
//   if (parsed.type === 'preempt_start') {
//     // Optional: very subtle indicator that response was pre-computed
//     // e.g. a tiny ⚡ icon next to the first token
//   }
//
// But the whole point is: user sees nothing different.
// Response just appears impossibly fast.
