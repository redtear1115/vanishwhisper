<script setup lang="ts">
// Three-button cluster for sharing your own invite link / UID. Used
// from both /create (when starting a new session) and /profile (when
// adding another contact via "Copy invite link" or the share sheet).
// Wraps useInviteShare() so consumers don't see the clipboard / share
// plumbing — they drop the component in and listen for `error` so any
// failure routes into the surrounding view's existing error banner.
//
// Three buttons:
//   - Copy invite link (primary, headline action)
//   - Copy UID (secondary — for users who want to paste the bare id)
//   - Share… (only on browsers with navigator.share — mobile Safari +
//     Chrome — for routing the link straight to AirDrop / Signal /
//     Messages without a clipboard hop)
//
// Sizing matches the previous CreateSessionView .share-btn (12px /
// 6px 12px) — slightly larger than ProfileView's old .copy-btn (11px /
// 5px 12px), but still well within the secondary-button visual
// register. The 1px shift is a minor side-effect of unifying the two.
import { useInviteShare } from '../useInviteShare'

const emit = defineEmits<{ error: [msg: string] }>()

const { identity, linkCopied, uidCopied, supportsShare, copyInviteLink, copyUid, shareInviteLink } =
  useInviteShare({
    onError: (msg) => emit('error', msg),
  })
</script>

<template>
  <div class="invite-share-actions">
    <button type="button" class="invite-btn primary" :disabled="!identity" @click="copyInviteLink">
      {{ linkCopied ? '✓ Copied link' : 'Copy invite link' }}
    </button>
    <button type="button" class="invite-btn" :disabled="!identity" @click="copyUid">
      {{ uidCopied ? '✓ Copied' : 'Copy UID' }}
    </button>
    <button
      v-if="supportsShare"
      type="button"
      class="invite-btn"
      :disabled="!identity"
      @click="shareInviteLink"
    >
      Share…
    </button>
  </div>
</template>

<style scoped>
.invite-share-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

/* Outline-pill secondary button. .primary fills it for the headline
   action (Copy invite link), so the recipient-side flow gets visual
   priority over the raw-UID copy. */
.invite-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 0.5px solid var(--vw-border2);
  background: none;
  color: var(--vw-purple-light);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}
.invite-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.invite-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.invite-btn.primary {
  background: var(--vw-purple-deep);
  border-color: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.invite-btn.primary:hover:not(:disabled) {
  background: var(--vw-purple-mid);
  border-color: var(--vw-purple-mid);
}
</style>
