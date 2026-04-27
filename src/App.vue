<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdentity } from './identity'

const { identity, error } = useIdentity()
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
</script>

<template>
  <main>
    <h1>VanishWhisper</h1>
    <p v-if="error">Sign-in failed: {{ String(error) }}</p>
    <p v-else-if="!identity">Signing in…</p>
    <template v-else>
      <p><strong>UID:</strong> <code>{{ identity.uid }}</code></p>
      <p><strong>Public key fingerprint:</strong> <code>{{ fingerprint ?? '…' }}</code></p>
    </template>
  </main>
</template>
