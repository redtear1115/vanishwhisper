<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { getIdentity } from '../identity'
import { sessionDisplay, setLabel, useLabels } from '../labels'
import {
  deleteMessage,
  markDeleted,
  markRead,
  sendMessage,
  subscribeMessages,
  toggleReaction,
  type ChatMessageRow,
} from '../messages'
import { openSession, type OpenSession } from '../sessions'
import { getDeletedInMinutes } from '../users'

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const props = defineProps<{ id: string }>()
const { labels } = useLabels()

const opened = ref<OpenSession | null>(null)
const messages = ref<ChatMessageRow[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
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
let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  try {
    const session = await openSession(props.id)
    opened.value = session
    const me = getIdentity()
    const [mine, theirs] = await Promise.all([
      getDeletedInMinutes(me.uid),
      getDeletedInMinutes(session.otherParticipant),
    ])
    myMinutes.value = mine
    otherMinutes.value = theirs
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
})

onUnmounted(() => {
  unsub?.()
  if (timer !== null) clearInterval(timer)
  document.removeEventListener('click', onDocumentClick)
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

// Document-level click handler closes any open picker. The picker's open
// trigger and emoji buttons all use @click.stop so clicks INSIDE the picker
// never reach this — anything that does is by definition outside.
function onDocumentClick(): void {
  if (pickerOpenFor.value !== null) {
    pickerOpenFor.value = null
  }
}

async function onDelete(messageId: string): Promise<void> {
  try {
    await deleteMessage(messageId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="chat-wrap">
    <!-- Header -->
    <header class="chat-header">
      <router-link to="/" class="back-btn">←</router-link>
      <button
        type="button"
        class="chat-header-info"
        :title="renaming ? 'Close rename' : 'Rename session / other party'"
        @click="renaming ? (renaming = false) : openRenamePanel()"
      >
        <span class="chat-title">{{ headerDisplay.primary }}</span>
        <span v-if="headerDisplay.secondary" class="chat-subtitle">{{ headerDisplay.secondary }}</span>
      </button>
      <span class="vw-badge-e2e">E2E</span>
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
             meta row below carries no per-message controls. -->
        <div
          class="msg-bubble"
          :class="m.fromMe ? 'vw-bubble-me' : 'vw-bubble-them'"
        >
          <span v-if="m.text !== null">{{ m.text }}</span>
          <span v-else class="decrypt-err">[unable to decrypt]</span>
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

    <!-- Input bar -->
    <form v-if="opened" class="input-bar" @submit.prevent="send">
      <input
        v-model="draft"
        class="vw-input-pill"
        :disabled="sending"
        placeholder="Type a message…"
        required
      />
      <button type="submit" class="vw-btn-send" :disabled="sending || !draft">
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
  gap: 12px;
  padding: 12px 16px;
  background: var(--vw-surface);
  border-bottom: 0.5px solid var(--vw-border);
  flex-shrink: 0;
}

.back-btn {
  font-size: 16px;
  color: var(--vw-purple-light);
  text-decoration: none;
  flex-shrink: 0;
}
.back-btn:hover { color: var(--vw-purple-pale); }

/* The header info area is now a <button> so it can open the rename panel —
   reset native button chrome and keep the same column layout. */
.chat-header-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.chat-header-info:hover .chat-title { color: var(--vw-purple-pale); }

.chat-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vw-text);
  transition: color 0.15s;
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
  background: rgba(232, 92, 122, 0.12);
  border-bottom: 0.5px solid rgba(232, 92, 122, 0.3);
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
  background: rgba(123, 196, 123, 0.15);
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
</style>
