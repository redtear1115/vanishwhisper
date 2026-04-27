<script setup lang="ts">
import { ref } from 'vue'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'

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
  <section>
    <h2>Create chat session</h2>
    <p>Your UID (share out-of-band):</p>
    <p><code>{{ identity?.uid }}</code></p>
    <hr />
    <form @submit.prevent="submit">
      <label>
        Invitee UID:
        <input v-model="inviteeUid" required :disabled="submitting" />
      </label>
      <button type="submit" :disabled="submitting || !inviteeUid">
        {{ submitting ? 'Creating…' : 'Invite' }}
      </button>
    </form>
    <p v-if="error" style="color: crimson">{{ error }}</p>
    <p v-if="createdSessionId">
      Session created: <code>{{ createdSessionId }}</code>
    </p>
    <p><router-link to="/">← Back</router-link></p>
  </section>
</template>
