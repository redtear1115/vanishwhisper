<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIdentity } from '../identity'
import { useLabels } from '../labels'
import { useSessions, type ChatSessionRow } from '../sessions'
import AppLogo from '../components/AppLogo.vue'
import AppIcon from '../components/AppIcon.vue'
import SessionRow from '../components/SessionRow.vue'
import { stickerUrl } from '../stickers'

// Reuse the painted sticker pack on empty states — they're already
// loaded for the chat sticker picker, so this is "free" art that
// reinforces the brand instead of "No sessions yet" being plain text.
//   - 'hello' (waving Whisp) for the first-time / empty-list state
//   - 'sleep' (sleeping Whisp) for the "all your active chats are
//     archived" lull state
const helloSticker = stickerUrl('hello')
const sleepSticker = stickerUrl('sleep')

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
        <router-link
          to="/profile"
          class="profile-link"
          title="Profile & vanish settings"
          aria-label="Profile and vanish settings"
        >
          <AppIcon name="settings" :size="16" />
        </router-link>
        <span class="vw-badge-e2e">end-to-end encrypted</span>
      </div>
    </header>

    <div class="home-body">
      <router-link to="/create" class="vw-btn-primary new-btn">
        <span class="new-icon"><AppIcon name="plus" :size="14" /></span>
        New encrypted session
      </router-link>

      <p v-if="sessionsError" class="vw-text-danger" style="font-size:13px;">
        {{ String(sessionsError) }}
      </p>
      <div v-else-if="sessions.length === 0" class="empty-hero">
        <img v-if="helloSticker" :src="helloSticker" alt="" class="empty-hero-sticker" />
        <p class="empty-hint">
          No sessions yet — share your UID to start.
        </p>
      </div>

      <template v-else>
        <!-- Pinned section — only when at least one session is pinned. -->
        <template v-if="pinnedSessions.length > 0">
          <div class="section-label">★ Pinned</div>
          <div class="session-list">
            <SessionRow
              v-for="s in pinnedSessions"
              :key="s.id"
              :session="s"
              :my-uid="identity!.uid"
            />
          </div>
        </template>

        <!-- Default section -->
        <div class="section-label">Your sessions</div>
        <div v-if="defaultSessions.length === 0" class="empty-inline">
          <img
            v-if="archivedSessions.length > 0 && sleepSticker"
            :src="sleepSticker"
            alt=""
            class="empty-inline-sticker"
          />
          <p class="empty-hint">
            {{ archivedSessions.length > 0
              ? 'Nothing here — your other sessions are archived below.'
              : 'No active sessions.' }}
          </p>
        </div>
        <div v-else class="session-list">
          <SessionRow
            v-for="s in defaultSessions"
            :key="s.id"
            :session="s"
            :my-uid="identity!.uid"
          />
        </div>

        <!-- Archived section — collapsible. Sessions auto-surface back to
             the default list when the OTHER party has a pending delete
             request, so this list is only the "true archived" cohort. -->
        <template v-if="archivedSessions.length > 0">
          <button
            type="button"
            class="archive-toggle"
            :aria-expanded="archivedExpanded"
            @click="archivedExpanded = !archivedExpanded"
          >
            <AppIcon
              name="chevron"
              :size="11"
              :class="{ 'rotate-90': archivedExpanded }"
            />
            Archived ({{ archivedSessions.length }})
          </button>
          <div v-if="archivedExpanded" class="session-list">
            <SessionRow
              v-for="s in archivedSessions"
              :key="s.id"
              :session="s"
              :my-uid="identity!.uid"
              dim
            />
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
  font-family: var(--vw-font-mono);
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

/* Hero empty state — first-time / completely-empty list. The painted
   waving Whisp sets a friendly tone for what otherwise reads as a dead
   page. Sticker is sized large enough to register as the hero, dimmed
   slightly so it doesn't outshine the New Session button above. */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 0 32px;
}
.empty-hero-sticker {
  width: 140px;
  height: 140px;
  object-fit: contain;
  /* 80% feels "settled" — full opacity is too presentational, lower
     and the painted lines start to dissolve against the dark bg. */
  opacity: 0.8;
}
.empty-hero .empty-hint {
  padding: 0;
}

/* Inline empty state — "your other sessions are archived below". Smaller
   sticker beside the text, in a row, so the layout doesn't push the
   archive toggle far below. Sleeping Whisp signals the quiet/lull
   state without needing copy to spell it out. */
.empty-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 4px;
}
.empty-inline-sticker {
  width: 56px;
  height: 56px;
  object-fit: contain;
  opacity: 0.7;
  flex-shrink: 0;
}
.empty-inline .empty-hint {
  padding: 0;
  text-align: left;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  /* Inline-flex aligns the rotating chevron icon with the label baseline.
     gap matches the visual rhythm of the label tracking (0.08em on 11px ≈
     6px effective spacing between letters → 6px gap reads consistently). */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s;
}
.archive-toggle:hover { color: var(--vw-text2); }
</style>
