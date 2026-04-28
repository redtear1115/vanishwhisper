<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'
import AppLogo from '../components/AppLogo.vue'

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
  <div class="join">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="join-body">
      <router-link to="/" class="back-link">← Sessions</router-link>

      <div class="section-label">Encrypted invite</div>

      <div class="vw-card">
        <div class="field-label">Inviter UID</div>
        <code class="uid-val">{{ uid }}</code>
        <p class="hint">
          You've been invited to start an end-to-end encrypted session.
          Confirm below to generate a new session. The inviter's UID and
          yours are stored on Firestore as participants, but the chat
          contents are encrypted with a per-session key only the two of
          you can decrypt.
        </p>
      </div>

      <p
        v-if="identity?.uid === uid"
        class="vw-text-danger"
        style="font-size: 13px"
      >That's your own UID — you can't invite yourself.</p>

      <button
        v-else
        type="button"
        class="vw-btn-primary start-btn"
        :disabled="creating || !identity"
        @click="start"
      >{{ creating ? 'Creating…' : 'Start encrypted session' }}</button>

      <p v-if="error" class="vw-text-danger" style="font-size: 13px">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.join-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.back-link {
  font-size: 12px;
  color: var(--vw-purple-light);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.back-link:hover { color: var(--vw-purple-pale); }

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-bottom: 6px;
}

.uid-val {
  font-size: 12px;
  color: var(--vw-purple-light);
  word-break: break-all;
  line-height: 1.5;
  display: block;
}

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
