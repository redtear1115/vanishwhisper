<script setup lang="ts">
// One row in the home session list. Rendered identically for the Pinned /
// Default / Archived buckets; the parent passes `dim` for the archived
// list's softer treatment.
//
// Carries the per-row ⋯ menu for Pin/Unpin and Archive/Unarchive — these
// list-management actions live HERE rather than inside the chat view's ⋯
// menu, because they're about how the row sits in the home list, not
// about the chat itself. The chat's own ⋯ menu only carries
// session-internal actions (rename, hide, request delete).
//
// Whole row navigates to the chat on click. Implemented as a div with
// programmatic router.push — not <router-link> — so buttons inside the
// row can stop propagation cleanly without fighting <a>'s default
// navigation. Trade-off: cmd-click to open in a new tab no longer works,
// but this is an SPA chat list where that gesture has no real use case.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { sessionDisplay, setSessionState, useLabels } from '../labels'
import type { ChatSessionRow } from '../sessions'
import { useDocumentDismiss } from '../useDocumentDismiss'
import AppIcon from './AppIcon.vue'
import UserAvatar from './UserAvatar.vue'

const props = defineProps<{
  session: ChatSessionRow
  myUid: string
  dim?: boolean
}>()

const router = useRouter()
const { labels } = useLabels()

const menuOpen = ref(false)
const error = ref<string | null>(null)

const display = computed(() =>
  sessionDisplay(labels.value, props.session.id, props.session.otherParticipant, {
    otherShortLen: 12,
  }),
)
const otherName = computed(() => labels.value.get(props.session.id)?.otherName ?? null)
const sessionState = computed(() => labels.value.get(props.session.id)?.state ?? 'default')

// Same predicate as the previous HomeView.hasUnread, lifted into the row so
// the parent doesn't need to know about lastSeenAt / hidden plumbing.
const hasUnread = computed(() => {
  const s = props.session
  if (!s.lastMessageBy || s.lastMessageBy === props.myUid) return false
  const label = labels.value.get(s.id)
  if (label?.hidden) return false
  const lastSeen = label?.lastSeenAt ?? 0
  const updated = s.updatedAt?.getTime() ?? 0
  return updated > lastSeen + 2000
})

const deletePill = computed<{ text: string; theirs: boolean } | null>(() => {
  const r = props.session.deleteRequestedBy
  if (!r) return null
  if (r === props.myUid) return { text: 'pending…', theirs: false }
  return { text: 'delete?', theirs: true }
})

const timeLabel = computed(() => relativeTime(props.session.updatedAt))

function relativeTime(d: Date | null): string {
  if (!d) return ''
  const sec = (Date.now() - d.getTime()) / 1000
  if (sec < 60) return `${Math.floor(sec)}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function onRowClick(): void {
  router.push({ name: 'session', params: { id: props.session.id } })
}

function onRowKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onRowClick()
  }
}

function onMenuClick(): void {
  menuOpen.value = !menuOpen.value
}

// Pin and Archive are mutually exclusive — toggling one off the current
// state goes back to default; toggling onto either replaces the other.
async function toggleState(target: 'pinned' | 'archived'): Promise<void> {
  menuOpen.value = false
  error.value = null
  try {
    const next = sessionState.value === target ? undefined : target
    await setSessionState(props.session.id, next)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Close on outside-click and Esc. The trigger button + menu wrapper both
// stop propagation, so anything reaching document is by definition outside.
useDocumentDismiss({
  onClickOutside: () => {
    menuOpen.value = false
  },
  onEscape: () => {
    menuOpen.value = false
  },
})
</script>

<template>
  <div
    class="session-item"
    :class="{ dim }"
    role="link"
    tabindex="0"
    @click="onRowClick"
    @keydown="onRowKey"
  >
    <UserAvatar :uid="session.otherParticipant" :name="otherName" :size="36" />
    <div class="session-info">
      <span class="session-id">{{ display.primary }}</span>
      <span v-if="display.secondary" class="session-meta">{{ display.secondary }}</span>
    </div>
    <div class="session-trailing">
      <span v-if="hasUnread" class="unread-dot" title="Unread messages" />
      <span
        v-if="deletePill"
        class="delete-pending-pill"
        :class="{ theirs: deletePill.theirs }"
        :title="
          deletePill.theirs
            ? 'The other party wants to delete — open to respond'
            : 'Waiting for the other party to agree to delete'
        "
        >{{ deletePill.text }}</span
      >
      <span class="session-time">{{ timeLabel }}</span>
    </div>

    <!-- Per-row overflow menu. Wrapper carries .stop on every click event so
         neither the menu button nor the popped items propagate to the row's
         own click handler (which would otherwise navigate into the chat). -->
    <div class="row-menu-wrap" @click.stop @keydown.stop>
      <button
        type="button"
        class="row-menu-btn"
        :title="menuOpen ? 'Close menu' : 'Session actions'"
        :aria-label="menuOpen ? 'Close menu' : 'Session actions'"
        :aria-expanded="menuOpen"
        @click="onMenuClick"
      >
        <AppIcon name="more" :size="16" />
      </button>
      <div v-if="menuOpen" class="vw-popover row-menu">
        <button type="button" class="vw-popover-item row-menu-item" @click="toggleState('pinned')">
          {{ sessionState === 'pinned' ? 'Unpin' : 'Pin to top' }}
        </button>
        <button
          type="button"
          class="vw-popover-item row-menu-item"
          @click="toggleState('archived')"
        >
          {{ sessionState === 'archived' ? 'Unarchive' : 'Archive' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--vw-surface2);
  border: 0.5px solid var(--vw-border);
  border-radius: 10px;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s,
    opacity 0.15s;
  position: relative;
}
.session-item:hover {
  border-color: var(--vw-border2);
}
.session-item:focus-visible {
  outline: none;
  border-color: var(--vw-purple-mid);
  /* Match the input focus halo — same ring across every focusable
     surface so keyboard navigation reads as a coherent visual system. */
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vw-purple-mid) 20%, transparent);
}

/* Archived rows visually softer so they read as "out of focus". */
.session-item.dim {
  opacity: 0.7;
}
.session-item.dim:hover {
  opacity: 1;
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

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vw-green-strong);
  flex-shrink: 0;
}

.session-time {
  font-size: 11px;
  color: var(--vw-text3);
  flex-shrink: 0;
}

.delete-pending-pill {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--vw-surface2);
  color: var(--vw-text2);
  border: 0.5px solid var(--vw-border2);
}
.delete-pending-pill.theirs {
  background: color-mix(in srgb, var(--vw-danger) 15%, transparent);
  color: var(--vw-danger);
  border-color: color-mix(in srgb, var(--vw-danger) 40%, transparent);
}

/* ── ⋯ overflow menu ── */
.row-menu-wrap {
  position: relative;
  flex-shrink: 0;
}
.row-menu-btn {
  appearance: none;
  background: none;
  border: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--vw-text3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s,
    background 0.15s;
}
.row-menu-btn:hover {
  color: var(--vw-purple-pale);
  background: color-mix(in srgb, var(--vw-purple-pale) 8%, transparent);
}
/* Surface chrome inherited from .vw-popover. Local rule carries the
   per-instance positioning, layout, the slightly cooler --vw-border2
   border colour, and the heavier 24px shadow that the row's menu uses
   to read above adjacent rows in a dense list. */
.row-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  border-color: var(--vw-border2);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--vw-bg) 80%, transparent);
}
/* Smaller row context wants a slightly tighter font than the chat-header
   menu — single-line override on top of .vw-popover-item's 13px default. */
.row-menu-item {
  font-size: 12px;
}
</style>
