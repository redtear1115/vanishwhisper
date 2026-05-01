<script setup lang="ts">
import { ref } from 'vue'
import { detectInAppBrowser } from '../inAppBrowser'

// Detection is computed once at setup — UA is stable for the lifetime of
// the page, so reactive refs would imply a change source we don't have.
const inApp = detectInAppBrowser()
const copied = ref(false)

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // clipboard API is gated in some webviews; ignore — the URL is still
    // visible in the address bar for manual copy.
  }
}
</script>

<template>
  <div v-if="inApp" class="warn" role="alert">
    <div class="warn-icon" aria-hidden="true">!</div>
    <div class="warn-body">
      <div class="warn-title">You're in an in-app browser</div>
      <p class="warn-text">
        VanishWhisper saves your encrypted identity in this browser only — keys created
        here can't be reached from Safari or Chrome later. Open this link in your real
        browser before accepting any invite.
      </p>
      <button type="button" class="warn-btn" @click="copyLink">
        {{ copied ? 'Copied — paste in Safari/Chrome' : 'Copy this link' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Danger-tinted surface: full --vw-danger as bg would scream; mixed against
   --vw-surface at 12% gives an attention-getting wash that still sits in
   the app's purple palette. Border picks up a stronger 40% mix so the
   banner reads as a distinct strip rather than fading into the topbar. */
.warn {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--vw-danger) 12%, var(--vw-surface));
  border-bottom: 0.5px solid color-mix(in srgb, var(--vw-danger) 40%, var(--vw-border));
}

.warn-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--vw-danger);
  color: var(--vw-purple-pale);
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.warn-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.warn-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vw-text);
}

.warn-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--vw-text2);
}

.warn-btn {
  align-self: flex-start;
  appearance: none;
  background: var(--vw-bg);
  border: 0.5px solid color-mix(in srgb, var(--vw-danger) 50%, var(--vw-border));
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--vw-purple-pale);
  cursor: pointer;
  transition: border-color 0.15s;
  margin-top: 2px;
}
.warn-btn:hover {
  border-color: var(--vw-danger);
}
</style>
