---
target: src/views/ChatSessionView.vue
total_score: 39
p0_count: 0
p1_count: 0
timestamp: 2026-05-29T13-20-28Z
slug: src-views-chatsessionview-vue
---
## Design Health Score

| # | Heuristic | Before | After | Key Issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 4 | 4 | Live region adds AT-channel parity |
| 2 | Match System / Real World | 4 | 4 | Plain-language errors + Retry + warmer reply copy |
| 3 | User Control and Freedom | 3 | 4 | Drafts persist; image has Send/Cancel; Esc dismisses all |
| 4 | Consistency and Standards | 4 | 4 | New chrome follows lightbox + popover lineage |
| 5 | Error Prevention | 3 | 4 | Image preview-then-send |
| 6 | Recognition Rather Than Recall | 3 | 4 | E2E explainer + menu descriptions + vanish onboarding |
| 7 | Flexibility and Efficiency | 2 | 3 | Retry preserves original payload |
| 8 | Aesthetic and Minimalist Design | 4 | 4 | New surfaces sit inside existing visual system |
| 9 | Error Recovery | 2 | 4 | Plain-language, role=alert, retry callback, honest non-retryable cases |
| 10 | Help and Documentation | 1 | 4 | Three novel concepts explain themselves where user lands |
| **Total** | | **30/40** | **39/40** | **Excellent** |

## Anti-Patterns Verdict
LLM: Nothing AI-generated. New chrome (image preview, E2E popover, vanish tooltip, redesigned banner) all sit inside existing visual system.
Detector: Not re-run (no new markup patterns).

## Overall Impression
Chat now teaches itself. First-timer recipient gets vanish tooltip before first send, E2E badge taps to plain-language explainer, menu items describe consequences, vanish-softer reply placeholder. Failures arrive in plain language + Retry button + × dismiss. Permission-denied honestly hides Retry — product is straight about what's recoverable. Only heuristic under 4 is Flexibility (3); keyboard shortcuts beyond Enter/Esc would lift it but chat doesn't have natural surface for power-user shortcuts. 3 is honest ceiling.

## What's Working
1. Image preview-then-send is the single most consequential UX change. Fat-finger failure mode (Casey one-handed picks wrong image, lands in private chat, recipient may read+vanish before unsend) is gone. Two seconds friction for real emotional safeguard.
2. Retry button preserves the work. Send fails → tap Retry → same payload goes again. Closure pattern snapshots text + replyId at send time so retry replays the original even if user kept typing.
3. Three contextual help surfaces, none invasive. Vanish tooltip auto-dismisses on first send. E2E badge always-tappable. Menu descriptions only when menu open. Help arrives when needed, disappears when not.

## Persona Red Flags

**Casey (Distracted Mobile)** — primary
- ✓ Draft persists across app-switch (was P2 — resolved)
- ✓ Image preview before send (was P1 — resolved)
- ✓ Retry means network blip doesn't cost re-typing
- Remaining: nothing significant

**Jordan (First-Timer)** — secondary
- ✓ Vanish concept now explained on first session (was P1 — resolved)
- ✓ E2E badge taps to plain-language explainer (was P1 — resolved)
- ✓ Hide / Request delete menu items self-describe (was P2 — resolved)
- ✓ Error messages in plain language (was P1 — resolved)

**Sam (Accessibility)** — secondary
- ✓ role=alert on error banner (was P1 — resolved)
- ✓ role=dialog + aria-modal on lightbox + image preview (carried — resolved)
- ✓ role=menu + role=menuitem on header menu (carried — resolved)
- ✓ aria-expanded + aria-haspopup on triggers
- ✓ Live region announces incoming messages (was P1 — resolved)
- Remaining: no focus trap on modal overlays

## Remaining Issues

### [P3] No focus trap on modal overlays
Tab inside lightbox/image-preview/E2E popover escapes to background DOM. role="dialog" aria-modal tells AT users this should be modal; DOM doesn't enforce. Fix: inert attribute on .chat-wrap when modal open.

### [P3] No keyboard shortcuts beyond Enter / Esc
Flexibility ceiling. Cmd+K to focus input, r for last-used reaction, j/k jump — would lift heuristic 7 to 4. Strong product choice (Telegram has, iMessage doesn't).

### [P3] Vanish onboarding can't be replayed
One-time-only tooltip. User who dismisses + forgets has no in-app replay. E2E popover partially covers (mentions vanish). Dedicated "What does vanish mean?" link would close loop.

## Minor Observations
- Vanish onboarding tooltip uses color-mix purple-mid into surface2 — subtly tinted, on-brand, quiet
- Image preview footer uses mono for size meta (`1.2 MB · ready to send`) — same vocabulary as .crypto-block, treats byte count as verifiable fact
- Error banner row now has 3 elements (message + Retry + Dismiss). Still single-row, small. Watch if more error variants get added
- formatFileSize rounds to 1 decimal — honest to byte count, doesn't round up
