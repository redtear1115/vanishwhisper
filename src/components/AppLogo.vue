<script setup lang="ts">
// Topbar-and-similar logo: painted Whisp icon + wordmark text.
//
// The icon source is `public/whisp-icon-sm.png` — a 256×256 downscale
// of the 1024² favicon master, generated via ImageMagick:
//   magick whisp-icon.png -resize 256x256 -strip -define png:compression-level=9 whisp-icon-sm.png
// 256² covers retina 3x for every AppLogo size variant (sm 32 → 96,
// md 44 → 132, lg 60 → 180) with headroom, and the resulting ~59KB
// load is ~27× smaller than fetching the full 1024² master for every
// page (which is reserved for the browser favicon, where high
// resolution might be wanted by some OS rendering paths).
//
// Why painted PNG and not the prior geometric SVG: at 32-44px chrome
// sizes, the painted version's character (mint eyes, pink nose,
// whiskers, wispy tail) reads better than a vector silhouette
// approximation ever could.
import { computed } from 'vue'

const props = defineProps<{
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()

// Map size variant to explicit pixel values. Width/height attributes on
// the <img> let the browser allocate the box pre-load (avoids layout
// shift) AND set the rendered size (so 1024² source downsamples to the
// target px on the GPU rather than us paying full-resolution paint cost).
const iconPx = computed(() => {
  switch (props.size) {
    case 'sm': return 32
    case 'lg': return 60
    case 'md':
    default:   return 44
  }
})
</script>

<template>
  <div class="app-logo" :class="size ?? 'md'">
    <img
      src="/whisp-icon-sm.png"
      alt=""
      class="logo-icon"
      :width="iconPx"
      :height="iconPx"
      aria-hidden="true"
    />
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
  display: block;
  flex-shrink: 0;
  /* Subtle drop shadow ties the icon to the same purple-haze atmosphere
     the splash mascot uses (App.vue's .splash-mascot). At small sizes
     the shadow registers as "icon has presence on the page" rather
     than a noticeable shadow per se. */
  filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--vw-purple-mid) 30%, transparent));
}

.logo-text {
  /* Display font (Fraunces) at logo-size — slightly soft serifs +
     wonky letterforms tie the wordmark visually to the painted Whisp.
     See theme.css for the variable axis comments. */
  font-family: var(--vw-font-display);
  font-variation-settings: 'opsz' 144, 'SOFT' 60, 'WONK' 1;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--vw-purple-pale);
  white-space: nowrap;
}

.sm .logo-text { font-size: 14px; }
.md .logo-text { font-size: 16px; }
.lg .logo-text { font-size: 20px; }
</style>
