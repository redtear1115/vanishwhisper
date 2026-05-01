<script setup lang="ts">
// Inline rename UI for the per-session local labels (sessionName +
// otherName). Lives in the chat view as a dropdown panel under the
// header, opened from the ⋯ menu. Extracted from ChatSessionView so the
// view stays focused on chat plumbing — this component owns the draft
// form state, the save call, and the underlying-ids reference panel.
//
// Open state is owned by the parent via `v-model:open` because the chat
// view also needs to force-close the panel when other UI takes over
// (e.g. when the user requests session delete — banner replaces panel).
//
// Failures emit upward via `error` so the chat view's existing error
// banner stays the single error display surface — avoids a UX where
// errors from rename and errors from send/react/delete render in two
// different places.
//
// Drafts are seeded from labels store every time the panel opens (rather
// than on mount) so a save → close → reopen cycle reads the freshly
// persisted values, and a force-close from the parent doesn't leave
// stale draft state behind for the next open.
import { ref, watch } from 'vue'
import { setLabel, useLabels } from '../labels'

const props = defineProps<{
  open: boolean
  sessionId: string
  // Other participant uid. Null while openSession() is still in flight —
  // the underlying-ids row hides that line until it resolves.
  otherUid: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  error: [message: string]
}>()

const { labels } = useLabels()
const draftSessionName = ref('')
const draftOtherName = ref('')
const saving = ref(false)

// Seed drafts on each open. `immediate: true` so the very first open after
// mount populates correctly even if `open` started true.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const current = labels.value.get(props.sessionId)
    draftSessionName.value = current?.sessionName ?? ''
    draftOtherName.value = current?.otherName ?? ''
  },
  { immediate: true },
)

async function save(): Promise<void> {
  saving.value = true
  try {
    await setLabel(props.sessionId, {
      sessionName: draftSessionName.value,
      otherName: draftOtherName.value,
    })
    emit('update:open', false)
  } catch (err) {
    emit('error', err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="rename-panel">
    <label class="rename-field">
      <span class="rename-label">Session name</span>
      <input
        v-model="draftSessionName"
        class="vw-input"
        :disabled="saving"
        placeholder="e.g. Project chat"
        maxlength="64"
      />
    </label>
    <label class="rename-field">
      <span class="rename-label">Other party</span>
      <input
        v-model="draftOtherName"
        class="vw-input"
        :disabled="saving"
        placeholder="e.g. Alice"
        maxlength="64"
      />
    </label>
    <p class="rename-hint">Stored locally only — never uploaded.</p>

    <!-- Underlying ids — only place these surface in the UI. The rename
         panel is the natural home: user is in "manage labels" mode here,
         and seeing what each label "covers" helps when verifying you're
         naming the right person. -->
    <div class="rename-meta">
      <p>
        <span class="rename-meta-label">Session id</span> <code>{{ sessionId }}</code>
      </p>
      <p v-if="otherUid">
        <span class="rename-meta-label">Other UID</span> <code>{{ otherUid }}</code>
      </p>
    </div>

    <div class="rename-actions">
      <button type="button" class="vw-btn-primary" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <button type="button" class="rename-cancel" :disabled="saving" @click="cancel">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.rename-panel {
  padding: 14px 16px;
  background: var(--vw-surface2);
  border-bottom: 0.5px solid var(--vw-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.rename-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rename-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.rename-hint {
  font-size: 11px;
  color: var(--vw-text3);
  margin: 0;
}

/* Underlying ids info — sits between the label inputs and the action row,
   visually separated by a top border so it's clearly "what's actually
   there" reference data, not editable. */
.rename-meta {
  margin: 4px 0 2px;
  padding-top: 10px;
  border-top: 0.5px solid var(--vw-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--vw-text3);
}
.rename-meta p {
  margin: 0;
}
.rename-meta-label {
  display: inline-block;
  min-width: 70px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
}
.rename-meta code {
  word-break: break-all;
}

.rename-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.rename-cancel {
  background: none;
  border: 0.5px solid var(--vw-border2);
  border-radius: 8px;
  padding: 8px 14px;
  color: var(--vw-text2);
  font-size: 13px;
  cursor: pointer;
}
.rename-cancel:hover {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.rename-cancel:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
