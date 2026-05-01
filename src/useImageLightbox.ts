// Fullscreen image overlay state. Holds the URL of the currently
// displayed image (null when closed), locks body scroll while open so
// wheel / pinch gestures land on the overlay rather than the chat
// underneath, and dismisses on Escape.
//
// We hold the URL string directly rather than a message id so the
// overlay keeps rendering even if the underlying message vanishes
// mid-view — the blob URL stays valid until subscribeMessages revokes
// it on the next snapshot, giving the user a moment to dismiss before
// the image goes blank.
//
// Cleanup is unconditional on unmount: if the user navigates away with
// the lightbox still open, the body scroll lock would otherwise persist
// across route changes and break scrolling on the next view. Same goes
// for the Esc listener — leaving it bound after unmount would leak.

import { onMounted, onUnmounted, ref } from 'vue'

export function useImageLightbox() {
  const lightboxUrl = ref<string | null>(null)

  function openLightbox(url: string): void {
    lightboxUrl.value = url
    document.body.style.overflow = 'hidden'
  }

  function closeLightbox(): void {
    lightboxUrl.value = null
    document.body.style.overflow = ''
  }

  // Esc is bound at the document level (capturing) so it fires regardless
  // of which element has focus when the user hits the key. The handler
  // no-ops when the lightbox is closed, so it's safe to leave installed
  // for the entire view lifetime — the parent's separate
  // useDocumentDismiss may also fire on the same Esc, but its lightbox
  // branch is gone now so the two don't collide.
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    if (lightboxUrl.value !== null) closeLightbox()
  }

  onMounted(() => {
    document.addEventListener('keydown', onEscape)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onEscape)
    // Defensive: restore body scroll if we're being torn down with the
    // overlay still open. closeLightbox() also clears the lightboxUrl
    // ref, but that's about to be GC'd anyway.
    document.body.style.overflow = ''
  })

  return {
    lightboxUrl,
    openLightbox,
    closeLightbox,
  }
}
