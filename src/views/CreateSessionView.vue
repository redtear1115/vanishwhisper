<script setup lang="ts">
import { ref } from 'vue'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()

const inviteeUid = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const createdSessionId = ref<string | null>(null)

async function submit() {
  error.value = null
  createdSessionId.value = null
  submitting.value = true
  try {
    createdSessionId.value = await createSession(inviteeUid.value.trim())
    inviteeUid.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="create">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="create-body">
      <router-link to="/" class="back-link">← Sessions</router-link>

      <div class="section-label">New session</div>

      <div class="vw-card uid-display">
        <div class="field-label">Your UID (share out-of-band)</div>
        <code class="uid-val">{{ identity?.uid }}</code>
      </div>

      <div class="divider" />

      <form @submit.prevent="submit" class="invite-form">
        <div class="vw-card form-card">
          <div class="field-label">Invitee UID</div>
          <input
            v-model="inviteeUid"
            class="vw-input"
            required
            :disabled="submitting"
            placeholder="Paste their UID here…"
          />
          <p class="field-hint">Ask the other person to share their UID via a separate channel.</p>
        </div>

        <button
          type="submit"
          class="vw-btn-primary submit-btn"
          :disabled="submitting || !inviteeUid"
        >
          {{ submitting ? 'Creating…' : 'Generate encrypted session' }}
        </button>
      </form>

      <p v-if="error" class="vw-text-danger" style="font-size:13px;">{{ error }}</p>

      <div v-if="createdSessionId" class="success-box">
        Session created: <code>{{ createdSessionId }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.create-body {
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

.uid-display {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.uid-val {
  font-size: 12px;
  color: var(--vw-purple-light);
  word-break: break-all;
  line-height: 1.5;
}

.divider {
  border: none;
  border-top: 0.5px solid var(--vw-border);
}

.invite-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
}

.submit-btn {
  width: 100%;
  justify-content: center;
}
.submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.success-box {
  background: var(--vw-green-dim);
  border: 0.5px solid var(--vw-green-deep);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--vw-green-strong);
}
.success-box code {
  color: var(--vw-green);
  font-family: ui-monospace, monospace;
}
</style>
