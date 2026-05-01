<script setup lang="ts">
// All chrome icons in one place — single SVG component dispatched by
// `name` prop. Replaces the prior mix of Unicode glyphs (←, ⋯, ⚙, ↩, ▾,
// ×, +) and emoji (📎, 😺), which had inconsistent line weights, varied
// per-platform render, and felt improvised next to the painted Whisp
// mascot.
//
// Design language:
//   - 24×24 viewBox, 1.5px stroke (matches the Whisp PNG's painted-line
//     weight when scaled to topbar / button sizes).
//   - `currentColor` stroke + fill so icons inherit whatever text color
//     the parent sets — no per-icon palette plumbing.
//   - Round caps + round joins everywhere → reads as "drawn by hand"
//     rather than "machine-generated", aligning with the mascot.
//   - Stroke-only (no filled shapes) except the three-dot 'more' and
//     pupil dots in 'sticker', where filled circles read more cleanly
//     at small sizes.
//
// Usage:
//   <AppIcon name="back" />
//   <AppIcon name="chevron" :size="14" />            // size in px (default 24)
//   <AppIcon name="chevron" class="rotate-90" />     // rotate via CSS
//
// To add an icon: extend the IconName union, add a `<template v-else-if>`
// block with the path data, keep stroke-width 1.5 for visual cohesion.
type IconName =
  | 'back'
  | 'plus'
  | 'more'
  | 'settings'
  | 'reply'
  | 'chevron'
  | 'close'
  | 'attach'
  | 'sticker'
  | 'warning'

withDefaults(
  defineProps<{
    name: IconName
    size?: number
  }>(),
  { size: 24 },
)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="vw-icon"
    aria-hidden="true"
  >
    <!-- back: leftward chevron -->
    <path v-if="name === 'back'" d="M15 6L9 12l6 6" />

    <!-- plus: simple cross -->
    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />

    <!-- more: three filled dots (legibility win over hairline rings at
         small sizes) -->
    <template v-else-if="name === 'more'">
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </template>

    <!-- settings: gear with 8 spokes -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </template>

    <!-- reply: arrow turning back and curving down — reads as "respond
         to this" without needing a label -->
    <path v-else-if="name === 'reply'" d="M9 14l-4-4 4-4M5 10h9a4 4 0 014 4v4" />

    <!-- chevron: rightward by default. Rotate via CSS for down (Archive
         expand state uses .rotate-90). -->
    <path v-else-if="name === 'chevron'" d="M9 6l6 6-6 6" />

    <!-- close: × — used for lightbox dismiss, reply chip cancel, and
         per-bubble unsend -->
    <path v-else-if="name === 'close'" d="M6 6l12 12M6 18L18 6" />

    <!-- attach: paperclip. Single continuous stroke from the closed top
         curve down through the open hook at the bottom-left. -->
    <path
      v-else-if="name === 'attach'"
      d="M21 13.5l-9 9a6 6 0 11-8.5-8.5l9-9a4 4 0 015.7 5.7l-9 9a2 2 0 11-2.8-2.8l8-8"
    />

    <!-- sticker (picker trigger): smiley. Replaces the 😺 emoji —
         abstract enough to read as "expressive content" rather than
         specifically the cat sticker pack. Pupil dots filled for
         legibility at the 16px button size. -->
    <template v-else-if="name === 'sticker'">
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="0.7" fill="currentColor" stroke="none" />
      <path d="M8 14c1 1.5 2.5 2.5 4 2.5s3-1 4-2.5" />
    </template>

    <!-- warning: triangle + exclamation. For irreversible / destructive
         affordances where pure red filled-button would be too aggressive
         but neutral outlined would be too quiet. The dot for the
         exclamation's lower point is a small filled circle (more
         legible than a tiny stroke segment at 14-16px sizes). -->
    <template v-else-if="name === 'warning'">
      <path d="M12 3 L 21 19 L 3 19 Z" />
      <path d="M12 10 v 4" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>

<style scoped>
.vw-icon {
  display: block;
  flex-shrink: 0;
  /* Smooth rotation for chevron-as-toggle and any other future
     orientation switches — matches the .15s duration used elsewhere
     for hover/transition. */
  transition: transform 0.2s;
}
.vw-icon.rotate-90 {
  transform: rotate(90deg);
}
</style>
