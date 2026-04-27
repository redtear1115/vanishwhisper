<script setup lang="ts">
import { useIdentity } from './identity'
import AppLogo from './components/AppLogo.vue'

const { identity, error } = useIdentity()
</script>

<template>
  <div class="app-shell">
    <div v-if="error" class="app-state">
      <AppLogo size="md" />
      <p class="vw-text-danger" style="font-size:13px;">Sign-in failed: {{ String(error) }}</p>
    </div>
    <div v-else-if="!identity" class="app-state">
      <AppLogo size="lg" />
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
  display: flex;
  flex-direction: column;
}

.app-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
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
