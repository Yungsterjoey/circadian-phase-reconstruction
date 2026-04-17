# KURO::LIVE EDIT — KuroChatApp Mobile Design

**Date:** 2026-04-17
**Scope:** Frontend wire-up of mid-stream correction for mobile KuroChatApp.
**Status:** Ready for implementation (pending user review).

---

## 1. Context

### 1.1 Current state
- **Backend (live):** `server.cjs:140-141, 974, 978, 1234, 1241, 1366` wires `layers/liveedit/stream_controller.cjs` and `layers/liveedit/liveedit_routes.cjs`. `POST /api/stream/correct` works. Rate limit 5/min, 120-char cap, full v6.3 audit chain, abort-and-restart strategy.
- **Frontend (missing):** No `LiveEdit.jsx` in `src/components/apps/`. No `aborted_for_correction` SSE handler in `KuroChatApp.jsx`. No mid-stream correction UI.
- **Reference UI:** `kuro-liveedit-v11.zip` contains a `LiveEdit.jsx` written for desktop KuroChat v7.2. KuroChatApp is mobile-first v72+ with a different composer structure.
- **Past-message edit (existing, separate):** `KuroChatApp.jsx:383-445` lets users edit historical user messages and resend. Out of scope for this spec but must not conflict visually.

### 1.2 Goal
Wire the mid-stream correction backend to a cohesive mobile UX that disambiguates the two intents a user has when typing during a stream: **redirect the current response** vs **queue the next message**.

---

## 2. Intent model

Typing while streaming triggers a **two-button pill** — the user explicitly chooses intent every time:

| Button | Action |
|---|---|
| **Redirect now** | Abort current stream, restart with correction context appended to last user message |
| **Send next** | Queue the phrase as the next message; auto-send on stream completion |
| **✕** | Dismiss pill, keep input text |

No auto-decision. The pill is an explicit disambiguator, not an auto-applied correction.

---

## 3. Detection rules (inherited from zip, kept verbatim to match server contract)

Triggers only when ALL of:
- `isLoading === true` (assistant currently streaming)
- Input has ≥2 words AND ≥8 chars
- 500ms pause since last keystroke OR last char is one of `. , ? ! ; :`
- Current length is not pure deletion (user added chars, not just removed)

Clamps:
- Phrase truncated to 120 chars (never rejected for length)
- Client rate limit: 5 corrections / 60s (mirrors server; prevents unnecessary round-trips)

---

## 4. Pill placement — keyboard-aware

- Rendered in a React portal attached to the root of the chat island, positioned `fixed` above `.k8-toolbar`
- Position computed from `window.visualViewport.height` so on iOS Safari the pill rides directly above the keyboard, not under it
- `visualViewport.addEventListener('resize', reposition)` listener registered while pill is visible, removed on hide
- Max-width `min(92vw, 560px)`, centered
- Safe-area inset respected via `env(safe-area-inset-bottom)`
- Spring animation in (cubic-bezier(0.34, 1.56, 0.64, 1), 250ms), ease-out fade (150ms)
- Color palette matches existing accent: `rgba(168, 85, 247, ...)` purple glass with `backdrop-filter: blur(20px)`

---

## 5. Queue behavior (new — not in zip)

When user taps **Send next**:
1. Input field clears; phrase stored in `queuedMessage` state (single slot, string)
2. Small chip renders above composer: `↷ Next: "<phrase>" · tap to cancel`
3. When `isStreaming` transitions from `true` → `false` without an `aborted_for_correction` event (natural completion), `sendMessage(queuedMessage)` fires once, then queue clears. Implemented inside the hook via `useEffect([isStreaming])` watching for the false transition.
4. If user manually sends a new message before the stream ends, the queue is discarded (the manual send wins; no pile-up)
5. Conversation switch (`activeId` change) clears queue
6. Stream error / abort (non-correction) also clears queue — queue only auto-sends on clean completion

Single-slot by design. Multi-message queue is YAGNI.

---

## 6. SSE wiring

Add one branch to the stream parse loop in `KuroChatApp.jsx` (near line 940, before the existing `d.type === 'error'` branch):

```js
} else if (d.type === 'aborted_for_correction') {
  setIsLoading(false);
  setConnectionError(null);
  return;
}
```

Return immediately to let the hook drive the restart sequence.

---

## 7. Adapting state

Between abort ack and new stream start, the pill swaps to a 600ms "Adapting…" state:
- `Loader2` spinner + text
- `aria-live="polite"` announces to screen readers
- Fixed 600ms display gives visual continuity so the user sees a coherent pivot, not a stream that "broke then started over"

---

## 8. Error handling

All correction errors are **non-fatal** — the underlying stream is unaffected and continues.

| Error | Behavior |
|---|---|
| Rate limit (client or server) | Red chip 3s: "Too many corrections — wait a moment". Input text **restored**. |
| `{accepted:false, reason}` from server | Red chip 3s with `reason`. Input text restored. |
| Network failure on POST `/api/stream/correct` | Red chip 3s with `err.message`. Input text restored. |
| `aborted_for_correction` but restart fails | Existing error path handles it (no new logic needed). |

Input restoration is critical: user typed a full phrase, a transient error must not swallow it.

---

## 9. Mobile polish

- **Haptics** (via `navigator.vibrate?.(...)`):
  - Redirect: `[10]` (single crisp tick)
  - Send next / Queue: `[10, 30, 10]` (two-tick "delayed" pattern)
  - Dismiss: none (ambient action)
- **Tap targets:** all interactive elements ≥44×44pt
- **Glass aesthetic:** `backdrop-filter: blur(20px)` matching existing `.k8-toolbar`
- **Safe areas:** `padding-bottom: env(safe-area-inset-bottom)` on pill container
- **No layout shift:** pill is `position: fixed`, never pushes messages or composer

---

## 10. Accessibility

- Pill container: `role="status"` `aria-live="polite"` `aria-atomic="true"`
- Buttons: explicit `aria-label`s ("Redirect current response", "Queue as next message", "Dismiss correction")
- "Adapting…" announced via same live region
- Focus stays in textarea throughout; pill does **not** steal focus (typing continues uninterrupted)
- All colors meet WCAG AA contrast against `.k8-toolbar` background

---

## 11. Interaction with existing `editing` flow (past-message edit)

Existing flow at `KuroChatApp.jsx:383-445` lets users edit a historical user message and resend.

The `editing` state at line 383 is local to each `MessageBubble`. To coordinate with live-edit without lifting all state, add a lightweight parent-level ref `editingOpenCountRef` (incremented on edit-start, decremented on edit-save/cancel via callbacks passed to each bubble). The hook receives `editingActive = editingOpenCountRef.current > 0` and suppresses detection while true. Rationale: two overlapping correction UIs would be confusing and the past-edit flow already truncates history and regenerates.

No other changes to the existing flow.

---

## 12. User scenarios

| Scenario | Behavior |
|---|---|
| Happy redirect | Type → pill after 500ms → Redirect → current stream aborts → 600ms "Adapting…" → new stream with correction context |
| Happy queue | Type → pill → Send next → input clears, "Next: …" chip shows → stream completes naturally → queued message auto-sends |
| Dismiss | Tap ✕ → pill hides, input text retained, can resume typing |
| Pure deletion | User types then deletes back to empty → no pill triggered |
| Stream ends before pill action | Pill auto-dismisses on `isStreaming === false`, input retained |
| Rate limit | 6th Redirect in 60s → error chip 3s, input restored, can retry after window |
| Network fail | POST fails → error chip, input restored, stream continues |
| Conversation switch mid-pill | `activeId` change → pill hidden, queue cleared, detection timer cancelled |
| Manual send while queue exists | Manual `sendMessage` fires → queue silently discarded |
| Stop ⏹ while pill visible | Stop wins; abort propagates; pill clears via `isStreaming === false` |
| iOS keyboard open/close | `visualViewport` resize listener repositions pill flush with keyboard |
| Past-msg edit active + stream | Live-edit pill suppressed while `editing` flag true |
| Rapid typing | Debounced 500ms; single pill; no flicker |
| Phrase >120 chars | Truncated client-side to 120 before display and POST |
| User types, then pill appears, then types more | Phrase in pill updates live to current input (reuses detection timer) |
| User hits Enter while pill visible | Enter = Redirect (optional tweak from zip INTEGRATION.txt; included) |

---

## 13. File changes

### NEW
`src/components/apps/LiveEdit.jsx` — exports:
- `useLiveEdit({ isStreaming, sessionId, activeId, messages, input, abortRef, sendMessage, updateMessages, setInput, setIsLoading, authHeaders, editingActive })` hook
- `LiveEditBar({ phrase, visible, adapting, error, onRedirect, onQueue, onDismiss, queuedPhrase, onCancelQueue })` component

Adapted from zip reference with:
- Two-button intent split (Redirect + Queue)
- Queue state + chip
- Portal + `visualViewport` positioning
- `editingActive` guard
- Haptics
- Updated CSS for KuroChatApp's dark iOS palette

### MODIFIED
`src/components/apps/KuroChatApp.jsx` — 4 structural edits + 1 shared flag:
1. Import `useLiveEdit`, `LiveEditBar` from `./LiveEdit.jsx`
2. Call `useLiveEdit({...})` after `sendMessage` definition (~line 1060)
3. Add `aborted_for_correction` SSE branch in parse loop (~line 940)
4. Render `<LiveEditBar {...}/>` above `.k8-toolbar` (~line 1196)
5. Queue auto-fire lives inside the hook (useEffect on `isStreaming`), so no edit #5 in KuroChatApp.jsx is needed — four structural edits total plus the hook's internal logic

### BACKUPS (pre-edit)
- `src/components/apps/KuroChatApp.jsx.bak-2026-04-17`
- `server.cjs.bak-2026-04-17` (defensive, even though backend is unchanged — pattern discipline)

### UNCHANGED
- `server.cjs` — already live
- `layers/liveedit/*.cjs` — already live
- Existing `editing` flow (lines 383-445)

---

## 14. Test plan

Manual test matrix run on:
- Chrome DevTools mobile viewport (iPhone 14 Pro profile)
- Real iOS Safari if available

| # | Test | Expected |
|---|---|---|
| 1 | Happy redirect | Type "actually make it funnier" → pill → Redirect → new reply pivots to funnier tone |
| 2 | Happy queue | Type "and translate to French" → Send next → stream finishes → queued fires, replies in French |
| 3 | Rate limit | Fire 6 redirects in under 60s → 6th shows error chip, input preserved |
| 4 | Network fail | Kill network mid-Apply → error chip, input preserved, stream continues |
| 5 | Keyboard positioning (iOS) | Open keyboard → pill sits flush above keyboard, not obscured |
| 6 | Conversation switch | Start redirect, switch chat mid-pill → pill and queue cleared |
| 7 | Past-msg edit + stream | Open past-msg edit while streaming → live-edit pill suppressed |
| 8 | Pure deletion | Type then delete to empty → no pill |
| 9 | Stop button wins | Pill visible, tap Stop ⏹ → stream aborts, pill clears |
| 10 | Enter-to-redirect | Enter while pill visible → Redirect fires |
| 11 | Queue cancel | Queue set, tap "Next: …" chip → queue clears, input restored |
| 12 | Manual send discards queue | Queue set, type new msg, send → queue discarded, only new msg sent |
| 13 | Dismiss retains input | Tap ✕ → pill hides, input text still there |
| 14 | Long phrase | Type >120 chars → pill shows 120-char truncation |
| 15 | a11y | Screen reader announces pill appearance and "Adapting…" |

---

## 15. Non-goals (YAGNI)

- Multi-message queue (single slot only)
- Voice-to-text correction
- File attachment mid-correction
- Correction for tool-call responses (live-edit applies to text generation only — existing behavior)
- Undo after applying Redirect
- Correction history panel
- Per-conversation correction stats UI (audit log is server-side only, visible via admin if needed)
- Rewriting the existing past-message `editing` flow
