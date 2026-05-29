---
target: src/views/ChatSessionView.vue
total_score: 30
p0_count: 0
p1_count: 3
timestamp: 2026-05-29T13-10-08Z
slug: src-views-chatsessionview-vue
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | Pill flip (unread→live) + bucketed vanish labels |
| 2 | Match System / Real World | 4 | Universal chat patterns + brand-voiced empty state |
| 3 | User Control and Freedom | 3 | Esc/back/× everywhere; draft lost on navigation |
| 4 | Consistency and Standards | 4 | Strong internal + external consistency |
| 5 | Error Prevention | 3 | Mutual delete excellent; image send has no preview gate |
| 6 | Recognition Rather Than Recall | 3 | Universal icons; novel features unexplained |
| 7 | Flexibility and Efficiency | 2 | Enter-to-send works; no other shortcuts |
| 8 | Aesthetic and Minimalist Design | 4 | Sparse, atmospheric — every element earns its pixel |
| 9 | Error Recovery | 2 | Raw Firestore error strings; no retry |
| 10 | Help and Documentation | 1 | No in-app explainer for vanish, E2E, Hide, Mutual delete |
| **Total** | | **30/40** | **Good** |

## Anti-Patterns Verdict
LLM: Not AI-generated. Painted Whisp + Fraunces italic title + atmospheric radial + CSS-only send triangle + 3-state pill system = deliberate authorial choices.
Detector: 1 finding (`border-left: 9px` on `.send-icon`) — FALSE POSITIVE, CSS triangle hack on 0×0 box.
Visual: Browser viz skipped (chat requires auth + session, no dev server up).

## Overall Impression
Visible design layer is excellent (1,2,4,8 at 4); invisible support layers thin (9,10 at bottom). Looks mature; recovers like a prototype. Single biggest opportunity: small explainer surface (one-time tooltip + E2E tap-target) lifts 6, 9, 10 simultaneously without visual surface change.

## What's Working
1. Pill flip (purple unread → mint live) at read-fire is exemplary visibility-of-status — makes recipient ack a visible event, ties countdown start to a moment the sender sees.
2. Bucketed vanish labels ("about 5 minutes left" not "00:04:53") respect cognitive load. Two-channel cue with the depletion line.
3. Mutual delete requires both parties — most destructive action is properly gated, mirrored copy on both sides.

## Priority Issues

### [P1] No first-time / in-context explainer for vanish
First message vanishes; Jordan thinks it's broken or they did something wrong. Vanish animation teaches *while it happens* — too late for message 1.
Fix: One-time tooltip on first session opened naming the behavior. Persist seen-flag in IDB. Add tap-target on E2E badge → 2-line explainer.
Suggested: `/impeccable onboard`

### [P1] Error messages are raw Firebase strings; no retry path
Send fails → `FirebaseError: Missing or insufficient permissions.` Banner lacks `role="alert"` so Sam doesn't hear it. No retry — user re-does work from scratch.
Fix: Translate common errors at SDK boundary. Add `role="alert"`. Add retry callback re-running last send with same payload.
Suggested: `/impeccable clarify` + `/impeccable harden`

### [P1] No image preview before send
Casey one-handed picks wrong image; sends instantly to private chat. Unsend lands AFTER recipient may have read+vanished. Lowest-effort UX guard with highest emotional payoff.
Fix: After file picker `change`, preview overlay (like lightbox) with Send/Cancel + size/dimensions in mono.
Suggested: `/impeccable shape`

### [P2] Draft text lost on navigation away
App-switch mid-compose → empty input on return. iMessage / WhatsApp / Telegram preserve drafts; universal expectation. Local-only, no privacy violation.
Fix: `localStorage` write on draft change keyed by session id, restore on mount, clear on send. ~10 lines.
Suggested: `/impeccable harden`

### [P2] Hide / Mutual delete ship without in-context help
⋯ menu lists 3 actions with no description. Tap Hide → chat goes empty → user thinks they deleted it.
Fix: One-line description below each menu item (small text3).
Suggested: `/impeccable clarify`

## Persona Red Flags

**Casey (Distracted Mobile)** — primary
- ✗ Draft lost on app-switch
- ✗ No image preview before send
- ✓ Bottom-of-screen input bar in thumb zone
- ✓ Touch targets meet 44 (recent fix)
- ✓ Vanish state visible at-a-glance

**Jordan (First-Timer)** — secondary
- ✗ Vanish concept unexplained
- ✗ Empty state assumes you know "vanish"
- ✗ Mutual delete banner has no context
- ✗ Hide messages toggle has no explanation
- ✗ Error messages technical (Firebase strings)

**Sam (Accessibility)** — secondary
- ✗ Lightbox lacks dialog semantics + focus trap (carried from audit)
- ✗ Header ⋯ menu lacks menu role (carried)
- ✗ Error banner lacks role="alert"
- ✗ No live region for incoming messages
- ✗ Read-fire pill flip is visual-only
- ✓ Focus halos coherent
- ✓ Esc dismisses overlays
- ✓ Aria-labels on most icon-only buttons

## Minor Observations
- Header `chat-title` Fraunces italic SOFT/WONK is a beautiful unsung detail
- `[message vanished]` reads a touch cold for the brand voice; "(this one vanished)" warmer
- Reply preview chip is text-only; small reply-arrow icon prefix would help mobile parse
- Lightbox close at 16px top/right might clip behind iOS dynamic island in landscape
- Sticker tap-to-send is intentional one-tap (lower stakes than image)

## Questions to Consider
- What if the empty state itself taught vanish?
- What if E2E badge was a tap target → 3-line plain-language explainer?
- What if image send had a "draft" preview state?
- What if vanish countdown could be paused (long-press to hold)?
- What would a confident version of the error banner look like (retry button, plain language)?
