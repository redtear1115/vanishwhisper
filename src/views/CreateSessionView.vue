<script setup lang="ts">
import { ref } from 'vue'
import { useIdentity } from '../identity'
import { createSession } from '../sessions'
import AppLogo from '../components/AppLogo.vue'
import AppIcon from '../components/AppIcon.vue'

const { identity } = useIdentity()

const inviteeUid = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const createdSessionId = ref<string | null>(null)

// Share / copy state. Computed once at script-setup since `navigator.share`
// availability doesn't change at runtime — falls back to clipboard copy on
// browsers without the Web Share API (essentially: desktop Chrome/Firefox).
const supportsShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
const uidCopied = ref(false)
const linkCopied = ref(false)

function inviteUrl(uid: string): string {
  return `${window.location.origin}/join/${uid}`
}

function flashCopied(target: 'uid' | 'link'): void {
  const flag = target === 'uid' ? uidCopied : linkCopied
  flag.value = true
  setTimeout(() => { flag.value = false }, 1500)
}

async function copyUid(): Promise<void> {
  if (!identity.value) return
  error.value = null
  try {
    await navigator.clipboard.writeText(identity.value.uid)
    flashCopied('uid')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Direct clipboard copy — predictable one-tap → "✓ Copied link" feedback.
// This is the default action because macOS share sheet doesn't include a
// "Copy" option (iOS does), so the prior "share-with-clipboard-fallback"
// flow left desktop users stuck inside a share sheet they couldn't get
// anything useful out of.
async function copyInviteLink(): Promise<void> {
  if (!identity.value) return
  error.value = null
  const url = inviteUrl(identity.value.uid)
  try {
    await navigator.clipboard.writeText(url)
    flashCopied('link')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Opt-in share via native sheet — for users who'd rather route the link
// straight into AirDrop / Signal / Messages without a clipboard hop.
// Only rendered when navigator.share exists, so the button vanishes on
// browsers where it'd fall back to clipboard anyway (which would
// duplicate Copy uselessly).
//
// `title` only (no `text`) so receivers paste a clean URL — some share
// targets (macOS Notes, Messages, Mail) concatenate text + url as two
// lines and break the click-to-join flow.
async function shareInviteLink(): Promise<void> {
  if (!identity.value) return
  error.value = null
  const url = inviteUrl(identity.value.uid)
  try {
    await navigator.share({ title: 'VanishWhisper invite', url })
  } catch (err) {
    // User dismissed the share sheet — silent. Anything else surfaces.
    if (err instanceof Error && err.name === 'AbortError') return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function submit() {
  error.value = null
  createdSessionId.value = null
  submitting.value = true
  try {
    createdSessionId.value = await createSession(inviteeUid.value.trim())
    inviteeUid.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="create">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="create-body">
      <router-link to="/" class="back-link">
        <AppIcon name="back" :size="14" />
        Sessions
      </router-link>

      <div class="section-label">New session</div>

      <div class="vw-card uid-display">
        <div class="field-label">Your UID (share out-of-band)</div>
        <code class="crypto-block">{{ identity?.uid ?? '…' }}</code>
        <div class="share-actions">
          <button
            type="button"
            class="share-btn primary"
            :disabled="!identity"
            @click="copyInviteLink"
          >{{ linkCopied ? '✓ Copied link' : 'Copy invite link' }}</button>
          <button
            type="button"
            class="share-btn"
            :disabled="!identity"
            @click="copyUid"
          >{{ uidCopied ? '✓ Copied' : 'Copy UID' }}</button>
          <button
            v-if="supportsShare"
            type="button"
            class="share-btn"
            :disabled="!identity"
            @click="shareInviteLink"
          >Share…</button>
        </div>
        <p class="share-hint">
          The link drops the recipient on a confirm-and-start page — one tap and
          you're in an encrypted session together.
        </p>
      </div>

      <div class="divider" />

      <form @submit.prevent="submit" class="invite-form">
        <div class="vw-card form-card">
          <div class="field-label">Invitee UID</div>
          <input
            v-model="inviteeUid"
            class="vw-input"
            required
            :disabled="submitting"
            placeholder="Paste their UID here…"
          />
          <p class="field-hint">Ask the other person to share their UID via a separate channel.</p>
        </div>

        <button
          type="submit"
          class="vw-btn-primary submit-btn"
          :disabled="submitting || !inviteeUid"
        >
          {{ submitting ? 'Creating…' : 'Generate encrypted session' }}
        </button>
      </form>

      <p v-if="error" class="vw-text-danger" style="font-size:13px;">{{ error }}</p>

      <div v-if="createdSessionId" class="success-box">
        Session created: <code>{{ createdSessionId }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.create-body {
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
}

.uid-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.share-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.share-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 0.5px solid var(--vw-border2);
  background: none;
  color: var(--vw-purple-light);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.share-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  border-color: var(--vw-purple-mid);
}
.share-btn:disabled { opacity: 0.45; cursor: not-allowed; }
/* The "share invite link" variant is the headline action — fill it so the
   recipient-side flow gets visual priority over the raw-UID copy. */
.share-btn.primary {
  background: var(--vw-purple-deep);
  border-color: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.share-btn.primary:hover:not(:disabled) {
  background: var(--vw-purple-mid);
  border-color: var(--vw-purple-mid);
}

.share-hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
  margin: 4px 0 0;
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.divider {
  border: none;
  border-top: 0.5px solid var(--vw-border);
}

.invite-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-hint {
  font-size: 11px;
  color: var(--vw-text3);
  line-height: 1.5;
}

.submit-btn {
  width: 100%;
  justify-content: center;
}
.submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.success-box {
  background: var(--vw-green-dim);
  border: 0.5px solid var(--vw-green-deep);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--vw-green-strong);
}
.success-box code {
  color: var(--vw-green);
  font-family: var(--vw-font-mono);
}
</style>
