// Document-level click-outside + Esc dismiss for transient UI (overflow
// menus, pickers, lightboxes). Replaces the same hand-rolled
// onMounted/onUnmounted addEventListener pair that was duplicated in
// SessionRow's per-row menu and ChatSessionView's header menu / sticker
// picker / reaction picker / lightbox handlers.
//
// Contract: callers attach @click.stop to the popover's open trigger and
// inner content so legitimate clicks INSIDE never bubble to document —
// anything that does reach our handler is by definition outside, so we
// just fire onClickOutside unconditionally without doing any DOM
// hit-testing. Same approach the original handlers used.
//
// Listeners are wired conditionally on which callbacks the caller passed
// — a popover that only cares about Esc (e.g. a modal with a backdrop
// that already absorbs outside clicks) doesn't pay for a click listener.
import { onMounted, onUnmounted } from 'vue'

export function useDocumentDismiss(opts: {
  onClickOutside?: () => void
  onEscape?: () => void
}): void {
  function onClick() {
    opts.onClickOutside?.()
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') opts.onEscape?.()
  }

  onMounted(() => {
    if (opts.onClickOutside) document.addEventListener('click', onClick)
    if (opts.onEscape) document.addEventListener('keydown', onKeydown)
  })
  onUnmounted(() => {
    if (opts.onClickOutside) document.removeEventListener('click', onClick)
    if (opts.onEscape) document.removeEventListener('keydown', onKeydown)
  })
}
