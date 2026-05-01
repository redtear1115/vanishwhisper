<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdentity } from '../identity'
import { getDeletedInMinutes, setDeletedInMinutes } from '../users'
import AppLogo from '../components/AppLogo.vue'
import AppIcon from '../components/AppIcon.vue'

const { identity } = useIdentity()

const fingerprint = ref<string | null>(null)
const currentMinutes = ref<number | null>(null)
const draftMinutes = ref<number>(60)
const saving = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)
const copied = ref(false)
const linkCopied = ref(false)
// navigator.share availability is fixed for the page lifetime — desktop
// Chrome / Firefox don't have it, mobile Safari + Chrome do.
const supportsShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

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

// Direct clipboard copy — what users actually want 95% of the time.
// Predictable: one tap → link is in your clipboard, status flips to
// "✓ Copied link" for 1.5s. No share-sheet detour.
async function copyInviteLink(): Promise<void> {
  if (!identity.value) return
  error.value = null
  const url = `${window.location.origin}/join/${identity.value.uid}`
  try {
    await navigator.clipboard.writeText(url)
    linkCopied.value = true
    setTimeout(() => {
      linkCopied.value = false
    }, 1500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Opt-in share via the native share sheet — for users who'd rather
// shoot the link straight into AirDrop / Messages / etc. without a
// clipboard hop. Only rendered when navigator.share exists, so this
// button doesn't appear at all on browsers (e.g. desktop Firefox)
// where it'd fall back to clipboard anyway and duplicate Copy.
//
// `title` only (no `text`) so receivers paste a clean URL — some
// share targets (Messages, Notes, Mail) concatenate text + url as
// two lines and break the click-to-join experience.
async function shareInviteLink(): Promise<void> {
  if (!identity.value) return
  error.value = null
  const url = `${window.location.origin}/join/${identity.value.uid}`
  try {
    await navigator.share({ title: 'VanishWhisper invite', url })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
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

// UID is shown raw (no chunking) — Firebase UIDs are random base62 with
// no byte structure, so artificial 4-char chunking would make them read
// as invite codes / license keys rather than permanent identity. The
// .crypto-block utility's letter-spacing alone provides scan breathing.
//
// formatFingerprint splits the hex-byte fingerprint into two 4-byte
// halves separated by a doubled space. Hex bytes DO have byte structure,
// and the primary use case is visual side-by-side comparison between
// two devices (during migration / out-of-band verification), so the
// mid-gap helps the eye parse 4-byte groups instantly without losing
// place. Inspired by PGP / SSL fingerprint conventions.
function formatFingerprint(fp: string | null): string {
  if (!fp) return '…'
  const parts = fp.split(':')
  if (parts.length !== 8) return fp
  return parts.slice(0, 4).join(':') + '  ' + parts.slice(4).join(':')
}
</script>

<template>
  <div class="profile">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="profile-body">
      <router-link to="/" class="back-link">
        <AppIcon name="back" :size="14" />
        Sessions
      </router-link>

      <div class="section-label">Identity</div>

      <div class="vw-card uid-card">
        <div class="field-label">Your UID</div>
        <code class="crypto-block">{{ identity?.uid ?? '…' }}</code>
        <div class="uid-actions">
          <button
            type="button"
            class="copy-btn primary"
            :disabled="!identity"
            @click="copyInviteLink"
          >{{ linkCopied ? '✓ Copied link' : 'Copy invite link' }}</button>
          <button type="button" class="copy-btn" :disabled="!identity" @click="copyUid">
            {{ copied ? '✓ Copied' : 'Copy UID' }}
          </button>
          <button
            v-if="supportsShare"
            type="button"
            class="copy-btn"
            :disabled="!identity"
            @click="shareInviteLink"
          >Share…</button>
        </div>
      </div>

      <div class="vw-card">
        <div class="field-label">Key fingerprint</div>
        <code class="crypto-block fingerprint">{{ formatFingerprint(fingerprint) }}</code>
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

        <p v-if="error" class="vw-text-danger">{{ error }}</p>
      </div>

      <div class="section-label">Account</div>

      <div class="vw-card">
        <p class="hint">
          Switching to a new device? Move your sessions and message history over before you stop
          using this one.
        </p>
        <p class="hint danger-hint">
          Accounts can't be recovered after the fact.
        </p>
        <div class="uid-actions">
          <router-link to="/migrate" class="copy-btn danger">
            <AppIcon name="warning" :size="14" />
            Move account to another device
          </router-link>
        </div>
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

.uid-card { display: flex; flex-direction: column; gap: 8px; }

.uid-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.copy-btn {
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 0.5px solid var(--vw-border2);
  background: none;
  color: var(--vw-purple-light);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.copy-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.copy-btn:disabled { opacity: 0.45; cursor: not-allowed; }
/* "Share invite link" gets the headline filled treatment so the
   share-with-someone flow is more discoverable than the raw-UID copy. */
.copy-btn.primary {
  background: var(--vw-purple-deep);
  border-color: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.copy-btn.primary:hover:not(:disabled) {
  background: var(--vw-purple-mid);
  border-color: var(--vw-purple-mid);
}

/* Danger-outlined variant — for irreversible operations (account
   migration). Outlined-not-filled because the action is intentional and
   user-initiated, not destructive in the "click and the world ends"
   sense; filled red would over-alarm. The icon + outline + danger text
   together raise visual weight enough that the eye registers "be sure"
   before clicking. */
.copy-btn.danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-color: color-mix(in srgb, var(--vw-danger) 50%, var(--vw-border2));
  color: var(--vw-danger);
}
.copy-btn.danger:hover:not(:disabled) {
  color: var(--vw-danger);
  border-color: var(--vw-danger);
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
}

.hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
  margin: 6px 0;
}
.hint.subtle { font-size: 10px; opacity: 0.85; }
/* Danger-tinted hint — for the "this is irreversible" line that sits
   right above a danger-outlined action. Same colour as the button so
   the eye picks up the visual pairing instantly. */
.hint.danger-hint {
  color: var(--vw-danger);
  font-weight: 500;
}

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
