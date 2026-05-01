<script setup lang="ts">
// Floating panel that lets the user pick one of the bundled stickers to
// send. Renders only the panel (3×3 grid of sticker images) — the
// trigger button stays in the input bar where it belongs visually, and
// the open / close state stays in ChatSessionView so the existing
// useDocumentDismiss listener can keep coordinating dismissal across
// every transient popover (this picker, the reaction picker, the
// header overflow menu) from one place.
//
// .stop on the panel root prevents picks from bubbling up to the
// document-click-to-close handler. The list itself uses STICKERS from
// the registry so adding a new sticker only needs an entry there.
import { STICKERS } from '../stickers'

defineEmits<{
  pick: [stickerKey: string]
}>()
</script>

<template>
  <div class="vw-popover sticker-picker" @click.stop>
    <button
      v-for="s in STICKERS"
      :key="s.key"
      type="button"
      class="sticker-picker-item"
      :title="s.label"
      @click="$emit('pick', s.key)"
    >
      <img :src="s.url" :alt="s.label" />
    </button>
  </div>
</template>

<style scoped>
/* ── Sticker picker (floating panel above the input bar) ──
   `position: absolute` is anchored to .input-bar in the parent (which
   sets position:relative). Width matches the input area minus a little
   gutter so it visually "belongs" to the input row. Three columns ×
   three rows for the bundled nine stickers. Surface chrome inherited
   from .vw-popover; the inverted shadow direction (negative y) is the
   one piece that has to be local — the picker pops UP from the input
   bar so the shadow needs to fall above it, opposite of dropdown
   menus that fall below their trigger. */
.sticker-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 8px;
  right: 8px;
  border-radius: 12px;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  z-index: 50;
  box-shadow: 0 -4px 16px color-mix(in srgb, var(--vw-bg) 80%, transparent);
}

.sticker-picker-item {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 8px;
  aspect-ratio: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    transform 0.15s;
}
.sticker-picker-item:hover {
  background: var(--vw-surface);
  transform: scale(1.05);
}
.sticker-picker-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
</style>
