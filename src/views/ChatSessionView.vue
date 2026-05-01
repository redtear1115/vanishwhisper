<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChatMessageBubble from '../components/ChatMessageBubble.vue'
import ChatRenamePanel from '../components/ChatRenamePanel.vue'
import AppIcon from '../components/AppIcon.vue'
import DeleteBanner from '../components/DeleteBanner.vue'
import StickerPicker from '../components/StickerPicker.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { getIdentity } from '../identity'
import { markVisited, sessionDisplay, setHidden, useLabels } from '../labels'
import { claimOrphanMessages } from '../migration'
import {
  deleteMessage,
  markRead,
  sendImageMessage,
  sendMessage,
  sendStickerMessage,
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
import { useChatScroll } from '../useChatScroll'
import { useDocumentDismiss } from '../useDocumentDismiss'
import { useImageLightbox } from '../useImageLightbox'
import { useVanish } from '../useVanish'

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
// Image lightbox state + body scroll lock + Esc dismissal live in
// useImageLightbox. The composable owns its own keydown listener (with
// onMounted / onUnmounted cleanup) so the chat view doesn't have to
// thread Esc handling through useDocumentDismiss for it.
const { lightboxUrl, openLightbox, closeLightbox } = useImageLightbox()

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
const myMinutes = ref<number | null>(null)
const otherMinutes = ref<number | null>(null)

// Read-and-vanish math + 1-Hz tick + auto markDeleted firing all live in
// useVanish — see its top-of-file comment for the boundary. Caller still
// owns the minutes subscriptions (below) so this view's error.value can
// surface Firestore failures the way the rest of the view does.
const { isVanished, vanishLabel, progressStyle, showProgress } = useVanish({
  messages,
  myMinutes,
  otherMinutes,
})

const readFired = new Set<string>()
const pickerOpenFor = ref<string | null>(null)

// Reply / quote target. When non-null, the next sent text/sticker/image
// message will store ReplyTo = this id. Cleared automatically once the send
// resolves OR the user dismisses the chip with × on the input bar.
const replyTo = ref<ChatMessageRow | null>(null)
// While briefly set, the row whose data-mid matches gets a highlight ring —
// fired by jumpToReply() so the user's eye lands on the original message
// after the smooth-scroll. Cleared by a setTimeout after the keyframe ends.
const pulseMid = ref<string | null>(null)

// Inline rename panel — UI lives in ChatRenamePanel.vue. We hold only
// the open flag here so other handlers (delete request below) can force
// the panel closed via v-model when their UI takes over.
const renaming = ref(false)
// Header overflow menu (⋯). Open via the explicit button; close on
// item-click, click-outside, or Esc — both via useDocumentDismiss.
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

// Other-party label (when the user has set one) drives the chat-header
// avatar's initials. Falls through to the uid inside UserAvatar when
// null, matching the home list so the same coloured initials greet the
// user across surfaces.
const otherLabelName = computed(() => labels.value.get(props.id)?.otherName ?? null)

let unsub: (() => void) | null = null
let unsubMyMinutes: (() => void) | null = null
let unsubOtherMinutes: (() => void) | null = null
let unsubSession: (() => void) | null = null

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
      (m) => {
        myMinutes.value = m
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
    unsubOtherMinutes = subscribeDeletedInMinutes(
      session.otherParticipant,
      (m) => {
        otherMinutes.value = m
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
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
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
    unsub = subscribeMessages(
      props.id,
      session.sessionKey,
      (rows) => {
        messages.value = rows
        ackUnread(rows)
        // Post-migration cleanup. claimOrphanMessages() short-circuits to a
        // no-op once it has seen this session in this process lifetime AND
        // confirmed there are no orphan UIDs to claim — so the steady-state
        // cost is one Set lookup per snapshot tick.
        void claimOrphanMessages(props.id, rows, session.otherParticipant)
      },
      (err) => {
        error.value = err instanceof Error ? err.message : String(err)
      },
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

onMounted(() => {
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
  // (Body scroll lock cleanup for the image lightbox lives in
  // useImageLightbox's own onUnmounted.)
  // Persist a fresh lastSeenAt covering the whole visit — anything that
  // arrived while the user was reading is now considered seen.
  void markVisited(props.id)
})

// Per-session client-side hide. Local-only (labels.ts → IDB) — the other
// party doesn't know we hid them. While hidden the message list and input
// bar are replaced by the same empty-state placeholder a brand-new chat
// shows, so a glance at the screen looks like an empty conversation rather
// than a deliberately hidden one. Declared here (rather than next to its
// menu handler down below) because `visibleMessages` reads it, and the
// watcher on visibleMessages right after this block runs its source getter
// once during setup to register reactive deps — if sessionHidden weren't
// initialised by that point, that initial getter eval would throw a TDZ
// ReferenceError and the whole chat view would fail to render.
const sessionHidden = computed(() => labels.value.get(props.id)?.hidden === true)

async function onMenuToggleHide(): Promise<void> {
  menuOpen.value = false
  error.value = null
  try {
    await setHidden(props.id, !sessionHidden.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// On hide-on, drop any in-progress reply chip — the input bar is about to
// disappear and a stale replyTo would resurface attached to the next thing
// the user composes after un-hiding. On hide-off, replay ackUnread against
// the current row set so messages received during the hidden window get
// marked read now (subscribeMessages's callback already ran while we were
// suppressing, so we have to manually reconcile).
watch(sessionHidden, (hidden) => {
  if (hidden) {
    replyTo.value = null
  } else {
    ackUnread(messages.value)
  }
})

// Skip while the chat is client-side-hidden: writing ReadAt would start the
// vanish timer for messages the user explicitly chose not to look at, so
// hidden mode acts as a soft pause on Read & Vanish. When the user toggles
// back to visible, the sessionHidden watcher above reruns this on the
// current row set so anything that piled up while hidden gets acked
// exactly as if the user had just opened the chat.
function ackUnread(rows: ChatMessageRow[]): void {
  if (sessionHidden.value) return
  for (const m of rows) {
    if (m.fromMe || m.readAt || m.deletedAt || readFired.has(m.id)) continue
    readFired.add(m.id)
    markRead(m.id).catch((err) => {
      readFired.delete(m.id)
      console.error('markRead failed', err)
    })
  }
}

// Drop the entire row set while hidden so the message container falls
// through to the same `No messages yet — say hi.` placeholder a brand-new
// chat shows. Keeping `messages.value` populated underneath means useVanish's
// tick + the un-hide ackUnread replay still see the real data.
const visibleMessages = computed(() => {
  if (sessionHidden.value) return []
  return messages.value.filter((m) => !isVanished(m))
})

// Auto-scroll: keep the chat pinned to the bottom when the user is
// already there, leave their position alone if they've scrolled up,
// resume sticking the moment they scroll back down. After a successful
// send / sticker / image attachment, forceStick() is called so the
// user always sees what they just shipped — see send() / onPickSticker
// / onFileSelected below. messagesContainerRef is also reused by
// jumpToReply() for querySelector inside the scroll viewport.
const { messagesContainerRef, onScroll: onChatScroll, forceStick } = useChatScroll(visibleMessages)

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
    forceStick()
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
    forceStick()
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
    forceStick()
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

// Picker is one-shot: clicking an emoji toggles the reaction and closes
// the picker. Combined with click-outside-closes (document listener below)
// this means there's no explicit "close" button — the picker behaves like
// a transient menu instead of a sticky panel.
async function onReactAndClose(messageId: string, emoji: string, hasMine: boolean): Promise<void> {
  pickerOpenFor.value = null
  try {
    await toggleReaction(messageId, emoji, hasMine)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Outside-click + Esc dismiss for every transient popover in this view.
// Open triggers and inner content all use @click.stop so anything
// reaching document is outside by definition — the click handler
// closes ALL of them without hit-testing. The image lightbox handles
// its own Esc inside useImageLightbox; clicks on it are absorbed by
// the overlay so it doesn't need outside-click coordination.
useDocumentDismiss({
  onClickOutside: () => {
    pickerOpenFor.value = null
    menuOpen.value = false
    stickerPickerOpen.value = false
  },
  onEscape: () => {
    menuOpen.value = false
    stickerPickerOpen.value = false
  },
})

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

function startReply(m: ChatMessageRow): void {
  // Defense in depth: the trigger button is only rendered on inbound
  // bubbles, but guard the entry point too so a future template tweak
  // can't accidentally let outbound through.
  if (m.fromMe) return
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
  const el = container.querySelector<HTMLElement>(`[data-mid="${CSS.escape(replyId)}"]`)
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
  // ChatRenamePanel seeds its own draft fields off the labels store via
  // a watch on `open`, so just flipping the flag is enough.
  renaming.value = true
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
      <router-link to="/" class="back-btn" aria-label="Back to sessions">
        <AppIcon name="back" :size="18" />
      </router-link>
      <UserAvatar v-if="opened" :uid="opened.otherParticipant" :name="otherLabelName" :size="28" />
      <div class="chat-header-info">
        <span class="chat-title">{{ headerDisplay.primary }}</span>
        <span v-if="headerDisplay.secondary" class="chat-subtitle">{{
          headerDisplay.secondary
        }}</span>
      </div>
      <button
        type="button"
        class="header-menu-btn"
        :title="menuOpen ? 'Close menu' : 'Session menu'"
        :aria-label="menuOpen ? 'Close menu' : 'Session menu'"
        @click.stop="menuOpen = !menuOpen"
      >
        <AppIcon name="more" :size="18" />
      </button>
      <span class="vw-badge-e2e">E2E</span>

      <div v-if="menuOpen" class="vw-popover header-menu" @click.stop>
        <!-- Session-internal actions only. List-management (Pin / Archive)
             lives in the home row's per-row ⋯ menu, since those are about
             how the row sits in the home list rather than the chat itself. -->
        <button type="button" class="vw-popover-item" @click="onMenuRename">Rename</button>
        <button type="button" class="vw-popover-item" @click="onMenuToggleHide">
          {{ sessionHidden ? 'Show messages' : 'Hide messages' }}
        </button>
        <button
          v-if="deleteRequestState === 'none'"
          type="button"
          class="vw-popover-item danger"
          @click="onMenuRequestDelete"
        >
          Request delete
        </button>
      </div>
    </header>

    <ChatRenamePanel
      v-model:open="renaming"
      :session-id="props.id"
      :other-uid="opened?.otherParticipant ?? null"
      @error="(msg) => (error = msg)"
    />

    <!-- Mutual-delete banner. Two flavours depending on who requested. -->
    <DeleteBanner
      v-if="deleteRequestState !== 'none'"
      :state="deleteRequestState"
      :deleting="deleting"
      @cancel="onCancelOrReject"
      @agree="onAgreeDelete"
      @reject="onCancelOrReject"
    />

    <!-- Error banner -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="!opened && !error" class="chat-loading">
      <p style="font-size: 13px; color: var(--vw-text3)">Opening session…</p>
    </div>

    <!-- Messages -->
    <div v-else-if="opened" ref="messagesContainerRef" class="chat-messages" @scroll="onChatScroll">
      <p v-if="visibleMessages.length === 0" class="chat-empty">No messages yet — say hi.</p>
      <ChatMessageBubble
        v-for="(m, idx) in visibleMessages"
        :key="m.id"
        :message="m"
        :my-uid="opened.myUid"
        :is-last-of-group="isLastOfGroup(idx)"
        :show-progress="showProgress(m)"
        :progress-style="progressStyle(m)"
        :vanish-label="vanishLabel(m)"
        :pulse="pulseMid === m.id"
        :picker-open="pickerOpenFor === m.id"
        :reply-target="m.replyTo ? findReplyTarget(m.replyTo) : undefined"
        :reply-snippet="m.replyTo ? replySnippet(findReplyTarget(m.replyTo)) : ''"
        @delete="onDelete(m.id)"
        @react="(emoji, hasMine) => onReactAndClose(m.id, emoji, hasMine)"
        @reply="startReply(m)"
        @picker-open="pickerOpenFor = m.id"
        @jump="jumpToReply"
        @lightbox="openLightbox"
      />
    </div>

    <!-- Lightbox overlay — teleported to body so it escapes any parent
         stacking context (chat header, input bar, etc.) and covers the
         viewport regardless of where this template lives. Click anywhere
         (backdrop or image) closes; Esc also closes via document keydown. -->
    <Teleport to="body">
      <div v-if="lightboxUrl" class="lightbox" @click="closeLightbox">
        <img :src="lightboxUrl" class="lightbox-image" alt="" />
        <button type="button" class="lightbox-close" aria-label="Close" @click.stop="closeLightbox">
          <AppIcon name="close" :size="20" />
        </button>
      </div>
    </Teleport>

    <!-- Reply preview chip. Sits just above the input bar so it visually
         "feeds into" the next message being composed. Carries an × to
         cancel; otherwise it clears automatically when the send resolves.
         Snippet helper covers vanished/sticker/image/decrypt-fail cases.
         Same minimal typographic style as the in-bubble quote strip:
         indent + thin border-left + muted text, no icon prefix. -->
    <div v-if="replyTo && opened" class="reply-preview" @click.stop>
      <span class="reply-preview-snippet">{{ replySnippet(replyTo) }}</span>
      <button
        type="button"
        class="reply-preview-close"
        aria-label="Cancel reply"
        @click="cancelReply"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <!-- Input bar. Drops out while sessionHidden so a glance at the screen
         shows the same neutral empty state a brand-new chat would. -->
    <form v-if="opened && !sessionHidden" class="input-bar" @submit.prevent="send">
      <button
        type="button"
        class="attach-btn"
        :disabled="sending || sendingImage"
        :title="sendingImage ? 'Sending image…' : 'Attach image (max 5 MB)'"
        :aria-label="sendingImage ? 'Sending image' : 'Attach image'"
        @click="openFilePicker"
      >
        <AppIcon name="attach" :size="18" />
      </button>
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
        aria-label="Send a sticker"
        @click.stop="stickerPickerOpen = !stickerPickerOpen"
      >
        <AppIcon name="sticker" :size="18" />
      </button>
      <input
        ref="draftInputRef"
        v-model="draft"
        class="vw-input-pill"
        :disabled="sending || sendingImage"
        placeholder="Type a message…"
        required
      />
      <button type="submit" class="vw-btn-send" :disabled="sending || sendingImage || !draft">
        <span class="send-icon" />
      </button>

      <!-- Sticker picker — floats above the input bar. Open state stays
           here so the existing useDocumentDismiss handler can coordinate
           dismissal alongside the header menu and reaction picker. -->
      <StickerPicker v-if="stickerPickerOpen" @pick="onPickSticker" />
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
  /* Wraps an Icon (SVG) now rather than a text glyph — flex centers it
     in a 28px tap target so the touch surface is the same as the menu
     button on the right side of the header. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--vw-purple-light);
  text-decoration: none;
  flex-shrink: 0;
  transition:
    color 0.15s,
    background 0.15s;
}
.back-btn:hover {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}

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
  /* Fraunces serif at 14px gives the chat header a "this is a private
     channel" editorial feel — distinct from the body sans used in the
     conversation. Lower opsz (smaller optical-size) keeps it readable
     at this small a size. SOFT moderate, WONK off for a calmer header. */
  font-family: var(--vw-font-display);
  font-variation-settings:
    'opsz' 14,
    'SOFT' 40,
    'WONK' 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--vw-text);
  letter-spacing: -0.005em;
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
  transition:
    color 0.15s,
    background 0.15s;
}
.header-menu-btn:hover {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}

/* Dropdown anchored to the bottom-right of the chat header; absolute
   inside .chat-header (which is position:relative). z-index above the
   message list and the rename panel. Surface chrome comes from .vw-popover
   in theme.css; this rule only carries the per-instance positioning,
   layout, and the slightly tighter 8px radius. */
.header-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 12px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 100;
  border-radius: 8px;
}

.chat-subtitle {
  font-size: 11px;
  color: var(--vw-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.chat-messages::-webkit-scrollbar {
  width: 4px;
}
.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: var(--vw-border2);
  border-radius: 2px;
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

.vw-btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

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
  transition:
    color 0.15s,
    background 0.15s;
}
.attach-btn:hover:not(:disabled) {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}
.attach-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.file-input-hidden {
  display: none;
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
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
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

/* Reply preview — typographic kin to ChatMessageBubble's `.reply-jump`
   quote strip, just laid out horizontally to fit the input bar's row.
   Indent + thin rule + muted text; no big chip background, no author
   label (in a 2-party chat where you can only quote the other side,
   "replying to them" is implicit from the chip's existence). The × is
   the only affordance. */
.reply-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--vw-surface);
  border-top: 0.5px solid var(--vw-border);
  flex-shrink: 0;
}
.reply-preview-snippet {
  flex: 1;
  min-width: 0;
  border-left: 2px solid var(--vw-border2);
  padding: 1px 0 1px 8px;
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
.reply-preview-close:hover {
  color: var(--vw-purple-pale);
}
</style>
