<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { openSession, type OpenSession } from '../sessions'
import { sendMessage, subscribeMessages, type ChatMessageRow } from '../messages'

const props = defineProps<{ id: string }>()

const opened = ref<OpenSession | null>(null)
const messages = ref<ChatMessageRow[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
let unsub: (() => void) | null = null

onMounted(async () => {
  try {
    const session = await openSession(props.id)
    opened.value = session
    unsub = subscribeMessages(
      props.id,
      session.sessionKey,
      (rows) => {
        messages.value = rows
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

onUnmounted(() => {
  unsub?.()
})

async function send() {
  if (!opened.value || !draft.value.trim()) return
  sending.value = true
  error.value = null
  try {
    await sendMessage(props.id, opened.value.sessionKey, draft.value)
    draft.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section>
    <p><router-link to="/">← Sessions</router-link></p>
    <h2>Chat</h2>
    <p v-if="error" style="color: crimson">{{ error }}</p>
    <template v-if="opened">
      <p style="color: gray">With <code>{{ opened.otherParticipant }}</code></p>
      <ul>
        <li v-for="m in messages" :key="m.id">
          <strong>{{ m.fromMe ? 'me' : 'them' }}:</strong>
          <span v-if="m.text !== null">{{ m.text }}</span>
          <span v-else style="color: crimson">[unable to decrypt]</span>
          <span style="color: gray; font-size: 0.85em">
            · {{ m.createdAt?.toLocaleTimeString() ?? '…' }}
          </span>
        </li>
      </ul>
      <form @submit.prevent="send">
        <input v-model="draft" :disabled="sending" placeholder="Type a message…" required />
        <button type="submit" :disabled="sending || !draft">
          {{ sending ? '…' : 'Send' }}
        </button>
      </form>
    </template>
    <p v-else-if="!error">Opening session…</p>
  </section>
</template>
