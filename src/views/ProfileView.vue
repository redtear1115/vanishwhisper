<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdentity } from '../identity'
import { getDeletedInMinutes, setDeletedInMinutes } from '../users'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()

const fingerprint = ref<string | null>(null)
const currentMinutes = ref<number | null>(null)
const draftMinutes = ref<number>(60)
const saving = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)
const copied = ref(false)

// 5m / 15m / 30m / 1h / 6h / 24h — covers the common-case spread without
// committing the user to typing into a number field for the obvious values.
const PRESETS = [5, 15, 30, 60, 360, 1440] as const

watch(
  identity,
  async (id) => {
    if (!id) return
    // Key fingerprint — same SHA-256 prefix scheme as HomeView so the user
    // can compare across surfaces.
    const spki = Uint8Array.from(atob(id.publicKeySpkiBase64), (c) => c.charCodeAt(0))
    const hash = await crypto.subtle.digest('SHA-256', spki)
    fingerprint.value = Array.from(new Uint8Array(hash))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':')
    // Current vanish window. getDeletedInMinutes() is process-lifetime cached;
    // the cache is also written through by setDeletedInMinutes() below, so a
    // round-trip Save → reload-this-watcher reads the new value immediately.
    try {
      const m = await getDeletedInMinutes(id.uid)
      currentMinutes.value = m
      draftMinutes.value = m
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  },
  { immediate: true },
)

async function copyUid(): Promise<void> {
  if (!identity.value) return
  try {
    await navigator.clipboard.writeText(identity.value.uid)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function save(): Promise<void> {
  if (!identity.value) return
  saving.value = true
  error.value = null
  saved.value = false
  try {
    const m = Math.max(1, Math.floor(draftMinutes.value))
    await setDeletedInMinutes(identity.value.uid, m)
    currentMinutes.value = m
    draftMinutes.value = m
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`
  if (m < 1440) return `${m / 60}h`
  return `${m / 1440}d`
}

function isDirty(): boolean {
  return draftMinutes.value !== currentMinutes.value
}
</script>

<template>
  <div class="profile">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="profile-body">
      <router-link to="/" class="back-link">← Sessions</router-link>

      <div class="section-label">Identity</div>

      <div class="vw-card uid-card">
        <div class="field-label">Your UID</div>
        <code class="uid-val">{{ identity?.uid ?? '…' }}</code>
        <button type="button" class="copy-btn" :disabled="!identity" @click="copyUid">
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
      </div>

      <div class="vw-card">
        <div class="field-label">Key fingerprint</div>
        <code class="uid-val">{{ fingerprint ?? '…' }}</code>
        <p class="hint">First 8 bytes of SHA-256 of your public key. Compare with the other party out-of-band to confirm you're talking to who you think.</p>
      </div>

      <div class="section-label">Vanish setting</div>

      <div class="vw-card vanish-card">
        <div class="field-label">Messages I receive vanish after</div>
        <p class="hint">
          Applies to messages OTHERS send to you — once you read them, they auto-delete after this many minutes. Their setting controls how long messages YOU send to them stick around.
        </p>

        <div class="presets">
          <button
            v-for="p in PRESETS"
            :key="p"
            type="button"
            class="preset-btn"
            :class="{ active: draftMinutes === p }"
            :disabled="saving"
            @click="draftMinutes = p"
          >{{ fmtMinutes(p) }}</button>
        </div>

        <label class="custom-row">
          <span class="custom-label">Custom (minutes)</span>
          <input
            v-model.number="draftMinutes"
            type="number"
            min="1"
            class="vw-input custom-input"
            :disabled="saving"
          />
        </label>

        <div class="actions">
          <button
            type="button"
            class="vw-btn-primary"
            :disabled="saving || !isDirty() || draftMinutes < 1"
            @click="save"
          >{{ saving ? 'Saving…' : 'Save' }}</button>
          <span v-if="saved" class="vw-text-green save-msg">✓ saved</span>
        </div>

        <p class="hint subtle">
          Open chats keep their loaded values until you reopen them — navigate back to a session for the new setting to take effect there.
        </p>

        <p v-if="error" class="vw-text-danger">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.profile-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.back-link {
  font-size: 12px;
  color: var(--vw-purple-light);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.back-link:hover { color: var(--vw-purple-pale); }

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-top: 4px;
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-bottom: 6px;
}

.uid-val {
  font-size: 12px;
  color: var(--vw-purple-light);
  word-break: break-all;
  line-height: 1.5;
  display: block;
}

.uid-card { display: flex; flex-direction: column; gap: 6px; }

.copy-btn {
  align-self: flex-start;
  margin-top: 2px;
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 0.5px solid var(--vw-border2);
  background: none;
  color: var(--vw-purple-light);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.copy-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.copy-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
  margin: 6px 0;
}
.hint.subtle { font-size: 10px; opacity: 0.85; }

.vanish-card { display: flex; flex-direction: column; gap: 4px; }

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 6px;
}

.preset-btn {
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 99px;
  border: 0.5px solid var(--vw-border2);
  background: none;
  color: var(--vw-text2);
  cursor: pointer;
  transition: all 0.15s;
}
.preset-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.preset-btn.active {
  background: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-deep);
}
.preset-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.custom-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.custom-label {
  font-size: 11px;
  color: var(--vw-text3);
  flex-shrink: 0;
}
.custom-input { max-width: 120px; }

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.save-msg {
  font-size: 12px;
}
</style>
