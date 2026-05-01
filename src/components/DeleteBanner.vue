<script setup lang="ts">
// Mutual-delete banner that sits below the chat header whenever there's
// a pending DeleteRequestedBy on the session doc. Two flavours depending
// on who initiated:
//   - 'mine':   I requested. Single "Cancel request" action.
//   - 'theirs': They requested. Two actions — "Agree & delete" (danger,
//               cascade-deletes session + every message) and "Reject"
//               (clears DeleteRequestedBy back to null).
//
// `deleting` is held by the parent because the cascade delete is what
// the parent's own session-disappeared subscription guards against —
// see ChatSessionView.onAgreeDelete / unsubSession. We disable the
// banner buttons while the cascade is in flight to prevent a double
// trigger that would race the redirect.
//
// The component emits semantic actions (cancel / agree / reject) rather
// than booleans; the parent maps them to its existing handlers
// (cancelDeleteSession + agreeDeleteSession + cancelDeleteSession again
// for reject, since reject and cancel are the same Firestore op from
// either side's perspective).

defineProps<{
  state: 'mine' | 'theirs'
  /** True while the cascade delete is in flight (theirs → agree). */
  deleting?: boolean
}>()

defineEmits<{
  cancel: []
  agree: []
  reject: []
}>()
</script>

<template>
  <div v-if="state === 'mine'" class="delete-banner mine">
    <span>Waiting for the other party to agree to delete this session…</span>
    <button type="button" class="delete-banner-btn" @click="$emit('cancel')">Cancel request</button>
  </div>
  <div v-else class="delete-banner theirs">
    <span>The other party wants to delete this session and all messages.</span>
    <div class="delete-banner-actions">
      <button
        type="button"
        class="delete-banner-btn danger"
        :disabled="deleting"
        @click="$emit('agree')"
      >
        {{ deleting ? 'Deleting…' : 'Agree & delete' }}
      </button>
      <button type="button" class="delete-banner-btn" :disabled="deleting" @click="$emit('reject')">
        Reject
      </button>
    </div>
  </div>
</template>

<style scoped>
.delete-banner {
  padding: 12px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 0.5px solid var(--vw-border);
}
/* "Mine" — softer purple wash; the request is pending and not yet
   resolvable from this side. */
.delete-banner.mine {
  background: color-mix(in srgb, var(--vw-purple-light) 12%, transparent);
  color: var(--vw-purple-pale);
}
/* "Theirs" — danger wash; the user is about to be asked to commit to
   an irreversible cascade. */
.delete-banner.theirs {
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
  color: var(--vw-danger);
}
.delete-banner span {
  flex: 1;
  min-width: 200px;
}
.delete-banner-actions {
  display: flex;
  gap: 8px;
}
.delete-banner-btn {
  background: none;
  border: 0.5px solid currentColor;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.delete-banner-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vw-text) 6%, transparent);
}
.delete-banner-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.delete-banner-btn.danger {
  background: var(--vw-danger);
  border-color: var(--vw-danger);
  color: var(--vw-text);
}
.delete-banner-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vw-danger) 85%, transparent);
}
</style>
