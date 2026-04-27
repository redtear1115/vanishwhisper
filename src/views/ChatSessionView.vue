<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getIdentity } from '../identity'
import {
  markDeleted,
  markRead,
  sendMessage,
  subscribeMessages,
  type ChatMessageRow,
} from '../messages'
import { openSession, type OpenSession } from '../sessions'
import { getDeletedInMinutes } from '../users'

const props = defineProps<{ id: string }>()

const opened = ref<OpenSession | null>(null)
const messages = ref<ChatMessageRow[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
const now = ref(Date.now())
// Vanish duration is the *recipient's* DeletedInMinutes. We need both: messages
// I sent vanish on the other party's setting; messages they sent vanish on mine.
const myMinutes = ref<number | null>(null)
const otherMinutes = ref<number | null>(null)

// Idempotency guards — first snapshot for an unread inbound message fires
// markRead, but subsequent snapshots (the modify echo, reconnect replays) must
// not re-fire it. Same for markDeleted at expiry.
const readFired = new Set<string>()
const deletedFired = new Set<string>()

let unsub: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  try {
    const session = await openSession(props.id)
    opened.value = session
    const me = getIdentity()
    const [mine, theirs] = await Promise.all([
      getDeletedInMinutes(me.uid),
      getDeletedInMinutes(session.otherParticipant),
    ])
    myMinutes.value = mine
    otherMinutes.value = theirs
    unsub = subscribeMessages(
      props.id,
      session.sessionKey,
      (rows) => {
        messages.value = rows
        ackUnread(rows)
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
    timer = setInterval(() => {
      now.value = Date.now()
      tickVanish()
    }, 1000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

onUnmounted(() => {
  unsub?.()
  if (timer !== null) clearInterval(timer)
})

function ackUnread(rows: ChatMessageRow[]): void {
  for (const m of rows) {
    if (m.fromMe || m.readAt || readFired.has(m.id)) continue
    readFired.add(m.id)
    markRead(m.id).catch((err) => {
      readFired.delete(m.id) // allow retry on the next snapshot
      console.error('markRead failed', err)
    })
  }
}

function vanishAtMs(m: ChatMessageRow): number | null {
  if (!m.readAt) return null
  const minutes = m.fromMe ? otherMinutes.value : myMinutes.value
  if (minutes === null) return null
  return m.readAt.getTime() + minutes * 60_000
}

function isVanished(m: ChatMessageRow, atMs: number): boolean {
  if (m.deletedAt) return true
  const at = vanishAtMs(m)
  return at !== null && atMs >= at
}

const visibleMessages = computed(() =>
  messages.value.filter((m) => !isVanished(m, now.value)),
)

function tickVanish(): void {
  // Recipient writes DeletedAt — sender's client just hides locally. If a
  // recipient closes their tab before expiry, the doc lingers until they're
  // back online; both sides have already hidden it from their own UI.
  for (const m of messages.value) {
    if (m.fromMe || m.deletedAt || deletedFired.has(m.id)) continue
    const at = vanishAtMs(m)
    if (at !== null && now.value >= at) {
      deletedFired.add(m.id)
      markDeleted(m.id).catch((err) => {
        deletedFired.delete(m.id)
        console.error('markDeleted failed', err)
      })
    }
  }
}

async function send(): Promise<void> {
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

function vanishLabel(m: ChatMessageRow): string {
  const at = vanishAtMs(m)
  if (at === null) return 'unread'
  const remaining = Math.max(0, at - now.value)
  const totalSeconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `vanishes in ${minutes}m ${String(seconds).padStart(2, '0')}s`
}
</script>

<template>
  <section>
    <p><router-link to="/">← Sessions</router-link></p>
    <h2>Chat</h2>
    <p v-if="error" style="color: crimson">{{ error }}</p>
    <template v-if="opened">
      <p style="color: gray">
        With <code>{{ opened.otherParticipant }}</code>
      </p>
      <ul>
        <li v-for="m in visibleMessages" :key="m.id">
          <strong>{{ m.fromMe ? 'me' : 'them' }}:</strong>
          <span v-if="m.text !== null">{{ m.text }}</span>
          <span v-else style="color: crimson">[unable to decrypt]</span>
          <span style="color: gray; font-size: 0.85em">
            · {{ m.createdAt?.toLocaleTimeString() ?? '…' }}
            · {{ vanishLabel(m) }}
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
