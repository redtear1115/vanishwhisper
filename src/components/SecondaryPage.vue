<script setup lang="ts">
// Page scaffold for every "not the chat list, not the chat itself" view —
// Profile / Create / Join / Migrate. Each was previously a hand-rolled
// `<div class="${name}"><header><AppLogo /></header><div class="${name}-body">
// <router-link class="back-link">…</router-link>` template plus a copy of
// the same flex-column layout CSS. Centralising it here means a future
// redesign of secondary-page chrome (top-bar variant, body padding,
// scroll behaviour) lands in one place rather than four.
//
// Slot is intentionally just the default — there's no consumer for a
// header-extra slot today (every secondary view shows just the logo),
// and adding one preemptively would invent an API with no shape feedback.
import AppLogo from './AppLogo.vue'
import AppIcon from './AppIcon.vue'
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  /** Where the back link goes. Omit to render no back link at all. */
  backTo?: RouteLocationRaw
  /** Label rendered next to the back arrow. */
  backLabel?: string
}>()
</script>

<template>
  <div class="secondary-page">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>
    <div class="secondary-page-body">
      <router-link v-if="backTo" :to="backTo" class="vw-back-link">
        <AppIcon name="back" :size="14" />
        {{ backLabel ?? 'Sessions' }}
      </router-link>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.secondary-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.secondary-page-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
