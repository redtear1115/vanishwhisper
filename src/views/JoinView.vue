<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'
import SecondaryPage from '../components/SecondaryPage.vue'

// /join/:uid lands here when someone opens an invite link. We deliberately
// require an explicit confirmation tap before calling createSession() —
// auto-creating on URL load would be a vector for accidental sessions
// (stale browser tabs, clipboard hijacks, link previews fetching the URL).
const props = defineProps<{ uid: string }>()
const router = useRouter()
const { identity } = useIdentity()

const creating = ref(false)
const error = ref<string | null>(null)

async function start(): Promise<void> {
  if (!identity.value) return
  if (identity.value.uid === props.uid) {
    error.value = "That's your own UID — you can't invite yourself."
    return
  }
  creating.value = true
  error.value = null
  try {
    const sessionId = await createSession(props.uid)
    // replace() so the back button goes to the session list, not back here.
    router.replace({ name: 'session', params: { id: sessionId } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <SecondaryPage back-to="/">
    <div class="vw-section-label">Encrypted invite</div>

    <div class="vw-card">
      <div class="vw-field-label">Inviter UID</div>
      <code class="crypto-block">{{ uid }}</code>
      <p class="hint">
        You've been invited to start an end-to-end encrypted session. Confirm below to generate a
        new session. The inviter's UID and yours are stored on Firestore as participants, but the
        chat contents are encrypted with a per-session key only the two of you can decrypt.
      </p>
    </div>

    <p v-if="identity?.uid === uid" class="vw-text-danger" style="font-size: 13px">
      That's your own UID — you can't invite yourself.
    </p>

    <button
      v-else
      type="button"
      class="vw-btn-primary start-btn"
      :disabled="creating || !identity"
      @click="start"
    >
      {{ creating ? 'Creating…' : 'Start encrypted session' }}
    </button>

    <p v-if="error" class="vw-text-danger" style="font-size: 13px">{{ error }}</p>
  </SecondaryPage>
</template>

<style scoped>
.hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
  margin: 8px 0 0;
}

.start-btn {
  width: 100%;
  justify-content: center;
}
.start-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
