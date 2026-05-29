# Product

## Register

product

## Users

Tech-aware people sending sensitive 1-on-1 messages — secrets between friends, anonymous tips, intimate notes, time-bounded coordination. They want the message gone after the other person reads it, and they don't want to trade an account, a profile picture, or a phone number for the privilege. Skill level: comfortable using a PWA on a phone, understands "end-to-end" in principle, doesn't want to manage keys.

Primary context is mobile, often single-handed, often at a moment of "I want to say this and then have it gone." The audience skews Traditional Chinese first; the interface mixes 中文 and English freely and the typography is tuned for both.

## Product Purpose

A single-page web app for short-lived, secure 1-on-1 conversations. You generate an invite link, share it through whatever channel you already use, the other person joins, you whisper, the message auto-vanishes after they read it.

Success looks like: the conversation happens, it leaves no trace beyond what either party chose to screenshot, the user never had to sign in, and the entire thing ran on the Firebase Spark (free) tier with no custom backend. Everything is enforced by Firestore security rules and client-side Web Crypto — the threat model is auditable from the repository alone.

Explicit non-goals: group chat, cross-device sync, identity providers, server-side display names, paid tiers that require a real backend. These aren't omissions; they're load-bearing.

## Brand Personality

Quiet · painterly · intimate.

Voice is technical confidence delivered softly. The README's threat model reads like a manifesto; the chat reads like a handwritten note. The mascot — Whisp, the painted ghost cat — carries all of the personality, which lets the rest of the UI stay restrained. Mint eyes, pink nose, slightly off-symmetric serifs (Fraunces with `SOFT 60, WONK 1`) — character without cuteness.

Emotional goals: trust, calm, a thread of whimsy that never tips into frivolity when the stakes are sensitive.

## Anti-references

- **Signal / WhatsApp / Telegram** — saturated "secure messenger" blue, dense chrome, productivity-app density. The opposite of intimate.
- **Snapchat / teen-coded social** — neon yellow, playful UI elements that frame ephemerality as fun rather than as protection.
- **Crypto / web3 / "trustless" aesthetics** — terminal green, neon cyan, gradient meshes, buzzword voice ("zero-knowledge", "decentralized"). VanishWhisper is technically rigorous but isn't selling rigor.
- **Generic SaaS landing tropes** — gradient text, hero-metric template, identical icon-and-text card grids, tiny uppercase tracked eyebrow above every section. Anything you'd guess from "Vue + Firebase landing page" in 2026.
- **Discord / Slack / Mattermost** density — lots of nav, lots of channels, lots of presence chrome. This is a pair-wise medium with at most a list of pairs.

## Design Principles

1. **Practice what you preach.** The UI is as quiet and unsurveilled as the threat model claims. No telemetry chrome, no growth dark patterns, no "invite 3 friends to unlock" prompts. The product is the threat model made tactile.
2. **Painted, not flat.** Film grain noise + atmospheric purple radial + Fraunces' SOFT/WONK axes give the surface a hand-made quality that matches the painted mascot. Avoid the corporate-minimalist trap: this is dark and quiet, not sterile.
3. **Identity at substance, not chrome.** UIDs, RSA fingerprints, wrapped keys are surfaced as first-class objects via the mono inset `.crypto-block` treatment — the user can compare what the server actually sees against what the other party sees. Cryptographic objects deserve UI vocabulary.
4. **Vanish is felt, not just enforced.** The CSS-animated depletion line, the bucketed countdown label ("about 5 minutes left" rather than "00:04:53"), the pill flip from purple "unread" to mint "live" — vanishing is a UX surface the user inhabits, not a backend cron job.
5. **Token discipline keeps the painted look intact.** Every color flows through `--vw-*` tokens or `color-mix(in srgb, var(--vw-*) X%, transparent)`. No raw hex in components. The aesthetic survives system-wide because the palette is a single source — see `src/styles/theme.css`.

## Accessibility & Inclusion

- **WCAG AA contrast** target for body and UI text. The dark theme has three depth layers (`--vw-bg` < `--vw-surface` < `--vw-surface2`) and three text levels (`--vw-text` / `--vw-text2` / `--vw-text3`) — verify each text-on-surface pairing hits ≥4.5:1 (≥3:1 for ≥18px or bold ≥14px).
- **Reduced motion is non-optional.** `@media (prefers-reduced-motion: reduce)` kills animations app-wide in `theme.css`. Vanish still fires (data-driven), the user just doesn't see the bar deplete. Any new animation must obey this rule and degrade to a crossfade or instant transition.
- **iOS Safari input zoom prevented** via `font-size: 16px !important` on `input, textarea` at `@media (hover: none)`. Touch viewports never have inputs below 16px, regardless of how dense a scoped view tries to be.
- **CJK fallback chains** in every font stack so 中文 and English mix on one line without a serif/sans split: display falls through to CJK serif (Songti TC / Noto Serif TC), body and mono fall through to CJK sans (PingFang TC / Noto Sans TC).
- **Touch targets** ≥44×44px on every interactive surface (buttons, popover items, pill anchors).
- **Screen reader text** for icon-only buttons (gear, sticker picker, ⋯ overflow, send) via `aria-label`.
- **Vestibular sensitivity** is the primary motion concern. Hover-color transitions are intentionally left running (tactile feedback, not motion), but every translate/opacity/animation respects the reduce-motion media query.
