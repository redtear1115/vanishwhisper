<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIdentity } from '../identity'
import { avatarInitials, avatarScheme, sessionDisplay, useLabels } from '../labels'
import { useSessions, type ChatSessionRow } from '../sessions'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()
const { sessions, error: sessionsError } = useSessions()
const { labels } = useLabels()

// Local UI state for the collapsible Archived section. Default collapsed —
// archive is "out of sight" by intent.
const archivedExpanded = ref(false)

// State + override classifier for each session. "Surfaced" archived means an
// archived session that we forcibly bubble back to the default list because
// the OTHER party requested mutual deletion — without surfacing, the user
// would never see the request and the session could never get deleted.
function stateOf(s: ChatSessionRow): 'pinned' | 'archived' | 'default' {
  return labels.value.get(s.id)?.state ?? 'default'
}
function isOtherDeletePending(s: ChatSessionRow): boolean {
  return Boolean(s.deleteRequestedBy && s.deleteRequestedBy !== identity.value?.uid)
}

// Three buckets, each sorted by recent activity (sessions are already
// ordered by updatedAt desc upstream).
const pinnedSessions = computed(() =>
  sessions.value.filter((s) => stateOf(s) === 'pinned'),
)
const defaultSessions = computed(() =>
  sessions.value.filter((s) => {
    const st = stateOf(s)
    if (st === 'pinned') return false
    if (st === 'archived') return isOtherDeletePending(s) // surface override
    return true
  }),
)
const archivedSessions = computed(() =>
  sessions.value.filter((s) => {
    if (stateOf(s) !== 'archived') return false
    // Don't double-show: if it's surfaced in default, drop from this list.
    return !isOtherDeletePending(s)
  }),
)

// Unread heuristic. Server tells us who sent the most recent message
// (LastMessageBy). We track when the user last visited each chat in
// IndexedDB (lastSeenAt). Dot lights when:
//   - latest message exists AND
//   - it was sent by the OTHER party AND
//   - it landed AFTER my last visit (with a 2 s clock-skew buffer between
//     server and local clocks) AND
//   - the session isn't client-side-hidden — hide is meant to make a chat
//     visually disappear from your attention, including the home dot.
function hasUnread(s: ChatSessionRow): boolean {
  if (!identity.value) return false
  if (!s.lastMessageBy || s.lastMessageBy === identity.value.uid) return false
  const label = labels.value.get(s.id)
  if (label?.hidden) return false
  const lastSeen = label?.lastSeenAt ?? 0
  const updated = s.updatedAt?.getTime() ?? 0
  return updated > lastSeen + 2000
}

function relativeTime(d: Date | null): string {
  if (!d) return ''
  const sec = (Date.now() - d.getTime()) / 1000
  if (sec < 60)    return `${Math.floor(sec)}s ago`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// Same display logic as the chat header — labels REPLACE the underlying
// identifiers on the surface; the raw UIDs are accessed via the rename
// panel inside each chat. See sessionDisplay() doc comment.
function display(id: string, otherUid: string) {
  return sessionDisplay(labels.value, id, otherUid, { otherShortLen: 12 })
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

      <p v-if="sessionsError" class="vw-text-danger" style="font-size:13px;">
        {{ String(sessionsError) }}
      </p>
      <p v-else-if="sessions.length === 0" class="empty-hint">
        No sessions yet — share your UID to start.
      </p>

      <template v-else>
        <!-- Pinned section — only when at least one session is pinned. Same
             row markup as the default list with a ★ marker prefix. -->
        <template v-if="pinnedSessions.length > 0">
          <div class="section-label">★ Pinned</div>
          <div class="session-list">
            <router-link
              v-for="s in pinnedSessions"
              :key="s.id"
              :to="{ name: 'session', params: { id: s.id } }"
              class="session-item"
            >
              <div
                class="session-avatar"
                :class="`scheme-${avatarSchemeFor(s.otherParticipant)}`"
              >{{ avatarLabel(s.id, s.otherParticipant) }}</div>
              <div class="session-info">
                <span class="session-id">{{ display(s.id, s.otherParticipant).primary }}</span>
                <span
                  v-if="display(s.id, s.otherParticipant).secondary"
                  class="session-meta"
                >{{ display(s.id, s.otherParticipant).secondary }}</span>
              </div>
              <div class="session-trailing">
                <span v-if="hasUnread(s)" class="unread-dot" title="Unread messages" />
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
        </template>

        <!-- Default section -->
        <div class="section-label">Your sessions</div>
        <p v-if="defaultSessions.length === 0" class="empty-hint">
          {{ archivedSessions.length > 0
            ? 'Nothing here — your other sessions are archived below.'
            : 'No active sessions.' }}
        </p>
        <div v-else class="session-list">
          <router-link
            v-for="s in defaultSessions"
            :key="s.id"
            :to="{ name: 'session', params: { id: s.id } }"
            class="session-item"
          >
            <div
              class="session-avatar"
              :class="`scheme-${avatarSchemeFor(s.otherParticipant)}`"
            >{{ avatarLabel(s.id, s.otherParticipant) }}</div>
            <div class="session-info">
              <span class="session-id">{{ display(s.id, s.otherParticipant).primary }}</span>
              <span
                v-if="display(s.id, s.otherParticipant).secondary"
                class="session-meta"
              >{{ display(s.id, s.otherParticipant).secondary }}</span>
            </div>
            <div class="session-trailing">
              <span v-if="hasUnread(s)" class="unread-dot" title="Unread messages" />
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

        <!-- Archived section — collapsible. Sessions auto-surface back to
             the default list when the OTHER party has a pending delete
             request, so this list is only the "true archived" cohort. -->
        <template v-if="archivedSessions.length > 0">
          <button
            type="button"
            class="archive-toggle"
            @click="archivedExpanded = !archivedExpanded"
          >{{ archivedExpanded ? '▾' : '▸' }} Archived ({{ archivedSessions.length }})</button>
          <div v-if="archivedExpanded" class="session-list archived-list">
            <router-link
              v-for="s in archivedSessions"
              :key="s.id"
              :to="{ name: 'session', params: { id: s.id } }"
              class="session-item"
            >
              <div
                class="session-avatar"
                :class="`scheme-${avatarSchemeFor(s.otherParticipant)}`"
              >{{ avatarLabel(s.id, s.otherParticipant) }}</div>
              <div class="session-info">
                <span class="session-id">{{ display(s.id, s.otherParticipant).primary }}</span>
                <span
                  v-if="display(s.id, s.otherParticipant).secondary"
                  class="session-meta"
                >{{ display(s.id, s.otherParticipant).secondary }}</span>
              </div>
              <div class="session-trailing">
                <span class="session-time">{{ relativeTime(s.updatedAt) }}</span>
              </div>
            </router-link>
          </div>
        </template>
      </template>
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

/* Mint dot — "you have unread messages from the other party here". Drives
   off LastMessageBy + the local lastSeenAt mark; no count, just a presence
   indicator (in line with the app's vanishing-message vibe — counts get
   stale fast). */
.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vw-green-strong);
  flex-shrink: 0;
}

/* Collapsible Archived section trigger — minimal text button, no border,
   sits flush left under the default list. */
.archive-toggle {
  background: none;
  border: none;
  padding: 8px 4px;
  margin-top: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  cursor: pointer;
  text-align: left;
  transition: color 0.15s;
}
.archive-toggle:hover { color: var(--vw-text2); }

/* Archived rows visually softer so they read as "out of focus". */
.archived-list .session-item {
  opacity: 0.7;
}
.archived-list .session-item:hover { opacity: 1; }

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
