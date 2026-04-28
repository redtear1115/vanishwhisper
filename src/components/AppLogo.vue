<script setup lang="ts">
// Painted Whisp mascot (same PNG used by the splash, just rendered smaller).
// We previously had an inline SVG approximation here, but it lived alongside
// the painted version on the splash and the visual mismatch was distracting
// — keep one Whisp across the whole app instead. Browsers downsample the
// 1024 source cleanly enough at 28-44px topbar sizes.
import mascotUrl from '../assets/whisp-mascot.png'

defineProps<{
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()
</script>

<template>
  <div class="app-logo" :class="size ?? 'md'">
    <img :src="mascotUrl" alt="" class="logo-icon" aria-hidden="true" />
    <span v-if="showText !== false" class="logo-text">VanishWhisper</span>
  </div>
</template>

<style scoped>
.app-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  user-select: none;
}

.logo-icon {
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

.logo-text {
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--vw-purple-pale);
  white-space: nowrap;
}

/* Square aspect ratio because the painted mascot fits a square canvas (the
   ghost tail tapers within the same box as the head). The earlier SVG used
   a 48×54 portrait box, but downsampling a square PNG keeps the proportion
   consistent across surfaces. */
.sm .logo-icon { width: 32px; height: 32px; }
.sm .logo-text { font-size: 14px; }

.md .logo-icon { width: 44px; height: 44px; }
.md .logo-text { font-size: 16px; }

.lg .logo-icon { width: 60px; height: 60px; }
.lg .logo-text { font-size: 20px; }
</style>
