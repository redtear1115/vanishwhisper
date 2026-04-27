<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdentity } from '../identity'
import { avatarInitials, avatarScheme, sessionDisplay, useLabels } from '../labels'
import { useSessions } from '../sessions'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()
const { sessions, error: sessionsError } = useSessions()
const { labels } = useLabels()
const fingerprint = ref<string | null>(null)

watch(
  identity,
  async (id) => {
    if (!id) { fingerprint.value = null; return }
    const spki = Uint8Array.from(atob(id.publicKeySpkiBase64), (c) => c.charCodeAt(0))
    const hash = await crypto.subtle.digest('SHA-256', spki)
    fingerprint.value = Array.from(new Uint8Array(hash))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':')
  },
  { immediate: true },
)

function relativeTime(d: Date | null): string {
  if (!d) return ''
  const sec = (Date.now() - d.getTime()) / 1000
  if (sec < 60)    return `${Math.floor(sec)}s ago`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// Both lines come from sessionDisplay() so labelled and unlabelled sessions
// follow exactly the same rules: friendly name on top, UID-derived id(s)
// always preserved as secondary so identity stays verifiable at a glance.
function display(id: string, otherUid: string) {
  return sessionDisplay(labels.value, id, otherUid, { sessionShortLen: 14, otherShortLen: 12 })
}

function avatarLabel(id: string, otherUid: string): string {
  return avatarInitials(labels.value.get(id)?.otherName ?? otherUid)
}

// Hash on the other party's UID — stable per contact, not per session, so
// the same person looks the same colour across multiple sessions with them.
function avatarSchemeFor(otherUid: string): 'purple' | 'green' {
  return avatarScheme(otherUid)
}
</script>

<template>
  <div class="home">
    <header class="vw-topbar">
      <AppLogo size="sm" />
      <span class="vw-badge-e2e">end-to-end encrypted</span>
    </header>

    <div class="home-body">
      <div class="uid-row">
        <div class="vw-card uid-card">
          <div class="field-label">Your UID</div>
          <code class="uid-val">{{ identity?.uid?.slice(0, 14) }}…</code>
        </div>
        <div class="vw-card uid-card">
          <div class="field-label">Key fingerprint</div>
          <code class="uid-val">{{ fingerprint ?? '…' }}</code>
        </div>
      </div>

      <router-link to="/create" class="vw-btn-primary new-btn">
        <span class="new-icon">+</span>
        New encrypted session
      </router-link>

      <div class="section-label">Your sessions</div>

      <p v-if="sessionsError" class="vw-text-danger" style="font-size:13px;">
        {{ String(sessionsError) }}
      </p>
      <p v-else-if="sessions.length === 0" class="empty-hint">
        No sessions yet — share your UID to start.
      </p>

      <div v-else class="session-list">
        <router-link
          v-for="s in sessions"
          :key="s.id"
          :to="{ name: 'session', params: { id: s.id } }"
          class="session-item"
        >
          <div
            class="session-avatar"
            :class="`scheme-${avatarSchemeFor(s.otherParticipant)}`"
          >
            {{ avatarLabel(s.id, s.otherParticipant) }}
          </div>
          <div class="session-info">
            <span class="session-id">{{ display(s.id, s.otherParticipant).primary }}</span>
            <span class="session-meta">{{ display(s.id, s.otherParticipant).secondary }}</span>
          </div>
          <span class="session-time">{{ relativeTime(s.updatedAt) }}</span>
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.home-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.uid-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.uid-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.uid-val {
  font-size: 11px;
  color: var(--vw-purple-light);
  word-break: break-all;
}

.new-btn {
  width: 100%;
  justify-content: flex-start;
  text-decoration: none;
}

.new-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(229, 207, 247, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-top: 4px;
}

.empty-hint {
  font-size: 13px;
  color: var(--vw-text3);
  text-align: center;
  padding: 28px 0;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--vw-surface2);
  border: 0.5px solid var(--vw-border);
  border-radius: 10px;
  text-decoration: none;
  transition: border-color 0.15s;
}
.session-item:hover { border-color: var(--vw-border2); }

.session-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}
.session-avatar.scheme-purple {
  background: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.session-avatar.scheme-green {
  background: var(--vw-green-deep);
  color: var(--vw-green);
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-id {
  font-size: 12px;
  color: var(--vw-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 11px;
  color: var(--vw-text3);
}

.session-time {
  font-size: 11px;
  color: var(--vw-text3);
  flex-shrink: 0;
}
</style>
