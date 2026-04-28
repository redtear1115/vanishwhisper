<script setup lang="ts">
import { useIdentity } from './identity'
import AppLogo from './components/AppLogo.vue'
// Painted mascot for the splash. Vite hashes the URL for cache-busting.
// Topbars throughout the app keep using AppLogo (the inline SVG) — at
// 24-36px sizes the SVG looks crisper than scaling down a 1024 raster.
import mascotUrl from './assets/whisp-mascot.png'

const { identity, error } = useIdentity()
</script>

<template>
  <div class="app-shell">
    <div v-if="error" class="app-state">
      <AppLogo size="md" />
      <p class="vw-text-danger" style="font-size:13px;">Sign-in failed: {{ String(error) }}</p>
    </div>
    <div v-else-if="!identity" class="app-state">
      <img :src="mascotUrl" alt="VanishWhisper" class="splash-mascot" />
      <div class="loading-dots">
        <span /><span /><span />
      </div>
      <p style="font-size:12px;color:var(--vw-text3);">Signing in anonymously…</p>
    </div>
    <router-view v-else />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  /* Cap the column on desktop — full-width chat past ~720px reads as a
     wall of text. On phones this collapses naturally to the viewport
     width since max-width takes the smaller value. */
  max-width: 720px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  /* Distinguish the centered column slightly from the body background so
     the boundary reads as "this is the app". On mobile the side gutters
     are zero so this is invisible there. */
  background: var(--vw-bg);
  box-shadow: 0 0 0 0.5px var(--vw-border);
}

.app-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.splash-mascot {
  width: 220px;
  height: auto;
  display: block;
  /* Subtle floating shadow under the ghost so it doesn't look pasted onto
     the bg. Mint green to echo the brand secondary, very low opacity. */
  filter: drop-shadow(0 8px 24px color-mix(in srgb, var(--vw-purple-mid) 40%, transparent));
  animation: ghost-fade 2.8s ease-in-out infinite;
}

@keyframes ghost-fade {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .splash-mascot { animation: none; }
}

.loading-dots {
  display: flex;
  gap: 6px;
}
.loading-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vw-purple-mid);
  animation: pulse 1.2s ease-in-out infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40%            { opacity: 1;   transform: scale(1);   }
}
</style>
