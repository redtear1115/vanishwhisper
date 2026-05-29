# Design

Visual system captured from `src/styles/theme.css` and the component layer (`src/components/`, `src/views/`). The CSS file remains the runtime source of truth — this document is the human-readable map of it. When something here disagrees with `theme.css`, the CSS wins; update this file to match.

## Theme

Dark, painterly, intimate. Deep purple as the dominant identity color, mint green as the secondary signal (read/live state, encryption confirmation), and a soft warm cream — `--vw-purple-pale #E5CFF7` — as the primary text-on-purple-bubble color. The surface is intentionally textured: a tiled SVG noise (~8% white at OKLCH-equivalent low chroma) plus a soft purple radial from above the viewport top, layered over `--vw-bg`. The painted Whisp mascot sits as a fixed 12%-opacity watermark in the desktop right gutter (≥768px).

Mode is dark by deliberate scene-setting: the user is whispering at night. Light mode is **not** offered.

## Color

All tokens are declared on `:root` in `src/styles/theme.css`. Component CSS must reference these names or `color-mix(in srgb, var(--vw-*) X%, transparent)` — raw hex is banned outside the token file.

### Background layers (deepest → lightest)

| Token | Hex | Use |
|---|---|---|
| `--vw-bg` | `#0D0A14` | App canvas, inset input slots, `.crypto-block` body |
| `--vw-surface` | `#16101F` | Topbar, input bar |
| `--vw-surface2` | `#1E1530` | Cards, "them" chat bubbles, session rows, popovers |

The three-layer pyramid is load-bearing: any new input always sits one layer below its surrounding bar (so it reads as a depressed slot), any new card sits one layer above (so it reads as lifted). Don't introduce a fourth layer.

### Borders

| Token | Hex | Use |
|---|---|---|
| `--vw-border` | `#2D1F45` | Default 0.5px hairline on cards, topbar bottom |
| `--vw-border2` | `#3D2A5F` | Lifted / focus / hero-card border, input border |

### Purple ramp (primary identity)

| Token | Hex | Use |
|---|---|---|
| `--vw-purple-deep` | `#5B0888` | Primary buttons, "me" chat bubble |
| `--vw-purple-mid` | `#713ABE` | Interactive accent, send button, focus ring |
| `--vw-purple-light` | `#9D76C1` | Secondary text, links, `<code>` |
| `--vw-purple-pale` | `#E5CFF7` | Text on purple, primary CTA label |

The hero-card variant (`.vw-card--hero`) overlays a 135° gradient from `--vw-surface2` to `color-mix(in srgb, var(--vw-purple-deep) 22%, --vw-surface2)`, used for the Profile / Create headline cluster only.

### Mint green ramp (secondary signal — encryption + read state)

| Token | Hex | Use |
|---|---|---|
| `--vw-green` | `#A8D8A8` | Whisp's eyes, decorative twinkle |
| `--vw-green-strong` | `#7BC47B` | E2E badge text, unread dot, live-pill text |
| `--vw-green-deep` | `#1C3A20` | Green badge / pill border |
| `--vw-green-dim` | `#1A2A1A` | E2E badge background, live-pill background |

The mint green is **only** for cryptographic confirmation and the read-state signal. Don't reach for it for "success" toasts, "complete" checkmarks, or any productivity-app success vocabulary — it would dilute the signal.

### Text

| Token | Hex | Use | Contrast vs `--vw-bg` | Contrast vs `--vw-surface2` |
|---|---|---|---|---|
| `--vw-text` | `#EDE0FF` | Primary body | ≈ 15.1:1 (AAA) | ≈ 13.4:1 (AAA) |
| `--vw-text2` | `#A688C8` | Secondary, muted captions | ≈ 6.5:1 (AA) | ≈ 5.8:1 (AA) |
| `--vw-text3` | `#9676BB` | Hints, timestamps, eyebrow labels, placeholders | ≈ 5.2:1 (AA) | ≈ 4.6:1 (AA) |

`--vw-text3` was lifted from `#6B4D8A` (2.85:1 / 2.53:1, AA fail on both surfaces) to `#9676BB` on 2026-05-29. Hue held near 264° so the hint voice stays inside the same cool-violet family as `--vw-text` and `--vw-text2` instead of drifting neutral.

### Danger

| Token | Hex | Use |
|---|---|---|
| `--vw-danger` | `#E85C7A` | Error states, delete hover, `.vw-popover-item.danger` |

## Typography

Three roles, three self-hosted variable fonts (loaded in `src/main.ts` from `@fontsource-variable/*`). Always reference via tokens.

| Role | Token | Font | Why this face | Where it's used |
|---|---|---|---|---|
| Display | `--vw-font-display` | **Fraunces Variable** | SOFT + WONK axes (`'SOFT' 60, 'WONK' 1`) make serifs softer and letterforms gently asymmetric, matching the painted mascot's hand-drawn quality | Wordmark, chat-with-X titles, splash |
| Body | `--vw-font-body` | **Figtree Variable** | Less-common UI sans (vs Inter / Geist), tuned for small sizes — chat is dense at 13px | All chat content, buttons, inputs, body copy |
| Mono | `--vw-font-mono` | **JetBrains Mono Variable** | Clearest 0/O, 1/l/I, hex-digit disambiguation | UIDs, fingerprints, decryption-failure markers, `.crypto-block` |

**CJK fallback strategy.** Webfonts subset to Latin only — self-hosting CJK is prohibitive (~5MB even WOFF2). Instead, each chain explicitly names the OS-bundled correct face after its Latin font so Chinese + English mix without a serif/sans split:

- Display → CJK **serif** (Songti TC / Songti SC / PMingLiU / Noto Serif TC)
- Body → CJK **sans** (PingFang TC / Microsoft JhengHei / Noto Sans TC)
- Mono → CJK sans fallback (PingFang TC / Microsoft JhengHei / Noto Sans Mono CJK TC)

### Scale

The chat surface is intentionally dense; the type scale follows from that.

| Use | Size | Weight | Notes |
|---|---|---|---|
| Display / wordmark | clamp(28px, 6vw, 48px) | 600–700 | Fraunces with `font-variation-settings: 'SOFT' 60, 'WONK' 1` |
| Section title / page heading | 18–22px | 600 | Display face on hero, body face on secondary pages |
| Body / chat message | 13px | 400 | Touch override bumps inputs to 16px on iOS |
| Pill / badge | 10–11px | 500 | All-caps tracking 0.08em on eyebrow labels only |
| Crypto body | 12–14px | 400 mono | `.crypto-block` letter-spacing 0.05–0.06em |
| Hint / timestamp | 10–12px | 400 | `--vw-text3` |

### Eyebrow labels

`.vw-section-label` and `.vw-field-label` are the only place uppercase-tracked text appears: 10px, `text-transform: uppercase`, `letter-spacing: 0.08em`, color `--vw-text3`. Reserved for naming a field or section inside / between cards — never used as a decorative "process / pricing" header on the chat surface. This is a product surface; the eyebrow-on-every-section trope is explicitly off the table.

## Spacing & layout

- **App shell** is capped at 720px wide on desktop. Wider viewports show the painted mascot watermark in the right gutter.
- **Mobile-first**: 100dvh (not 100vh) to track the visible viewport under URL bar / keyboard chrome. `overflow-x: clip` (not `hidden`) on html/body prevents iOS Safari horizontal pannable-viewport bugs without breaking long-page vertical scroll.
- **Padding rhythm** (loose convention, not a token):
  - Topbar: `14px 20px 12px`
  - Card: `12px 16px` (`.vw-card`)
  - Input: `9px 12px`
  - Pill: `2px 7px`
  - Badge: `3px 8px`
  - Bubble: `9px 13px`
- **Radii**:
  - Pills / badges: `99px`
  - Buttons: `8px`
  - Inputs: `8px` (or `20px` for `.vw-input-pill`)
  - Cards / popovers: `10–12px`
  - Chat bubbles: `14px 14px 4px 14px` (me) / `14px 14px 14px 4px` (them) — the corner cut points toward the speaker
  - Send button: `50%` (36×36 circle)
  - `.crypto-block`: `6px`
- **Borders** are universally `0.5px` (hairline) — the painted aesthetic doesn't want hard lines. Modern browsers render 0.5px correctly on retina; on legacy displays it snaps to 1px, which is still acceptable.

## Z-layer system

Stacking is reviewable in one place. New popovers / modals / toasts pick the matching slot rather than inventing a magic number.

| Token | Value | Slot |
|---|---|---|
| `--vw-z-dropdown` | `50` | Header / row ⋯ menus, sticker picker, reaction picker |
| `--vw-z-sticky` | `100` | Sticky bars, viewport-pinned mini overlays |
| `--vw-z-modal-backdrop` | `800` | Backdrop just under its modal so multiple modals can nest |
| `--vw-z-modal` | `900` | Fullscreen takeovers — lightbox today, future confirm modals |
| `--vw-z-toast` | `1000` | Transient feedback that must sit above modal content |
| `--vw-z-tooltip` | `1100` | Pointer-anchored, always wins |

Never write a literal z-index in component CSS. If a new component needs a slot the table doesn't cover, add a new token first and reference it from the component.

## Conventions & exceptions

- **2px `border-left` on reply quotes is the project's blockquote convention.** It appears on `.reply-preview-snippet` (input bar) and `.reply-jump` (inside `ChatMessageBubble`). The impeccable absolute ban on side-stripe borders >1px targets *decorative card accents*; the reply-quote stripe is semantic blockquote indentation in the lineage of Twitter / Slack / iMessage. Scoped to reply-quote use only — don't reach for the same pattern as a generic callout accent.
- **Hit areas extend beyond visible chrome via `::before { position: absolute; inset: -Npx; }`.** Visual density of buttons (28–36px) is part of the painted aesthetic; the pseudo-element keeps tap area ≥44×44 without inflating the visible button. Applied to `.back-btn`, `.header-menu-btn`, `.attach-btn`, `.vw-btn-send`, `.lightbox-close`.

## Components

The shared component vocabulary lives in `src/components/` and in `theme.css` utility classes. New components should compose these rather than re-implementing chrome.

| Component / class | Source | Role |
|---|---|---|
| `AppLogo.vue` | components | Whisp mascot + wordmark in topbars and splash |
| `AppIcon.vue` | components | Stroke-only line icons |
| `UserAvatar.vue` | components | Painted avatar block (fingerprint-derived hue) |
| `SecondaryPage.vue` | components | Standard layout for Profile / Create / Join / Migrate |
| `SessionRow.vue` | components | Home-list row with pin/archive/⋯ menu |
| `ChatMessageBubble.vue` | components | Me/them bubble with reactions + vanish line |
| `ChatRenamePanel.vue` | components | Inline label editor in chat |
| `DeleteBanner.vue` | components | Mutual-delete pending state |
| `StickerPicker.vue` | components | Floating popover for the nine Whisp stickers |
| `InviteShareButtons.vue` | components | `navigator.share` + clipboard fallback |
| `InAppBrowserBanner.vue` | components | "Open in real browser" warning |
| `.vw-card` / `.vw-card--hero` | theme.css | Lifted card; hero overlays diagonal purple wash |
| `.vw-topbar` | theme.css | Standard top navigation strip |
| `.vw-input` / `.vw-input-pill` | theme.css | Inset input slot with purple focus halo |
| `.vw-btn-primary` / `.vw-btn-send` | theme.css | Pill button + 36px circular send button |
| `.vw-badge-e2e` | theme.css | Mint pill for encryption confirmation |
| `.vw-pill` / `.vw-pill--live` | theme.css | Purple "unread" → mint "live" countdown pill |
| `.vw-popover` / `.vw-popover-item` | theme.css | Floating menu surface shared by ⋯ menus + pickers |
| `.vw-bubble-me` / `.vw-bubble-them` | theme.css | Chat bubble pair |
| `.crypto-block` / `.crypto-block.fingerprint` | theme.css | Mono inset slot for UIDs and fingerprints |
| `.vw-section-label` / `.vw-field-label` | theme.css | Uppercase-tracked eyebrow inside/between cards |
| `.vw-back-link` | theme.css | Top-of-secondary-page back affordance |

## Motion

Motion is part of the brand, not an afterthought — but it's calm, never bouncy. Reduced-motion users get every animation suppressed via `@media (prefers-reduced-motion: reduce)` at the top of `theme.css`.

| Motion | What it does | When |
|---|---|---|
| `msg-deplete` | CSS animation depleting a 0.5px line under a vanishing message | Once `ReadAt` fires, runs over the recipient's configured `DeletedInMinutes` |
| Pill flip | `--vw-pill` → `--vw-pill--live` (color + bg swap) | The moment recipient acks read |
| Splash stagger | Logo + mascot fade-in on first paint | App boot |
| Focus halo | `box-shadow: 0 0 0 3px color-mix(--vw-purple-mid 20%, transparent)` | Input focus |
| Hover transitions | Background-color / border-color 150ms | Interactive elements (left running even under reduce-motion — tactile feedback, not motion) |
| Mascot ghost-fade | Subtle opacity breathe on splash mascot | App boot only, never persistent |
| Lightbox fade | Image lightbox crossfade | Image attachment tap |

Easing default: 150ms cubic-bezier(0.25, 0.1, 0.25, 1) (CSS `ease`). No bounce, no elastic. The vanish line uses `linear` because it's a literal time-remaining indicator and any easing would lie about the schedule.

## Atmosphere

Two paint-passes that distinguish this surface from "another dark Vue app":

- **Film grain.** A 160×160 SVG noise tile via `feTurbulence`, served as a data URL (~600 bytes in-bundle), tiled on `body` and `.app-shell` at white-alpha 0.08. `stitchTiles="stitch"` keeps tile seams invisible.
- **Purple radial.** An 80% × 60% ellipse from just above the viewport top, fading `color-mix(--vw-purple-mid 18%, transparent)` → transparent over the top 70% of the page. Adds vertical depth so the page reads as a "scene" rather than a flat panel.

Both painted under the solid `--vw-bg` so any future shorthand override still has a base color.

## Imagery

- **Painted Whisp mascot** (`src/assets/whisp-mascot.png`, 1024×1024 RGBA). Single source for tab favicon, topbar `AppLogo`, iOS home-screen tile (composited on `--vw-bg`), Open Graph hero. No SVG variant: the painted character (mint eyes, pink nose, whiskers) doesn't reduce to geometric vectors without losing identity.
- **Sticker set** (`src/assets/stickers/`, 9 PNGs). Bundled, not user-uploadable. Re-used on Home empty states (`hello` for first-run, `sleep` for "all archived") so empty states feel furnished without extra art budget.

## Accessibility verification checklist

- [x] Body text (`--vw-text` on `--vw-bg`) ≥4.5:1 — passes at ≈15.1:1
- [x] Muted text (`--vw-text2`) ≥4.5:1 on the surfaces it appears on — passes at ≈6.5:1 / ≈5.8:1
- [x] Hint text (`--vw-text3`) ≥4.5:1 — passes at ≈5.2:1 / ≈4.6:1 after the 2026-05-29 lift
- [x] Mint badge (`--vw-green-strong` on `--vw-green-dim`) ≥4.5:1 — passes at ≈7.2:1
- [x] Purple-pale on purple-deep bubble ≥4.5:1 — passes at ≈8.0:1
- [x] Danger (`--vw-danger` on `--vw-surface2`) ≥4.5:1 — passes at ≈5.2:1
- [ ] Focus halo visible against every surface where inputs appear
- [ ] All icon-only buttons have `aria-label`
- [x] Touch targets ≥44×44px on phone — chat surface meets target via ::before hit-area expansion (back-btn, header-menu-btn, attach-btn, vw-btn-send, lightbox-close); verify HomeView and SecondaryPage controls separately
- [x] Reduced-motion media query suppresses every named animation above — covered by `theme.css` global rule
