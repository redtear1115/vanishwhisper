// Clipboard / Web Share plumbing for the user's own UID and invite link,
// extracted from CreateSessionView and ProfileView (they each had a
// near-verbatim copy: same inviteUrl helper, same flashCopied trick,
// same `title only no text` quirk for navigator.share). Centralising it
// here means future tweaks (renaming the share title, switching off the
// 1500ms flash, adding a QR fallback) land in one file.
//
// This composable does NOT keep its own error state. Both consumers
// have an existing `error` ref that already carries failures from
// other operations (createSession, getDeletedInMinutes, etc.) — adding
// a second error surface would split the user's mental model. Instead,
// callers pass `onError` and the composable hands any caught failure
// back as a string, which the caller can route into its own error
// banner. AbortError from navigator.share (user dismissed the sheet)
// is silenced upstream so it never reaches `onError`.

import { ref, type Ref } from 'vue'
import { useIdentity } from './identity'

export interface UseInviteShareOptions {
  onError?: (msg: string) => void
}

export function useInviteShare(opts?: UseInviteShareOptions) {
  const { identity } = useIdentity()
  const linkCopied = ref(false)
  const uidCopied = ref(false)
  // navigator.share availability is fixed for the page lifetime — desktop
  // Chrome / Firefox don't have it, mobile Safari + Chrome do. Computed
  // once at composable setup so consumers can `v-if` against it without
  // a per-render check.
  const supportsShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  function flash(target: Ref<boolean>): void {
    target.value = true
    setTimeout(() => {
      target.value = false
    }, 1500)
  }

  function reportError(err: unknown): void {
    opts?.onError?.(err instanceof Error ? err.message : String(err))
  }

  function inviteUrl(): string {
    if (!identity.value) return ''
    return `${window.location.origin}/join/${identity.value.uid}`
  }

  async function copyInviteLink(): Promise<void> {
    if (!identity.value) return
    try {
      await navigator.clipboard.writeText(inviteUrl())
      flash(linkCopied)
    } catch (err) {
      reportError(err)
    }
  }

  async function copyUid(): Promise<void> {
    if (!identity.value) return
    try {
      await navigator.clipboard.writeText(identity.value.uid)
      flash(uidCopied)
    } catch (err) {
      reportError(err)
    }
  }

  // `title` only (no `text`) so receivers paste a clean URL — some
  // share targets (Messages, Notes, Mail) concatenate text + url as
  // two lines and break the click-to-join flow.
  async function shareInviteLink(): Promise<void> {
    if (!identity.value) return
    try {
      await navigator.share({ title: 'VanishWhisper invite', url: inviteUrl() })
    } catch (err) {
      // User dismissed the share sheet — silent. Anything else surfaces.
      if (err instanceof Error && err.name === 'AbortError') return
      reportError(err)
    }
  }

  return {
    identity,
    linkCopied,
    uidCopied,
    supportsShare,
    copyInviteLink,
    copyUid,
    shareInviteLink,
  }
}
