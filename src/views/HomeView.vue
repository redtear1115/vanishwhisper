<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdentity } from '../identity'
import { useSessions } from '../sessions'

const { identity } = useIdentity()
const { sessions, error: sessionsError } = useSessions()
const fingerprint = ref<string | null>(null)

watch(
  identity,
  async (id) => {
    if (!id) {
      fingerprint.value = null
      return
    }
    const spki = Uint8Array.from(atob(id.publicKeySpkiBase64), (c) => c.charCodeAt(0))
    const hash = await crypto.subtle.digest('SHA-256', spki)
    fingerprint.value = Array.from(new Uint8Array(hash))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':')
  },
  { immediate: true },
)

function relativeTime(d: Date | null): string {
  if (!d) return ''
  const sec = (Date.now() - d.getTime()) / 1000
  if (sec < 60) return `${Math.floor(sec)}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
</script>

<template>
  <section>
    <p><strong>Your UID:</strong> <code>{{ identity?.uid }}</code></p>
    <p><strong>Public key fingerprint:</strong> <code>{{ fingerprint ?? '…' }}</code></p>
    <p><router-link to="/create">+ Create new chat session</router-link></p>

    <h2>Sessions</h2>
    <p v-if="sessionsError" style="color: crimson">{{ String(sessionsError) }}</p>
    <p v-else-if="sessions.length === 0">No sessions yet.</p>
    <ul v-else>
      <li v-for="s in sessions" :key="s.id">
        <router-link :to="{ name: 'session', params: { id: s.id } }">
          <code>{{ s.id }}</code>
        </router-link>
        — with <code>{{ s.otherParticipant }}</code>
        <span style="color: gray"> · {{ relativeTime(s.updatedAt) }}</span>
      </li>
    </ul>
  </section>
</template>
