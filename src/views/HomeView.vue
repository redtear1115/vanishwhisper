<script setup lang="ts">
import { useIdentity } from '../identity'
import { avatarInitials, avatarScheme, sessionDisplay, useLabels } from '../labels'
import { useSessions } from '../sessions'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()
const { sessions, error: sessionsError } = useSessions()
const { labels } = useLabels()

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
      <div class="topbar-right">
        <!-- "you" pill — at-a-glance reference to your own UID prefix.
             Replaces the two big info cards that previously took 1/3 of
             the home view. Click goes to /profile (same as the gear). -->
        <router-link
          v-if="identity"
          :to="{ name: 'profile' }"
          class="me-pill"
          :title="`You — ${identity.uid}\nClick to open profile`"
        >{{ identity.uid.slice(0, 10) }}…</router-link>
        <router-link to="/profile" class="profile-link" title="Profile & vanish settings">⚙</router-link>
        <span class="vw-badge-e2e">end-to-end encrypted</span>
      </div>
    </header>

    <div class="home-body">
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
          <div class="session-trailing">
            <span
              v-if="s.deleteRequestedBy"
              class="delete-pending-pill"
              :title="s.deleteRequestedBy === identity?.uid
                ? 'Waiting for the other party to agree to delete'
                : 'The other party wants to delete — open to respond'"
            >{{ s.deleteRequestedBy === identity?.uid ? 'pending…' : 'delete?' }}</span>
            <span class="session-time">{{ relativeTime(s.updatedAt) }}</span>
          </div>
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

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* The "you" pill mirrors the .vw-pill aesthetic but is interactive — small
   monospace UID prefix that links to /profile. Sits between the logo and
   the gear icon as a unobtrusive identity anchor. */
.me-pill {
  font-size: 11px;
  font-family: ui-monospace, monospace;
  padding: 3px 10px;
  border-radius: 99px;
  background: var(--vw-surface2);
  color: var(--vw-text2);
  border: 0.5px solid var(--vw-border);
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s;
}
.me-pill:hover {
  color: var(--vw-purple-pale);
  border-color: var(--vw-border2);
}

.profile-link {
  font-size: 16px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--vw-text2);
  text-decoration: none;
  transition: color 0.15s, background 0.15s;
}
.profile-link:hover {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}

.home-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  background: color-mix(in srgb, var(--vw-purple-pale) 15%, transparent);
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

.session-trailing {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.session-time {
  font-size: 11px;
  color: var(--vw-text3);
  flex-shrink: 0;
}

/* "delete pending" pill — colours the row's trailing edge so the user
   notices a session that needs attention without opening it. Two flavours:
   "pending…" (I requested) is muted purple; "delete?" (they requested,
   action needed) is danger-tinted. */
.delete-pending-pill {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--vw-surface2);
  color: var(--vw-text2);
  border: 0.5px solid var(--vw-border2);
}
.delete-pending-pill:not([title*="Waiting"]) {
  background: color-mix(in srgb, var(--vw-danger) 15%, transparent);
  color: var(--vw-danger);
  border-color: color-mix(in srgb, var(--vw-danger) 40%, transparent);
}
</style>
