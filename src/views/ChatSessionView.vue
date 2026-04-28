<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getIdentity } from '../identity'
import { sessionDisplay, setLabel, useLabels } from '../labels'
import {
  deleteMessage,
  markDeleted,
  markRead,
  sendImageMessage,
  sendMessage,
  subscribeMessages,
  toggleReaction,
  type ChatMessageRow,
} from '../messages'
import {
  agreeDeleteSession,
  cancelDeleteSession,
  openSession,
  requestDeleteSession,
  subscribeSession,
  type OpenSession,
  type SessionMeta,
} from '../sessions'
import { subscribeDeletedInMinutes } from '../users'

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const props = defineProps<{ id: string }>()
const { labels } = useLabels()
const router = useRouter()

const opened = ref<OpenSession | null>(null)
const messages = ref<ChatMessageRow[]>([])
const draft = ref('')
const sending = ref(false)
const sendingImage = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const draftInputRef = ref<HTMLInputElement | null>(null)
const error = ref<string | null>(null)
// Lightbox: when non-null, render a fullscreen overlay showing this blob URL.
// We hold the URL string directly (not the message id) so the overlay keeps
// rendering even if the underlying message vanishes mid-view — the blob URL
// stays valid until subscribeMessages revokes it on next snapshot, which
// gives the user a moment to dismiss before it goes blank.
const lightboxUrl = ref<string | null>(null)

// Session-level metadata (live). Drives the mutual-delete banner and the
// auto-redirect-to-home when the OTHER party agrees and cascade-deletes
// the session out from under us.
const sessionMeta = ref<SessionMeta | null>(null)
const deleting = ref(false) // true during cascade delete
type DeleteRequestState = 'none' | 'mine' | 'theirs'
const deleteRequestState = computed<DeleteRequestState>(() => {
  const requestedBy = sessionMeta.value?.deleteRequestedBy
  if (!requestedBy) return 'none'
  return requestedBy === opened.value?.myUid ? 'mine' : 'theirs'
})
const now = ref(Date.now())
const myMinutes = ref<number | null>(null)
const otherMinutes = ref<number | null>(null)

const readFired = new Set<string>()
const deletedFired = new Set<string>()
const pickerOpenFor = ref<string | null>(null)

// Auto-scroll: keep the chat pinned to the bottom when the user is already
// there (so new messages stay visible without manual scroll). If they've
// scrolled up to read older history, leave their position alone — only
// resume sticking once they scroll back down. Sending a message also forces
// stick-to-bottom because the user clearly wants to see what they just sent.
const messagesContainerRef = ref<HTMLElement | null>(null)
let stickToBottom = true

function isNearBottom(): boolean {
  const el = messagesContainerRef.value
  if (!el) return true
  const slack = 80 // px — counts as "at bottom" if within this gap
  return el.scrollTop + el.clientHeight >= el.scrollHeight - slack
}

function scrollToBottom(): void {
  const el = messagesContainerRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onChatScroll(): void {
  stickToBottom = isNearBottom()
}

// Inline rename panel for the session and other-party display labels.
const renaming = ref(false)
const draftSessionName = ref('')
const draftOtherName = ref('')
const savingLabels = ref(false)
// Header overflow menu (⋯). Open via the explicit button; close on
// item-click, click-outside (document handler), or Esc (keydown handler).
const menuOpen = ref(false)

// Two-line header derived from sessionDisplay() — friendly name promotes
// to the title; the underlying session id (when a name is set) plus the
// "with X" segment (with otherUid suffix when otherName is set) drop to
// the subtitle so the IDs always remain visible (per user request).
const headerDisplay = computed(() => {
  if (!opened.value) {
    const lbl = labels.value.get(props.id)
    return {
      primary: lbl?.sessionName ?? `${props.id.slice(0, 10)}…`,
      secondary: '',
    }
  }
  return sessionDisplay(labels.value, props.id, opened.value.otherParticipant, {
    sessionShortLen: 10,
    otherShortLen: 16,
  })
})

function openRenamePanel(): void {
  const current = labels.value.get(props.id)
  draftSessionName.value = current?.sessionName ?? ''
  draftOtherName.value = current?.otherName ?? ''
  renaming.value = true
}

async function saveLabels(): Promise<void> {
  savingLabels.value = true
  error.value = null
  try {
    await setLabel(props.id, {
      sessionName: draftSessionName.value,
      otherName: draftOtherName.value,
    })
    renaming.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingLabels.value = false
  }
}

let unsub: (() => void) | null = null
let unsubMyMinutes: (() => void) | null = null
let unsubOtherMinutes: (() => void) | null = null
let unsubSession: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  try {
    const session = await openSession(props.id)
    opened.value = session
    const me = getIdentity()
    // Live subscriptions instead of one-shot reads — when the OTHER party
    // updates their DeletedInMinutes via Profile, this fires and the
    // existing message progress lines + bucketed labels recompute against
    // the new value (cache invalidation handled by the watch below).
    unsubMyMinutes = subscribeDeletedInMinutes(
      me.uid,
      (m) => { myMinutes.value = m },
      (err) => { error.value = err instanceof Error ? err.message : String(err) },
    )
    unsubOtherMinutes = subscribeDeletedInMinutes(
      session.otherParticipant,
      (m) => { otherMinutes.value = m },
      (err) => { error.value = err instanceof Error ? err.message : String(err) },
    )
    // Live session metadata (DeleteRequestedBy). When the doc disappears —
    // the OTHER party agreed and cascade-deleted — go back to the home
    // list so the user isn't staring at a chat that no longer exists.
    unsubSession = subscribeSession(
      props.id,
      (meta) => {
        if (meta === null) {
          // Suppress the navigate when WE are the ones cascade-deleting; the
          // agreeDeleteSession() handler routes home itself once it finishes.
          if (!deleting.value) router.replace('/')
          return
        }
        sessionMeta.value = meta
      },
      (err) => { error.value = err instanceof Error ? err.message : String(err) },
    )
    unsub = subscribeMessages(
      props.id,
      session.sessionKey,
      (rows) => {
        messages.value = rows
        ackUnread(rows)
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
    timer = setInterval(() => {
      now.value = Date.now()
      tickVanish()
    }, 1000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  unsub?.()
  unsubMyMinutes?.()
  unsubOtherMinutes?.()
  unsubSession?.()
  if (timer !== null) clearInterval(timer)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
  // Defensive: if the user navigates away with the lightbox still open,
  // restore the body scroll lock we set in openLightbox.
  document.body.style.overflow = ''
})

// When either side's vanish window updates, blow away the progress-line
// cache so existing messages recompute their CSS animation duration. The
// cache is keyed by (messageId, readAt) which doesn't include minutes, so
// without this the in-flight animation would keep its original duration
// even after Vue re-renders the inline style.
watch([myMinutes, otherMinutes], () => {
  progressStyleCache.clear()
})

function ackUnread(rows: ChatMessageRow[]): void {
  for (const m of rows) {
    if (m.fromMe || m.readAt || m.deletedAt || readFired.has(m.id)) continue
    readFired.add(m.id)
    markRead(m.id).catch((err) => {
      readFired.delete(m.id)
      console.error('markRead failed', err)
    })
  }
}

function vanishAtMs(m: ChatMessageRow): number | null {
  if (!m.readAt) return null
  const minutes = m.fromMe ? otherMinutes.value : myMinutes.value
  if (minutes === null) return null
  return m.readAt.getTime() + minutes * 60_000
}

function isVanished(m: ChatMessageRow, atMs: number): boolean {
  if (m.deletedAt) return true
  const at = vanishAtMs(m)
  return at !== null && atMs >= at
}

const visibleMessages = computed(() =>
  messages.value.filter((m) => !isVanished(m, now.value)),
)

function tickVanish(): void {
  for (const m of messages.value) {
    if (m.fromMe || m.deletedAt || deletedFired.has(m.id)) continue
    const at = vanishAtMs(m)
    if (at !== null && now.value >= at) {
      deletedFired.add(m.id)
      markDeleted(m.id).catch((err) => {
        deletedFired.delete(m.id)
        console.error('markDeleted failed', err)
      })
    }
  }
}

async function send(): Promise<void> {
  if (!opened.value || !draft.value.trim()) return
  sending.value = true
  error.value = null
  try {
    await sendMessage(props.id, opened.value.sessionKey, draft.value)
    draft.value = ''
    // Force stick — even if the user had scrolled up, sending obviously
    // means they want to see what they just sent.
    stickToBottom = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sending.value = false
    // Chrome drops focus the moment an input flips to disabled and
    // doesn't restore it when re-enabled; Safari is laxer. Refocus on
    // the next tick so the disabled attr has flushed first — focusing a
    // still-disabled element silently no-ops.
    await nextTick()
    draftInputRef.value?.focus()
  }
}

function openFilePicker(): void {
  fileInputRef.value?.click()
}

async function onFileSelected(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset so the same file can be picked again (browsers won't fire change
  // for the same path twice in a row otherwise).
  target.value = ''
  if (!file || !opened.value) return
  sendingImage.value = true
  error.value = null
  try {
    await sendImageMessage(props.id, opened.value.sessionKey, file)
    stickToBottom = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sendingImage.value = false
    // Same Chrome focus quirk as send() — the text input flips disabled
    // during the upload and won't auto-refocus. Restore so the user can
    // type a follow-up without re-clicking.
    await nextTick()
    draftInputRef.value?.focus()
  }
}

// Pin to bottom whenever the visible message list grows / shrinks if the
// user is sticking. Runs after Vue paints so scrollHeight reflects the new
// content. Initial mount counts: visibleMessages goes [] → first batch
// triggers this watcher, which scrolls to the latest immediately on open.
watch(visibleMessages, async () => {
  if (!stickToBottom) return
  await nextTick()
  scrollToBottom()
})

// Bucketed vanish text — coarser as the remaining time grows so the label
// barely changes for most of a message's life. Result: Vue's diff sees the
// same string across most ticks and skips the DOM update, so the screen
// stops feeling like it's constantly moving. The smooth-depleting horizontal
// line below the bubble carries the per-second visual signal.
//   <60s          → second precision  ("45s")
//   60s – 5min    → minute precision  ("4m")
//   5min – 15min  → 5-minute steps    ("10m")
//   15min – 1hr   → 15-minute steps   ("45m")
//   1hr+          → hour precision    ("2h")
function vanishLabel(m: ChatMessageRow): string {
  const at = vanishAtMs(m)
  if (at === null) return 'unread'
  const remaining = Math.max(0, at - now.value)
  if (remaining < 60_000) {
    return `vanishes in ${Math.ceil(remaining / 1000)}s`
  }
  if (remaining < 5 * 60_000) {
    return `vanishes in ${Math.floor(remaining / 60_000)}m`
  }
  if (remaining < 15 * 60_000) {
    return `vanishes in ${Math.floor(remaining / 60_000 / 5) * 5}m`
  }
  if (remaining < 60 * 60_000) {
    return `vanishes in ${Math.floor(remaining / 60_000 / 15) * 15}m`
  }
  return `vanishes in ${Math.floor(remaining / 3_600_000)}h`
}

// Horizontal vanish line — driven entirely by CSS keyframes so the browser
// can run it on the compositor without JS ticks. We feed in two values that
// don't change for the lifetime of the message:
//   - animationDuration = the recipient's full vanish window (total lifetime)
//   - animationDelay    = NEGATIVE elapsed since readAt, which jumps the
//                         animation forward so a message read 10 min ago in
//                         a 60-min window starts the line at the 10/60 point.
// We memoise per (messageId, readAt) so the style object's identity is
// stable across Vue re-renders — the inline style only "changes" the moment
// readAt transitions null → set, and the keyframe runs uninterrupted from
// that point. The cache is component-local so a remount (navigate away and
// back) recomputes elapsed against the current Date.now(), avoiding stale
// offsets.
const progressStyleCache = new Map<
  string,
  { animationDuration: string; animationDelay: string }
>()

function progressStyle(m: ChatMessageRow): Record<string, string> {
  if (!m.readAt) return { display: 'none' }
  const minutes = m.fromMe ? otherMinutes.value : myMinutes.value
  if (minutes === null) return { display: 'none' }
  const key = `${m.id}:${m.readAt.getTime()}`
  let style = progressStyleCache.get(key)
  if (!style) {
    const totalMs = minutes * 60_000
    const elapsedMs = Math.max(0, Date.now() - m.readAt.getTime())
    style = {
      animationDuration: `${totalMs}ms`,
      animationDelay: `-${elapsedMs}ms`,
    }
    progressStyleCache.set(key, style)
  }
  return style
}

function showProgress(m: ChatMessageRow): boolean {
  return Boolean(m.readAt) && !isVanished(m, now.value)
}

// Adjacent visible messages with the same sender and the same bucketed vanish
// label are visually a "group" — they share one progress line and one meta row
// at the bottom so the screen isn't repeating "vanishes in 30m" three times in
// a row. The anchor for the shared line / meta is the LAST message of the group
// (most recent send): earlier messages in a group were read first and vanish
// first, so anchoring on the latest means the line never "jumps back" as
// earlier messages drop out — once the latest itself vanishes, the whole group
// is already empty.
function isLastOfGroup(idx: number): boolean {
  const m = visibleMessages.value[idx]
  const next = visibleMessages.value[idx + 1]
  if (!next) return true
  if (next.fromMe !== m.fromMe) return true
  return vanishLabel(next) !== vanishLabel(m)
}

function iReacted(m: ChatMessageRow, emoji: string): boolean {
  if (!opened.value) return false
  return m.reactions[emoji]?.includes(opened.value.myUid) ?? false
}

function reactionCount(m: ChatMessageRow, emoji: string): number {
  return m.reactions[emoji]?.length ?? 0
}

async function onReact(messageId: string, emoji: string, hasMine: boolean): Promise<void> {
  try {
    await toggleReaction(messageId, emoji, hasMine)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Picker is one-shot: clicking an emoji toggles the reaction and closes
// the picker. Combined with click-outside-closes (document listener below)
// this means there's no explicit "close" button — the picker behaves like
// a transient menu instead of a sticky panel.
async function onReactAndClose(
  messageId: string,
  emoji: string,
  hasMine: boolean,
): Promise<void> {
  pickerOpenFor.value = null
  await onReact(messageId, emoji, hasMine)
}

// Document-level click handler closes any open picker AND the header
// overflow menu. Their open triggers and inner buttons all use @click.stop
// so clicks INSIDE never reach this — anything that does is by definition
// outside.
function onDocumentClick(): void {
  if (pickerOpenFor.value !== null) {
    pickerOpenFor.value = null
  }
  if (menuOpen.value) {
    menuOpen.value = false
  }
}

// Lightbox open/close + Esc-to-close. Body scroll is locked while open so
// the chat doesn't scroll under the overlay when the user wheels on the
// image (browser pinch-zoom on mobile still works fine).
function openLightbox(url: string): void {
  lightboxUrl.value = url
  document.body.style.overflow = 'hidden'
}

function closeLightbox(): void {
  lightboxUrl.value = null
  document.body.style.overflow = ''
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (lightboxUrl.value !== null) closeLightbox()
  if (menuOpen.value) menuOpen.value = false
}

async function onDelete(messageId: string): Promise<void> {
  try {
    await deleteMessage(messageId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onRequestDelete(): Promise<void> {
  error.value = null
  try {
    await requestDeleteSession(props.id)
    renaming.value = false // close the rename panel; banner takes over
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onCancelOrReject(): Promise<void> {
  error.value = null
  try {
    await cancelDeleteSession(props.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// ⋯ menu actions. Each closes the menu first, then fires the underlying
// handler — keeps the click feedback immediate and avoids a flicker
// where the menu sits open during the async operation.
function onMenuRename(): void {
  menuOpen.value = false
  openRenamePanel()
}

async function onMenuRequestDelete(): Promise<void> {
  menuOpen.value = false
  await onRequestDelete()
}

async function onAgreeDelete(): Promise<void> {
  error.value = null
  deleting.value = true
  try {
    await agreeDeleteSession(props.id)
    // Cascade succeeded — get out before our own session subscription fires
    // null and races with the navigation. The deleting flag in the snapshot
    // handler guards the same path.
    router.replace('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    deleting.value = false
  }
}
</script>

<template>
  <div class="chat-wrap">
    <!-- Header. Title is non-interactive display. Session-level actions
         (rename, request delete) live behind the explicit ⋯ menu — which
         is more discoverable than a hidden click target on the title. -->
    <header class="chat-header">
      <router-link to="/" class="back-btn">←</router-link>
      <div class="chat-header-info">
        <span class="chat-title">{{ headerDisplay.primary }}</span>
        <span v-if="headerDisplay.secondary" class="chat-subtitle">{{ headerDisplay.secondary }}</span>
      </div>
      <button
        type="button"
        class="header-menu-btn"
        :title="menuOpen ? 'Close menu' : 'Session menu'"
        @click.stop="menuOpen = !menuOpen"
      >⋯</button>
      <span class="vw-badge-e2e">E2E</span>

      <div v-if="menuOpen" class="header-menu" @click.stop>
        <button type="button" class="header-menu-item" @click="onMenuRename">Rename</button>
        <button
          v-if="deleteRequestState === 'none'"
          type="button"
          class="header-menu-item danger"
          @click="onMenuRequestDelete"
        >Request delete</button>
      </div>
    </header>

    <!-- Rename panel -->
    <div v-if="renaming" class="rename-panel">
      <label class="rename-field">
        <span class="rename-label">Session name</span>
        <input
          v-model="draftSessionName"
          class="vw-input"
          :disabled="savingLabels"
          placeholder="e.g. Project chat"
          maxlength="64"
        />
      </label>
      <label class="rename-field">
        <span class="rename-label">Other party</span>
        <input
          v-model="draftOtherName"
          class="vw-input"
          :disabled="savingLabels"
          placeholder="e.g. Alice"
          maxlength="64"
        />
      </label>
      <p class="rename-hint">Stored locally only — never uploaded.</p>
      <div class="rename-actions">
        <button
          type="button"
          class="vw-btn-primary"
          :disabled="savingLabels"
          @click="saveLabels"
        >{{ savingLabels ? 'Saving…' : 'Save' }}</button>
        <button
          type="button"
          class="rename-cancel"
          :disabled="savingLabels"
          @click="renaming = false"
        >Cancel</button>
      </div>
    </div>

    <!-- Mutual-delete banner. Two flavours depending on who requested. -->
    <div v-if="deleteRequestState === 'mine'" class="delete-banner mine">
      <span>Waiting for the other party to agree to delete this session…</span>
      <button type="button" class="delete-banner-btn" @click="onCancelOrReject">Cancel request</button>
    </div>
    <div v-else-if="deleteRequestState === 'theirs'" class="delete-banner theirs">
      <span>The other party wants to delete this session and all messages.</span>
      <div class="delete-banner-actions">
        <button
          type="button"
          class="delete-banner-btn danger"
          :disabled="deleting"
          @click="onAgreeDelete"
        >{{ deleting ? 'Deleting…' : 'Agree & delete' }}</button>
        <button
          type="button"
          class="delete-banner-btn"
          :disabled="deleting"
          @click="onCancelOrReject"
        >Reject</button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="!opened && !error" class="chat-loading">
      <p style="font-size:13px;color:var(--vw-text3);">Opening session…</p>
    </div>

    <!-- Messages -->
    <div
      v-else-if="opened"
      ref="messagesContainerRef"
      class="chat-messages"
      @scroll="onChatScroll"
    >
      <p v-if="visibleMessages.length === 0" class="chat-empty">
        No messages yet — say hi.
      </p>
      <div
        v-for="(m, idx) in visibleMessages"
        :key="m.id"
        class="msg-row"
        :class="[m.fromMe ? 'msg-me' : 'msg-them', isLastOfGroup(idx) ? 'group-end' : 'group-mid']"
      >
        <!-- Bubble (per-message). Unsend lives inside the bubble as a hover
             affordance so even mid-group messages can be unsent — the shared
             meta row below carries no per-message controls. Image attachments
             render before any text caption (currently no caption UI, so it's
             one or the other). -->
        <div
          class="msg-bubble"
          :class="[m.fromMe ? 'vw-bubble-me' : 'vw-bubble-them', { 'has-image': m.attachment }]"
        >
          <img
            v-if="m.attachment?.blobUrl"
            :src="m.attachment.blobUrl"
            :width="m.attachment.width"
            :height="m.attachment.height"
            class="msg-image"
            alt=""
            @click.stop="openLightbox(m.attachment!.blobUrl!)"
          />
          <span v-else-if="m.attachment" class="decrypt-err">[unable to decrypt image]</span>
          <span v-if="m.text">{{ m.text }}</span>
          <span v-else-if="m.text === null" class="decrypt-err">[unable to decrypt]</span>
          <button
            v-if="m.fromMe"
            class="bubble-delete"
            type="button"
            title="Unsend"
            @click.stop="onDelete(m.id)"
          >×</button>
          <!-- Reaction picker trigger — only on inbound messages, hover-revealed
               like the unsend button. Stops propagation so the document
               click-outside handler doesn't immediately re-close the picker. -->
          <button
            v-if="!m.fromMe"
            class="bubble-react"
            type="button"
            title="React"
            @click.stop="pickerOpenFor = m.id"
          >+</button>
        </div>

        <!-- Shared progress line + meta row — only on the LAST message of a
             grouped run. Same-bucket adjacent messages from the same sender
             collapse into one visual indicator instead of N. -->
        <div v-if="isLastOfGroup(idx) && showProgress(m)" class="msg-progress">
          <div class="msg-progress-fill" :style="progressStyle(m)" />
        </div>
        <div v-if="isLastOfGroup(idx)" class="msg-meta">
          <span class="msg-time">{{ m.createdAt?.toLocaleTimeString() ?? '…' }}</span>
          <span class="vw-pill" :class="{ 'vw-pill--live': m.readAt }">{{ vanishLabel(m) }}</span>
        </div>

        <!-- Reactions row — existing pills always visible (with counts). The
             picker (extra emoji choices) is opened from the bubble's hover
             "+" button, not from the row itself. .stop on each pill so a
             toggle doesn't bubble out and trigger the click-outside close. -->
        <div class="reactions-row">
          <button
            v-for="emoji in REACTION_EMOJIS"
            v-show="reactionCount(m, emoji) > 0 || (!m.fromMe && pickerOpenFor === m.id)"
            :key="emoji"
            type="button"
            class="reaction-pill"
            :class="{ mine: iReacted(m, emoji) }"
            @click.stop="onReactAndClose(m.id, emoji, iReacted(m, emoji))"
          >
            {{ emoji }}<span v-if="reactionCount(m, emoji) > 0" class="reaction-count"> {{ reactionCount(m, emoji) }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Lightbox overlay — teleported to body so it escapes any parent
         stacking context (chat header, input bar, etc.) and covers the
         viewport regardless of where this template lives. Click anywhere
         (backdrop or image) closes; Esc also closes via document keydown. -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="lightbox" @click="closeLightbox">
        <img :src="lightboxUrl" class="lightbox-image" alt="" />
        <button
          type="button"
          class="lightbox-close"
          aria-label="Close"
          @click.stop="closeLightbox"
        >×</button>
      </div>
    </Teleport>

    <!-- Input bar -->
    <form v-if="opened" class="input-bar" @submit.prevent="send">
      <button
        type="button"
        class="attach-btn"
        :disabled="sending || sendingImage"
        :title="sendingImage ? 'Sending image…' : 'Attach image (max 5 MB)'"
        @click="openFilePicker"
      >📎</button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="file-input-hidden"
        @change="onFileSelected"
      />
      <input
        ref="draftInputRef"
        v-model="draft"
        class="vw-input-pill"
        :disabled="sending || sendingImage"
        placeholder="Type a message…"
        required
      />
      <button
        type="submit"
        class="vw-btn-send"
        :disabled="sending || sendingImage || !draft"
      >
        <span class="send-icon" />
      </button>
    </form>
  </div>
</template>

<style scoped>
.chat-wrap {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--vw-bg);
}

/* ── Header ── */
.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--vw-surface);
  border-bottom: 0.5px solid var(--vw-border);
  flex-shrink: 0;
  /* Anchor for the ⋯ overflow menu's absolute positioning. */
  position: relative;
}

.back-btn {
  font-size: 16px;
  color: var(--vw-purple-light);
  text-decoration: none;
  flex-shrink: 0;
}
.back-btn:hover { color: var(--vw-purple-pale); }

/* The header info area is now non-interactive display — session-level
   actions moved behind the explicit ⋯ button next to it for clearer
   discoverability. */
.chat-header-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vw-text);
}

/* ── Header overflow menu ── */
.header-menu-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  color: var(--vw-text2);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.header-menu-btn:hover {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}

/* Dropdown anchored to the bottom-right of the chat header; absolute
   inside .chat-header (which is position:relative). z-index above the
   message list and the rename panel. */
.header-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 12px;
  min-width: 180px;
  background: var(--vw-surface2);
  border: 0.5px solid var(--vw-border);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 100;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--vw-bg) 80%, transparent);
}

.header-menu-item {
  background: none;
  border: none;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--vw-text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.15s, color 0.15s;
}
.header-menu-item:hover { background: var(--vw-surface); }
.header-menu-item.danger { color: var(--vw-danger); }
.header-menu-item.danger:hover {
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
}

.chat-subtitle {
  font-size: 11px;
  color: var(--vw-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Rename panel ── */
.rename-panel {
  padding: 14px 16px;
  background: var(--vw-surface2);
  border-bottom: 0.5px solid var(--vw-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.rename-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rename-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
}

.rename-hint {
  font-size: 11px;
  color: var(--vw-text3);
  margin: 0;
}

.rename-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.rename-cancel {
  background: none;
  border: 0.5px solid var(--vw-border2);
  border-radius: 8px;
  padding: 8px 14px;
  color: var(--vw-text2);
  font-size: 13px;
  cursor: pointer;
}
.rename-cancel:hover { color: var(--vw-purple-pale); border-color: var(--vw-purple-mid); }
.rename-cancel:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── Mutual-delete banner ── */
.delete-banner {
  padding: 12px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 0.5px solid var(--vw-border);
}
.delete-banner.mine {
  background: color-mix(in srgb, var(--vw-purple-light) 12%, transparent);
  color: var(--vw-purple-pale);
}
.delete-banner.theirs {
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
  color: var(--vw-danger);
}
.delete-banner span { flex: 1; min-width: 200px; }
.delete-banner-actions {
  display: flex;
  gap: 8px;
}
.delete-banner-btn {
  background: none;
  border: 0.5px solid currentColor;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.delete-banner-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vw-text) 6%, transparent);
}
.delete-banner-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.delete-banner-btn.danger {
  background: var(--vw-danger);
  border-color: var(--vw-danger);
  color: var(--vw-text);
}
.delete-banner-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vw-danger) 85%, transparent);
}

/* ── Chat empty state ── */
.chat-empty {
  margin: auto;
  font-size: 13px;
  color: var(--vw-text3);
  text-align: center;
}

/* ── Error banner ── */
.error-banner {
  padding: 8px 16px;
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
  border-bottom: 0.5px solid color-mix(in srgb, var(--vw-danger) 30%, transparent);
  font-size: 12px;
  color: var(--vw-danger);
  flex-shrink: 0;
}

/* ── Loading ── */
.chat-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Messages ── */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  /* Small base gap — adjacent bubbles in the same vanish-bucket group sit
     close together. Group boundaries get extra breathing room via
     `.group-end { margin-bottom }` below. */
  gap: 4px;
}
.chat-messages::-webkit-scrollbar { width: 4px; }
.chat-messages::-webkit-scrollbar-track { background: transparent; }
.chat-messages::-webkit-scrollbar-thumb { background: var(--vw-border2); border-radius: 2px; }

.msg-row {
  display: flex;
  flex-direction: column;
  max-width: 75%;
  gap: 4px;
}
.msg-me   { align-self: flex-end; align-items: flex-end; }
.msg-them { align-self: flex-start; align-items: flex-start; }
/* Extra breathing room after the LAST message of a group so the shared meta
   row clearly belongs to the group above and the next group starts visibly
   apart. group-mid messages stay tight against their siblings. */
.msg-row.group-end { margin-bottom: 10px; }
.msg-row.group-end:last-child { margin-bottom: 0; }

.decrypt-err { color: var(--vw-danger); font-style: italic; }

/* ── Vanish progress line ──
   A 2px track with a mint fill that depletes via a single CSS keyframe.
   The fill's animationDuration (= total lifetime) and animationDelay
   (= NEGATIVE elapsed since readAt) come from progressStyle() inline, so
   the browser drives the animation on the compositor without per-second JS
   updates — see the long comment in the script section. The line spans the
   whole message-row column (75% viewport max) rather than fitting the
   bubble; it reads as a divider between bubble and meta as well as a
   countdown indicator. */
.msg-progress {
  width: 100%;
  height: 2px;
  background: var(--vw-border);
  border-radius: 1px;
  overflow: hidden;
}
.msg-progress-fill {
  height: 100%;
  width: 100%;
  background: var(--vw-green-strong);
  animation-name: msg-deplete;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes msg-deplete {
  to { width: 0; }
}

/* ── Meta ── */
.msg-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.msg-time {
  font-size: 10px;
  color: var(--vw-text3);
}

/* Per-bubble unsend — lives inside the bubble (hence position:relative on
   `.msg-bubble` below) so even mid-group messages can be unsent without
   a meta row. Hidden by default; revealed on hover. Touch users without
   hover lose discoverability — acceptable trade for desktop cleanness in
   the current phase. */
.msg-bubble { position: relative; }
.bubble-delete {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vw-surface);
  border: 0.5px solid var(--vw-border2);
  color: var(--vw-text3);
  font-size: 14px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.msg-bubble:hover .bubble-delete { opacity: 1; }
.bubble-delete:hover { color: var(--vw-danger); }

/* Reaction picker trigger — same hover affordance pattern as bubble-delete,
   on the opposite role (inbound only). Top-right of the bubble; absolute
   so the bubble keeps its content-shrink width. */
.bubble-react {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vw-surface);
  border: 0.5px solid var(--vw-border2);
  color: var(--vw-text3);
  font-size: 14px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.msg-bubble:hover .bubble-react { opacity: 1; }
.bubble-react:hover { color: var(--vw-purple-pale); }

/* ── Reactions ── */
.reactions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 99px;
  border: 0.5px solid var(--vw-border2);
  background: var(--vw-surface2);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s;
  color: var(--vw-text);
}
.reaction-pill:hover { border-color: var(--vw-purple-light); }
/* "Mine" pills go mint instead of purple — splash of secondary colour to
   break up the otherwise all-purple chat. */
.reaction-pill.mine {
  border-color: var(--vw-green-strong);
  background: color-mix(in srgb, var(--vw-green-strong) 15%, transparent);
}

.reaction-count {
  font-size: 11px;
  color: var(--vw-text2);
  margin-left: 2px;
}


/* ── Input bar ── */
.input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 0.5px solid var(--vw-border);
  background: var(--vw-surface);
  flex-shrink: 0;
}

.send-icon {
  display: block;
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 9px solid var(--vw-purple-pale);
  margin-left: 2px;
}

.vw-btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Attach button + hidden file input ── */
.attach-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: none;
  color: var(--vw-text2);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.attach-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}
.attach-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.file-input-hidden {
  display: none;
}

/* ── Image attachments inside bubbles ── */
.msg-image {
  display: block;
  max-width: min(320px, 100%);
  max-height: 320px;
  width: auto;
  height: auto;
  border-radius: 10px;
  background: var(--vw-surface);
  cursor: zoom-in;
}
/* Image-only bubbles: drop the bubble's chrome so the image looks like the
   bubble itself. Keeps the rounded corners from the bubble class but
   removes the surrounding padding/background that would look like a frame. */
.msg-bubble.has-image {
  padding: 4px;
  background: transparent;
  border: none;
}
.msg-bubble.has-image .msg-image {
  border-radius: 12px;
}

/* ── Lightbox ── */
.lightbox {
  position: fixed;
  inset: 0;
  /* Lightbox backdrop is a near-opaque tint of the deepest app surface
     rather than raw black — keeps the whole app feeling on-palette even
     when the overlay is at full strength. */
  background: color-mix(in srgb, var(--vw-bg) 96%, #000);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
  cursor: zoom-out;
  /* Backdrop fade in feels less jarring than a hard pop */
  animation: lightbox-fade 0.12s ease-out;
}
@keyframes lightbox-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.lightbox-image {
  max-width: 95vw;
  max-height: 95vh;
  width: auto;
  height: auto;
  object-fit: contain;
  cursor: zoom-out;
  border-radius: 6px;
}
.lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--vw-text) 10%, transparent);
  border: none;
  color: var(--vw-text);
  font-size: 22px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.lightbox-close:hover {
  background: color-mix(in srgb, var(--vw-text) 20%, transparent);
}
</style>
