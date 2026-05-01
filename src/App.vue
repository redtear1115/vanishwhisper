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
      <h1 class="splash-wordmark" aria-label="VanishWhisper">
        <!-- Each letter is its own span so the stagger reveal can hit
             them individually via animation-delay = i * 80ms. The whole
             wordmark's letter-spacing also opens up over the same window
             so the text settles into its final tracking — frontend-design
             skill calls this "one orchestrated moment > scattered
             micro-interactions" and that's what we're aiming for here.
             aria-label on the parent so screen readers read the word
             once, not 13 separated letters. -->
        <span v-for="(ch, i) in 'VanishWhisper'" :key="i" :style="`--i: ${i}`" aria-hidden="true">{{ ch }}</span>
      </h1>
      <p class="splash-hint">Signing in anonymously…</p>
    </div>
    <router-view v-else />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  /* Cap the column on desktop — full-width chat past ~720px reads as a
     wall of text. On phones this collapses naturally to the viewport
     width since max-width takes the smaller value. */
  max-width: 720px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  /* Mirror the body's atmospheric stack (grain + soft purple haze + solid
     base) onto the column itself so:
       - Mobile (where .app-shell covers the whole viewport and body is
         hidden behind it) still gets atmosphere — without this, the body's
         radial+grain would be invisible on phones.
       - Desktop has the column AND gutter sharing the same texture, so
         the boundary reads as "a paper sheet on the same desk" rather
         than "two different worlds joined at a seam".
     The radial uses a lower purple percentage than the body version (12%
     vs 18%) so the column is subtly calmer than the surrounding gutter —
     a hint of "the chat is the protected interior" without going full
     light/dark contrast. The mascot watermark stays exclusively on body
     because .app-shell's solid base layer covers it inside the column. */
  background:
    var(--vw-grain) repeat,
    radial-gradient(
      ellipse 80% 60% at 50% -10%,
      color-mix(in srgb, var(--vw-purple-mid) 12%, transparent) 0%,
      transparent 70%
    ),
    var(--vw-bg);
  background-color: var(--vw-bg);
  box-shadow: 0 0 0 0.5px var(--vw-border);
}

.app-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Tighter gap than before — the wordmark sits closer to the mascot so
     they read as a unit, not three stacked panels. */
  gap: 24px;
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

/* Wordmark stagger reveal — replaces the three-dot loading affordance
   that was redundant with the mascot's own breathing fade.
   Two animations stacked:
     1. Each .splash-wordmark span fades in from translateY(8px),
        with a per-letter delay of i × 80ms so they arrive in order.
        13 letters × 80ms = ~1.0s total entrance.
     2. The wordmark's letter-spacing opens up after the letters arrive
        (delay 0.4s, runs for 1.5s) — settling into final tracking
        gives the brand name a sense of "exhale" right as identity
        finishes loading.
   The whole orchestrated moment is ~1.5s, matching the skill's
   "one well-orchestrated page load beats scattered micro-interactions"
   guidance. */
.splash-wordmark {
  font-family: var(--vw-font-display);
  font-variation-settings: 'opsz' 144, 'SOFT' 60, 'WONK' 1;
  font-size: 28px;
  font-weight: 500;
  color: var(--vw-purple-pale);
  margin: 0;
  /* Initial tracking is tight; opens up via animation. */
  letter-spacing: -0.02em;
  animation: tracking-open 1.5s 0.4s ease-out forwards;
}
.splash-wordmark span {
  display: inline-block;
  opacity: 0;
  animation: letter-arrive 0.6s ease-out forwards;
  animation-delay: calc(var(--i) * 80ms);
}

@keyframes letter-arrive {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes tracking-open {
  to { letter-spacing: 0.04em; }
}

.splash-hint {
  font-size: 12px;
  color: var(--vw-text3);
  margin: 0;
  /* Fade in after the wordmark's letters arrive (~1.0s) so it doesn't
     compete with the brand reveal. */
  opacity: 0;
  animation: hint-fade-in 0.5s 1.1s ease-out forwards;
}
@keyframes hint-fade-in {
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .splash-mascot,
  .splash-wordmark,
  .splash-wordmark span,
  .splash-hint {
    animation: none;
  }
  .splash-wordmark { letter-spacing: 0.04em; }
  .splash-wordmark span,
  .splash-hint { opacity: 1; }
}
</style>
