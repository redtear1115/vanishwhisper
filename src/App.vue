<script setup lang="ts">
import { useIdentity } from './identity'

const { identity, error } = useIdentity()
</script>

<template>
  <main>
    <h1>VanishWhisper</h1>
    <p v-if="error">Sign-in failed: {{ String(error) }}</p>
    <p v-else-if="!identity">Signing in…</p>
    <router-view v-else />
  </main>
</template>
