<script setup lang="ts">
defineProps<{
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()
</script>

<template>
  <div class="app-logo" :class="size ?? 'md'">
    <!-- Whisp ghost cat icon -->
    <svg viewBox="0 0 48 54" xmlns="http://www.w3.org/2000/svg" class="logo-icon" aria-hidden="true">
      <!-- Ghost body shadow layer -->
      <path d="M 4,24 C 4,6 44,6 44,24 L 44,38 Q 44,48 36,48 Q 28,48 28,38 Q 28,50 24,51 Q 20,50 20,38 Q 20,48 12,48 Q 4,48 4,38 Z" fill="#5B0888"/>
      <!-- Ghost body main layer -->
      <path d="M 6,24 C 6,8 42,8 42,24 L 42,37 Q 42,46 35,46 Q 28,46 28,37 Q 28,48 24,49 Q 20,48 20,37 Q 20,46 13,46 Q 6,46 6,37 Z" fill="#713ABE"/>
      <!-- Cat ears outer (blend with body) -->
      <polygon points="8,22 16,2 24,22" fill="#713ABE"/>
      <polygon points="24,22 32,2 40,22" fill="#713ABE"/>
      <!-- Cat ears inner -->
      <polygon points="11,20 17,6 22,20" fill="#9D76C1"/>
      <polygon points="26,20 31,6 37,20" fill="#9D76C1"/>
      <!-- Mint green eyes -->
      <ellipse cx="17" cy="24" rx="6" ry="7" fill="#A8D8A8"/>
      <ellipse cx="31" cy="24" rx="6" ry="7" fill="#A8D8A8"/>
      <!-- Cat-slit pupils -->
      <ellipse cx="17" cy="24.5" rx="2" ry="5" fill="#1C3A20"/>
      <ellipse cx="31" cy="24.5" rx="2" ry="5" fill="#1C3A20"/>
      <!-- Eye shines -->
      <circle cx="19.5" cy="21.5" r="1.2" fill="white"/>
      <circle cx="33.5" cy="21.5" r="1.2" fill="white"/>
    </svg>

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
}

.logo-text {
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--vw-purple-pale);
  white-space: nowrap;
}

/* sizes */
.sm .logo-icon { width: 24px; height: 27px; }
.sm .logo-text { font-size: 14px; }

.md .logo-icon { width: 36px; height: 40px; }
.md .logo-text { font-size: 16px; }

.lg .logo-icon { width: 48px; height: 54px; }
.lg .logo-text { font-size: 20px; }
</style>
