<script setup lang="ts">
import { ref } from 'vue'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'
import InviteShareButtons from '../components/InviteShareButtons.vue'
import SecondaryPage from '../components/SecondaryPage.vue'

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
  <SecondaryPage back-to="/">
    <div class="vw-section-label">New session</div>

    <div class="vw-card uid-display">
      <div class="vw-field-label">Your UID (share out-of-band)</div>
      <code class="crypto-block">{{ identity?.uid ?? '…' }}</code>
      <InviteShareButtons @error="(msg) => (error = msg)" />
      <p class="share-hint">
        The link drops the recipient on a confirm-and-start page — one tap and you're in an
        encrypted session together.
      </p>
    </div>

    <div class="divider" />

    <form @submit.prevent="submit" class="invite-form">
      <div class="vw-card form-card">
        <div class="vw-field-label">Invitee UID</div>
        <input
          v-model="inviteeUid"
          class="vw-input"
          required
          :disabled="submitting"
          placeholder="Paste their UID here…"
        />
        <p class="field-hint">Ask the other person to share their UID via a separate channel.</p>
      </div>

      <button type="submit" class="vw-btn-primary submit-btn" :disabled="submitting || !inviteeUid">
        {{ submitting ? 'Creating…' : 'Generate encrypted session' }}
      </button>
    </form>

    <p v-if="error" class="vw-text-danger" style="font-size: 13px">{{ error }}</p>

    <div v-if="createdSessionId" class="success-box">
      Session created: <code>{{ createdSessionId }}</code>
    </div>
  </SecondaryPage>
</template>

<style scoped>
.uid-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.share-hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
  margin: 4px 0 0;
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
  font-family: var(--vw-font-mono);
}
</style>
