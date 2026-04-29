<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getIdentity } from '../identity'
import { markVisited, sessionDisplay, setLabel, setSessionState, useLabels } from '../labels'
import {
  deleteMessage,
  markDeleted,
  markRead,
  sendImageMessage,
  sendMessage,
  sendStickerMessage,
  subscribeMessages,
  toggleReaction,
  type ChatMessageRow,
} from '../messages'
import { STICKERS, stickerUrl } from '../stickers'
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

// Reply / quote target. When non-null, the next sent text/sticker/image
// message will store ReplyTo = this id. Cleared automatically once the send
// resolves OR the user dismisses the chip with × on the input bar.
const replyTo = ref<ChatMessageRow | null>(null)
// While briefly set, the row whose data-mid matches gets a highlight ring —
// fired by jumpToReply() so the user's eye lands on the original message
// after the smooth-scroll. Cleared by a setTimeout after the keyframe ends.
const pulseMid = ref<string | null>(null)

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

// Sticker picker (input bar). Same open/close lifecycle as the menu and
// reaction picker — toggled by the explicit 😺 button, closed by document
// click outside / Esc / picking a sticker. Always closes after a send.
const stickerPickerOpen = ref(false)

// Header display derived from sessionDisplay(). See its doc comment for the
// four-state matrix. Pre-load placeholder uses sessionName if available
// (instant from labels store) and falls back to bare "Chat" while
// openSession() is in flight — once the other participant uid is known
// the proper "Chat with X" title takes over.
const headerDisplay = computed(() => {
  if (!opened.value) {
    const lbl = labels.value.get(props.id)
    return {
      primary: lbl?.sessionName ?? 'Chat',
      secondary: '',
    }
  }
  return sessionDisplay(labels.value, props.id, opened.value.otherParticipant, {
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
  // Mark this chat as "seen up to now" so the home unread dot extinguishes
  // for any messages the user is about to ack-read in this view. Mirror
  // call on unmount picks up anything received during the visit.
  void markVisited(props.id)
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
  // Persist a fresh lastSeenAt covering the whole visit — anything that
  // arrived while the user was reading is now considered seen.
  void markVisited(props.id)
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
  // Snapshot the reply id BEFORE the await so a late state mutation doesn't
  // either lose the link or carry it onto a follow-up unrelated send.
  const replyId = replyTo.value?.id ?? null
  try {
    await sendMessage(props.id, opened.value.sessionKey, draft.value, replyId)
    draft.value = ''
    replyTo.value = null
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

async function onPickSticker(stickerKey: string): Promise<void> {
  if (!opened.value) return
  // Close picker before the async send so the click feedback is immediate.
  stickerPickerOpen.value = false
  error.value = null
  const replyId = replyTo.value?.id ?? null
  try {
    await sendStickerMessage(props.id, stickerKey, replyId)
    replyTo.value = null
    stickToBottom = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
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
  const replyId = replyTo.value?.id ?? null
  try {
    await sendImageMessage(props.id, opened.value.sessionKey, file, replyId)
    replyTo.value = null
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

// Bucketed vanish text. CEIL-based rounding so the very first label after
// readAt matches the user's configured value (1h setting → "vanishes in 1h"
// from frame one). Floor-based rounding would slot a sub-60-min remaining
// into the 15-min bucket and round it down to "45m" before the user even
// sees the message land — confusing.
//
// Semantics: each label means "AT MOST this much remaining". Coarser
// precision as remaining grows so most ticks render the same string and
// Vue's diff skips the DOM update — only the final minute (sub-60s bucket)
// actually re-paints per second. The CSS-animated line below the bubble
// carries the smooth per-second visual signal.
//
//   <60s    → seconds        ("45s"),  60s rounds up to "1m"
//   1m–5m   → whole minutes  ("4m")
//   5m–15m  → 5-min steps    ("10m")
//   15m–1h  → 15-min steps   ("45m"),  60m rounds up to "1h"
//   ≥1h     → whole hours    ("2h")
function vanishLabel(m: ChatMessageRow): string {
  const at = vanishAtMs(m)
  if (at === null) return 'unread'
  const remaining = Math.max(0, at - now.value)
  if (remaining < 60_000) {
    const s = Math.ceil(remaining / 1000)
    return s >= 60 ? 'vanishes in 1m' : `vanishes in ${s}s`
  }
  if (remaining < 5 * 60_000) {
    return `vanishes in ${Math.ceil(remaining / 60_000)}m`
  }
  if (remaining < 15 * 60_000) {
    return `vanishes in ${Math.ceil(remaining / 60_000 / 5) * 5}m`
  }
  if (remaining < 60 * 60_000) {
    const v = Math.ceil(remaining / 60_000 / 15) * 15
    return v >= 60 ? 'vanishes in 1h' : `vanishes in ${v}m`
  }
  return `vanishes in ${Math.ceil(remaining / 3_600_000)}h`
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
// overflow menu AND the sticker picker. Their open triggers and inner
// buttons all use @click.stop so clicks INSIDE never reach this — anything
// that does is by definition outside.
function onDocumentClick(): void {
  if (pickerOpenFor.value !== null) {
    pickerOpenFor.value = null
  }
  if (menuOpen.value) {
    menuOpen.value = false
  }
  if (stickerPickerOpen.value) {
    stickerPickerOpen.value = false
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
  if (stickerPickerOpen.value) stickerPickerOpen.value = false
}

// Reply target lookup. We pull from messages.value (the unfiltered store)
// rather than visibleMessages so a target that's been auto-vanished still
// resolves — we then check deletedAt to render the "[message vanished]"
// placeholder. Returning undefined when the original is gone entirely
// (cascade-delete races) lets the snippet helper render the same placeholder.
function findReplyTarget(replyId: string): ChatMessageRow | undefined {
  return messages.value.find((m) => m.id === replyId)
}

// Compact one-line summary of a message, suitable for both the bubble's
// quote strip and the input-bar reply chip. Keeps types covered:
//   - vanished (deletedAt set OR target missing): "[message vanished]"
//   - failed decrypt:                              "[unable to decrypt]"
//   - sticker:                                     "[sticker]"
//   - image:                                       "📷 image"
//   - text: truncated to ~80 chars
function replySnippet(target: ChatMessageRow | undefined): string {
  if (!target || target.deletedAt) return '[message vanished]'
  if (target.text === null) return '[unable to decrypt]'
  if (target.sticker) return '[sticker]'
  if (target.attachment) return '📷 image'
  if (target.text === '') return '[empty message]'
  const t = target.text
  return t.length > 80 ? t.slice(0, 80) + '…' : t
}

function replyAuthorLabel(target: ChatMessageRow | undefined): string {
  if (!target) return ''
  return target.fromMe ? 'You' : 'Them'
}

function startReply(m: ChatMessageRow): void {
  replyTo.value = m
  // Pop the keyboard / focus the input so the user can start typing
  // immediately after picking a target — the typical reply flow.
  void nextTick().then(() => draftInputRef.value?.focus())
}

function cancelReply(): void {
  replyTo.value = null
}

// Click-to-jump on the bubble's quote strip. Find the target row in the
// scrollable container by data-mid, smooth-scroll it into view, and pulse
// the bubble briefly so the user's eye lands on it. No-op when the target
// has already vanished (the strip itself shows the "[vanished]" hint).
function jumpToReply(replyId: string): void {
  const container = messagesContainerRef.value
  if (!container) return
  // CSS.escape guards against unusual chars in Firestore doc ids (they're
  // alphanumeric in practice, but the API contract doesn't promise that).
  const el = container.querySelector<HTMLElement>(
    `[data-mid="${CSS.escape(replyId)}"]`,
  )
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  pulseMid.value = replyId
  // Auto-clear after the keyframe finishes so the class doesn't stick
  // around (would prevent re-triggering on a second jump to the same row).
  setTimeout(() => {
    if (pulseMid.value === replyId) pulseMid.value = null
  }, 1600)
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

// Pin / Archive toggles. Each is a 3-state toggle:
//   default → action sets state to target
//   target  → action clears state back to default
//   other   → action switches to target (pin and archive are exclusive)
const sessionState = computed(
  () => labels.value.get(props.id)?.state ?? 'default',
)

async function toggleSessionState(target: 'pinned' | 'archived'): Promise<void> {
  menuOpen.value = false
  error.value = null
  try {
    const next = sessionState.value === target ? undefined : target
    await setSessionState(props.id, next)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
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
          type="button"
          class="header-menu-item"
          @click="toggleSessionState('pinned')"
        >{{ sessionState === 'pinned' ? 'Unpin' : 'Pin to top' }}</button>
        <button
          type="button"
          class="header-menu-item"
          @click="toggleSessionState('archived')"
        >{{ sessionState === 'archived' ? 'Unarchive' : 'Archive' }}</button>
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

      <!-- Underlying ids — only place these surface in the UI. The rename
           panel is the natural home: user is in "manage labels" mode here,
           and seeing what each label "covers" helps when verifying you're
           naming the right person. -->
      <div class="rename-meta">
        <p><span class="rename-meta-label">Session id</span> <code>{{ props.id }}</code></p>
        <p v-if="opened">
          <span class="rename-meta-label">Other UID</span> <code>{{ opened.otherParticipant }}</code>
        </p>
      </div>

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
        :data-mid="m.id"
        class="msg-row"
        :class="[
          m.fromMe ? 'msg-me' : 'msg-them',
          isLastOfGroup(idx) ? 'group-end' : 'group-mid',
          { pulse: pulseMid === m.id },
        ]"
      >
        <!-- Quote strip — appears above the bubble whenever this message
             replies to another. Clicking jumps to and pulses the original.
             Renders even if the target has vanished (snippet helper shows
             the placeholder), so the conversational thread is preserved
             visually even after the original disappears. -->
        <button
          v-if="m.replyTo"
          type="button"
          class="reply-jump"
          :title="findReplyTarget(m.replyTo) ? 'Jump to original' : 'Original message has vanished'"
          @click.stop="jumpToReply(m.replyTo)"
        >
          <span class="reply-jump-author">↩ {{ replyAuthorLabel(findReplyTarget(m.replyTo)) }}</span>
          <span class="reply-jump-snippet">{{ replySnippet(findReplyTarget(m.replyTo)) }}</span>
        </button>

        <!-- Bubble (per-message). Unsend lives inside the bubble as a hover
             affordance so even mid-group messages can be unsent — the shared
             meta row below carries no per-message controls. Sticker / image /
             text are mutually exclusive in the UI (the input bar offers them
             via separate paths), so v-else-if down the chain. -->
        <div
          class="msg-bubble"
          :class="[
            m.fromMe ? 'vw-bubble-me' : 'vw-bubble-them',
            { 'has-image': m.attachment, 'has-sticker': m.sticker },
          ]"
        >
          <!-- Reply trigger — hover-revealed on the OPPOSITE side of the
               bubble from the existing delete/react buttons so the two
               clusters don't overlap. Available on both inbound and
               outbound bubbles (you can quote yourself to revive lost
               context in a slow back-and-forth too). -->
          <button
            class="bubble-reply"
            type="button"
            title="Reply"
            @click.stop="startReply(m)"
          >↩</button>
          <template v-if="m.sticker">
            <img
              v-if="stickerUrl(m.sticker)"
              :src="stickerUrl(m.sticker)!"
              class="msg-sticker"
              alt=""
            />
            <span v-else class="decrypt-err">[unknown sticker: {{ m.sticker }}]</span>
          </template>
          <img
            v-else-if="m.attachment?.blobUrl"
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

    <!-- Reply preview chip. Sits just above the input bar so it visually
         "feeds into" the next message being composed. Carries an X to
         cancel; otherwise it clears automatically when the send resolves.
         Snippet helper covers vanished/sticker/image/decrypt-fail cases. -->
    <div v-if="replyTo && opened" class="reply-preview" @click.stop>
      <div class="reply-preview-content">
        <span class="reply-preview-author">
          Replying to {{ replyTo.fromMe ? 'yourself' : 'them' }}
        </span>
        <span class="reply-preview-snippet">{{ replySnippet(replyTo) }}</span>
      </div>
      <button
        type="button"
        class="reply-preview-close"
        aria-label="Cancel reply"
        @click="cancelReply"
      >×</button>
    </div>

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
      <button
        type="button"
        class="attach-btn"
        :disabled="sending || sendingImage"
        title="Send a sticker"
        @click.stop="stickerPickerOpen = !stickerPickerOpen"
      >😺</button>
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

      <!-- Sticker picker — floats above the input bar. .stop on inner
           clicks so the document-click-to-close handler doesn't fire when
           the user picks something inside. -->
      <div v-if="stickerPickerOpen" class="sticker-picker" @click.stop>
        <button
          v-for="s in STICKERS"
          :key="s.key"
          type="button"
          class="sticker-picker-item"
          :title="s.label"
          @click="onPickSticker(s.key)"
        >
          <img :src="s.url" :alt="s.label" />
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.chat-wrap {
  display: flex;
  flex-direction: column;
  /* 100vh on mobile counts the address bar / keyboard area, so when the
     soft keyboard opens the input bar gets pushed below the visible
     viewport. 100dvh tracks the actual visible region so messages scroll
     independently and the input bar stays pinned. */
  height: 100vh;
  height: 100dvh;
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

/* Underlying ids info — sits between the label inputs and the action row,
   visually separated by a top border so it's clearly "what's actually
   there" reference data, not editable. */
.rename-meta {
  margin: 4px 0 2px;
  padding-top: 10px;
  border-top: 0.5px solid var(--vw-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--vw-text3);
}
.rename-meta p { margin: 0; }
.rename-meta-label {
  display: inline-block;
  min-width: 70px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
}
.rename-meta code {
  word-break: break-all;
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
  /* Anchor for the sticker picker's absolute positioning. */
  position: relative;
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

/* ── Sticker picker (floating panel above the input bar) ──
   `position: absolute` anchored to .input-bar (which gets position:relative
   below). Width matches the input area minus a little gutter so it visually
   "belongs" to the input row. Three columns × three rows for the bundled
   nine stickers. */
.sticker-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 8px;
  right: 8px;
  background: var(--vw-surface2);
  border: 0.5px solid var(--vw-border);
  border-radius: 12px;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  z-index: 50;
  box-shadow: 0 -4px 16px color-mix(in srgb, var(--vw-bg) 80%, transparent);
}

.sticker-picker-item {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 8px;
  aspect-ratio: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.15s;
}
.sticker-picker-item:hover {
  background: var(--vw-surface);
  transform: scale(1.05);
}
.sticker-picker-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
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

/* ── Stickers inside bubbles ── */
.msg-sticker {
  display: block;
  width: 160px;
  height: 160px;
  object-fit: contain;
}
/* Sticker-only bubbles: same chrome-strip treatment as has-image so the
   transparent PNG floats free instead of sitting on a coloured rectangle. */
.msg-bubble.has-sticker {
  padding: 0;
  background: transparent;
  border: none;
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

/* ── Reply / quote ──
   Three pieces work together:
   (1) `.bubble-reply` — hover-revealed ↩ on the OPPOSITE corner from
       delete/react, sized identically so the clusters look uniform.
   (2) `.reply-jump` — quote strip above a bubble that itself replies to
       another message. Click → smooth-scroll + pulse the original.
   (3) `.reply-preview` — chip above the input bar showing what the next
       send will quote, with × to cancel.

   The pulse keyframe applies a brief outline ring on the bubble inside the
   target row when the user clicks a jump; the ring uses box-shadow rather
   than background-color so it composes cleanly with the bubble's own
   purple/dark fill instead of overriding it. */
.bubble-reply {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--vw-surface);
  border: 0.5px solid var(--vw-border2);
  color: var(--vw-text3);
  font-size: 11px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.msg-bubble:hover .bubble-reply { opacity: 1; }
.bubble-reply:hover { color: var(--vw-purple-pale); }
/* Touch devices have no hover, so hover-only reveals are invisible there.
   Reveal the action cluster (reply / react / unsend) at low opacity so the
   user can find it, and full opacity when the bubble is tapped (focus-within
   covers the active touch). Mirror the same rule to the existing delete /
   react buttons so the cluster behaves consistently. */
@media (hover: none) {
  .bubble-reply,
  .bubble-react,
  .bubble-delete {
    opacity: 0.55;
  }
  .msg-bubble:focus-within .bubble-reply,
  .msg-bubble:focus-within .bubble-react,
  .msg-bubble:focus-within .bubble-delete {
    opacity: 1;
  }
}

.reply-jump {
  background: color-mix(in srgb, var(--vw-purple-light) 8%, transparent);
  border: none;
  border-left: 3px solid var(--vw-purple-light);
  border-radius: 4px 8px 8px 4px;
  padding: 4px 10px 5px;
  max-width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  transition: background 0.15s;
}
.reply-jump:hover {
  background: color-mix(in srgb, var(--vw-purple-light) 16%, transparent);
}
/* Mirror the accent bar for outbound rows so it points at the bubble
   (which sits flush right). Otherwise the strip would visually "lean" the
   wrong way relative to its bubble. */
.msg-me .reply-jump {
  border-left: none;
  border-right: 3px solid var(--vw-purple-light);
  border-radius: 8px 4px 4px 8px;
  text-align: right;
  align-items: flex-end;
}
.reply-jump-author {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vw-purple-light);
}
.reply-jump-snippet {
  font-size: 12px;
  color: var(--vw-text2);
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes msg-pulse {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  35%      { box-shadow: 0 0 0 4px color-mix(in srgb, var(--vw-purple-light) 35%, transparent); }
}
.msg-row.pulse > .msg-bubble {
  animation: msg-pulse 1.5s ease-in-out;
}

.reply-preview {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 14px;
  background: var(--vw-surface2);
  border-top: 0.5px solid var(--vw-border);
  flex-shrink: 0;
}
.reply-preview-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 3px solid var(--vw-purple-light);
  padding-left: 10px;
}
.reply-preview-author {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vw-purple-light);
}
.reply-preview-snippet {
  font-size: 12px;
  color: var(--vw-text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reply-preview-close {
  background: none;
  border: none;
  color: var(--vw-text3);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.reply-preview-close:hover { color: var(--vw-purple-pale); }
</style>
