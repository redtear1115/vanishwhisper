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
import { stickerUrl } from '../stickers'
import { subscribeDeletedInMinutes } from '../users'
import { useChatScroll } from '../useChatScroll'
import { useDocumentDismiss } from '../useDocumentDismiss'
import { useImageLightbox } from '../useImageLightbox'
import { useVanish } from '../useVanish'
import { friendlyError } from '../errorMessage'

const props = defineProps<{ id: string }>()
const { labels } = useLabels()
const router = useRouter()

// Empty-state sticker. Resolved at module load via the bundled sticker
// registry — same pattern as HomeView's empty hero. `shh` (finger-to-lips
// Whisp) leans into the brand thesis: "this is a private, vanishing
// channel — say something, it's safe here".
const shhSticker = stickerUrl('shh')

const opened = ref<OpenSession | null>(null)
const messages = ref<ChatMessageRow[]>([])
const draft = ref('')
const sending = ref(false)
const sendingImage = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const draftInputRef = ref<HTMLInputElement | null>(null)
// Friendly-typed error state. `error.message` is what's shown; `error.retry`
// (when present) is a callback that re-runs the failed action with the same
// payload — wired into the error banner's "Retry" button. Replacing the old
// `string | null` shape lets every catch path either keep the old behaviour
// (translate + retryable=true → callback set) or opt out (retryable=false →
// retry button hidden, e.g. permission-denied where retrying won't help).
const error = ref<{ message: string; retry: (() => Promise<void>) | null } | null>(null)
function setError(err: unknown, retry: (() => Promise<void>) | null = null): void {
  const f = friendlyError(err)
  // Permission-denied / not-found / unauthenticated are non-retryable per
  // the friendlyError table — don't offer a retry button for those even if
  // the caller passed one.
  error.value = { message: f.message, retry: f.retryable ? retry : null }
}

// First-time vanish explainer. Surfaced as a small dismissible tooltip the
// first time ANY chat session is opened in this browser — teaches the
// vanish concept BEFORE the user watches their first message disappear and
// wonders if it broke. Persistence is localStorage, not IDB: it's a pure
// UI-state flag (never synced, never sensitive) and a sync read at mount
// keeps the first-paint clean. Same "burn" gesture as everything else
// (clear site data) resets the flag.
const VANISH_SEEN_KEY = 'vw:vanish-explainer-seen'
const vanishOnboardingOpen = ref(false)
function dismissVanishOnboarding(): void {
  vanishOnboardingOpen.value = false
  try {
    localStorage.setItem(VANISH_SEEN_KEY, '1')
  } catch {
    // Private mode / quota exceeded — the tooltip just keeps showing for
    // this session, which is a non-issue. Don't spam the error banner.
  }
}

// E2E badge → tap target popover. Same dismissal lifecycle as the header
// menu (outside-click + Esc, both handled by the existing useDocumentDismiss
// instance below). Opens a 3-line plain-language explainer the first time
// a user wonders what "E2E" actually guarantees.
const e2eExplainerOpen = ref(false)

// Image preview-before-send. After the file picker resolves we hold the
// File object + an object-URL preview here, render an overlay, and only
// kick off the actual encrypted-send when the user confirms. Stops the
// universal "tap attach → fat-finger picks wrong image → instantly sent
// to a private chat" failure mode. The object-URL lifecycle is paired
// with explicit revoke() calls so we don't leak blob refs across
// repeated preview cycles.
const pendingImage = ref<{ file: File; url: string } | null>(null)
function clearPendingImage(): void {
  if (pendingImage.value) {
    URL.revokeObjectURL(pendingImage.value.url)
    pendingImage.value = null
  }
}

// Live-region announcement for incoming messages — feeds a screen reader
// "new message from {name}" without painting anything on screen. Cleared
// after a short delay so back-to-back arrivals each trigger an
// announcement (a stable string wouldn't re-announce). Only set for
// incoming messages; own sends don't need announcing.
const liveAnnouncement = ref('')
let liveClearTimer: ReturnType<typeof setTimeout> | null = null
function announce(msg: string): void {
  liveAnnouncement.value = msg
  if (liveClearTimer) clearTimeout(liveClearTimer)
  liveClearTimer = setTimeout(() => {
    liveAnnouncement.value = ''
  }, 1200)
}
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

// Draft persistence (localStorage, scoped by session id). Survives app-switch
// and tab-reload mid-compose — universal expectation from iMessage / WhatsApp.
// localStorage (not IDB) on purpose: synchronous, cheap, plenty of headroom
// for a single text field, and a sync read at mount avoids a paint-flash
// where the input shows blank for one frame before the saved value lands.
// Cleared on successful send + when mutual-delete races us to a vanish.
const DRAFT_KEY = `vw:draft:${props.id}`
try {
  const saved = localStorage.getItem(DRAFT_KEY)
  if (saved) draft.value = saved
} catch {
  // Same private-mode guard as the vanish flag — fail open, the user just
  // loses draft persistence for this session.
}
watch(draft, (v) => {
  try {
    if (v) localStorage.setItem(DRAFT_KEY, v)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignored — see comment above
  }
})

// First-time vanish explainer trigger. Reads the seen-flag sync at mount
// so first paint either includes the overlay or doesn't, no late pop-in.
try {
  if (localStorage.getItem(VANISH_SEEN_KEY) !== '1') {
    vanishOnboardingOpen.value = true
  }
} catch {
  // private mode — skip the tooltip silently; better than spamming it on
  // every mount when we can't persist the dismissal.
}

// Track previous message ids so we can detect *new* incoming messages and
// announce them to AT users via the live region. Initialised lazily inside
// the subscribe callback so the first batch (history snapshot) doesn't fire
// a flurry of "new message" announcements on chat open.
let seenIds: Set<string> | null = null

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
        setError(err)
      },
    )
    unsubOtherMinutes = subscribeDeletedInMinutes(
      session.otherParticipant,
      (m) => {
        otherMinutes.value = m
      },
      (err) => {
        setError(err)
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
        setError(err)
      },
    )
    unsub = subscribeMessages(
      props.id,
      session.sessionKey,
      (rows) => {
        // Announce newly arrived incoming messages to AT users. First batch
        // (history snapshot on open) initialises the seen set without firing
        // announcements so a screen reader doesn't burst-read every prior
        // message on chat entry.
        if (seenIds === null) {
          seenIds = new Set(rows.map((r) => r.id))
        } else {
          for (const r of rows) {
            if (seenIds.has(r.id) || r.fromMe) continue
            seenIds.add(r.id)
            announce('New message')
            break // one announcement per snapshot tick is enough; bursts are noise
          }
        }
        messages.value = rows
        ackUnread(rows)
        // Post-migration cleanup. claimOrphanMessages() short-circuits to a
        // no-op once it has seen this session in this process lifetime AND
        // confirmed there are no orphan UIDs to claim — so the steady-state
        // cost is one Set lookup per snapshot tick.
        void claimOrphanMessages(props.id, rows, session.otherParticipant)
      },
      (err) => {
        setError(err)
      },
    )
  } catch (err) {
    setError(err)
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
  // Revoke any pending preview object-URL so we don't leak a blob ref if
  // the user navigates away mid-preview (otherwise it lingers until the
  // browser tab is closed).
  clearPendingImage()
  if (liveClearTimer) clearTimeout(liveClearTimer)
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
    setError(err)
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
  // Snapshot the text + reply id BEFORE the await so a late state mutation
  // doesn't either lose the link or carry it onto a follow-up unrelated send,
  // AND so a retry after failure replays the original payload (drafts may
  // have moved on if the user kept typing during the error banner).
  const text = draft.value
  const replyId = replyTo.value?.id ?? null
  try {
    await sendMessage(props.id, opened.value.sessionKey, text, replyId)
    draft.value = ''
    replyTo.value = null
    // Force stick — even if the user had scrolled up, sending obviously
    // means they want to see what they just sent.
    forceStick()
  } catch (err) {
    // Retry recreates the exact prior call with the captured text + replyId
    // so the user doesn't have to re-type anything if the network blipped.
    setError(err, async () => {
      if (!opened.value) return
      sending.value = true
      try {
        await sendMessage(props.id, opened.value.sessionKey, text, replyId)
        // Only clear draft + replyTo on a successful retry — same as the
        // happy path. The watcher on draft propagates the clear to
        // localStorage, so a retried send also cleans up the saved draft.
        if (draft.value === text) draft.value = ''
        if (replyTo.value?.id === replyId) replyTo.value = null
      } catch (e) {
        setError(e)
      } finally {
        sending.value = false
      }
    })
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
    setError(err, async () => {
      try {
        await sendStickerMessage(props.id, stickerKey, replyId)
        if (replyTo.value?.id === replyId) replyTo.value = null
      } catch (e) {
        setError(e)
      }
    })
  }
}

// File picked from the input → DON'T send yet. Stash the file and an
// object-URL for preview, render the preview overlay, and wait for the
// user's explicit Send / Cancel. Stops the universal one-tap-overshoot
// failure mode (attach → fat-finger picks wrong image → in a private
// chat). The actual encrypted send lives in confirmImageSend() below.
function onFilePicked(e: Event): void {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  // Reset so the same file can be picked again (browsers won't fire change
  // for the same path twice in a row otherwise).
  target.value = ''
  if (!file || !opened.value) return
  clearPendingImage() // drop any prior preview before swapping in the new one
  pendingImage.value = { file, url: URL.createObjectURL(file) }
}

async function confirmImageSend(): Promise<void> {
  if (!opened.value || !pendingImage.value) return
  const file = pendingImage.value.file
  sendingImage.value = true
  error.value = null
  // Hide the preview overlay synchronously — keeps the click feedback
  // immediate; the encrypted-send progress lives in the disabled state of
  // the input bar buttons.
  clearPendingImage()
  const replyId = replyTo.value?.id ?? null
  try {
    await sendImageMessage(props.id, opened.value.sessionKey, file, replyId)
    replyTo.value = null
    forceStick()
  } catch (err) {
    // Image retry replays with the same File. The File reference is captured
    // by closure here, so even if the user picks something else later (which
    // would clear pendingImage), the retry still has the original bytes.
    setError(err, async () => {
      if (!opened.value) return
      sendingImage.value = true
      try {
        await sendImageMessage(props.id, opened.value.sessionKey, file, replyId)
        if (replyTo.value?.id === replyId) replyTo.value = null
      } catch (e) {
        setError(e)
      } finally {
        sendingImage.value = false
      }
    })
  } finally {
    sendingImage.value = false
    // Same Chrome focus quirk as send() — the text input flips disabled
    // during the upload and won't auto-refocus. Restore so the user can
    // type a follow-up without re-clicking.
    await nextTick()
    draftInputRef.value?.focus()
  }
}

function cancelImageSend(): void {
  clearPendingImage()
}

// "1.2 MB" / "640 KB" / "32 B" — short enough for the preview footer and
// honest about the byte count the encrypted send will actually transmit
// (no separate "estimated after compression" — the size shown is what's
// in memory right now). Used only by the image-preview footer.
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`
}

// Auto-dismiss the first-time vanish tooltip the moment the user actually
// sends their first message — the act of sending IS the moment the
// concept becomes self-explanatory, and the tooltip becomes redundant
// chrome after that. Cheaper than asking the user to dismiss twice
// (once on read, once on send) — the seen-flag covers both.
watch(messages, (rows) => {
  if (!vanishOnboardingOpen.value) return
  if (rows.some((r) => r.fromMe)) dismissVanishOnboarding()
})

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
    setError(err)
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
    e2eExplainerOpen.value = false
  },
  onEscape: () => {
    menuOpen.value = false
    stickerPickerOpen.value = false
    e2eExplainerOpen.value = false
    // Image preview is a modal-class affordance — Esc cancels (matches
    // the lightbox / system file picker convention).
    if (pendingImage.value) clearPendingImage()
    // Onboarding tooltip is non-modal but we still let Esc dismiss for
    // keyboard users who don't want to mouse to the × — same gesture
    // closes everything else above so this is consistent.
    if (vanishOnboardingOpen.value) dismissVanishOnboarding()
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
  // Warmer, lower-case parenthetical voice — matches the rest of the
  // chat's tone (PRODUCT.md "intimate" personality). The previous
  // bracketed "[message vanished]" read clinical for a product that
  // describes vanishing as a feature, not a failure.
  if (!target || target.deletedAt) return '(this one vanished)'
  if (target.text === null) return "(can't read this one)"
  if (target.sticker) return '(sticker)'
  if (target.attachment) return '📷 image'
  if (target.text === '') return '(empty)'
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
    setError(err, () => deleteMessage(messageId))
  }
}

async function onRequestDelete(): Promise<void> {
  error.value = null
  try {
    await requestDeleteSession(props.id)
    renaming.value = false // close the rename panel; banner takes over
  } catch (err) {
    setError(err, () => requestDeleteSession(props.id))
  }
}

async function onCancelOrReject(): Promise<void> {
  error.value = null
  try {
    await cancelDeleteSession(props.id)
  } catch (err) {
    setError(err, () => cancelDeleteSession(props.id))
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
    setError(err, () => onAgreeDelete())
    deleting.value = false
  }
}

// Retry handler for the error-banner button. Pulls the stashed callback,
// clears the error eagerly, and invokes it. If the retry itself fails
// the called function re-sets the error (and possibly another retry
// closure), so the banner just refreshes — the user's next tap retries
// again. Bounded by their patience, not by us.
async function onRetry(): Promise<void> {
  const cb = error.value?.retry
  if (!cb) return
  error.value = null
  await cb()
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
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click.stop="menuOpen = !menuOpen"
      >
        <AppIcon name="more" :size="18" />
      </button>
      <!-- E2E badge upgraded from <span> to <button> — taps open a small
           popover explaining what end-to-end encryption actually guarantees,
           in plain language. Visual presentation is identical to the
           original .vw-badge-e2e (so the existing layout / color reads
           unchanged); only the semantics + tap target are new. -->
      <button
        type="button"
        class="vw-badge-e2e e2e-btn"
        :title="e2eExplainerOpen ? 'Close encryption info' : 'About encryption'"
        :aria-label="e2eExplainerOpen ? 'Close encryption info' : 'About end-to-end encryption'"
        :aria-expanded="e2eExplainerOpen"
        aria-haspopup="dialog"
        @click.stop="e2eExplainerOpen = !e2eExplainerOpen"
      >
        E2E
      </button>

      <div
        v-if="menuOpen"
        class="vw-popover header-menu"
        role="menu"
        aria-label="Session menu"
        @click.stop
      >
        <!-- Session-internal actions only. List-management (Pin / Archive)
             lives in the home row's per-row ⋯ menu, since those are about
             how the row sits in the home list rather than the chat itself.
             Each item carries a one-line description below the label —
             the audit revealed Hide and Request delete are novel concepts
             a first-timer can't infer from the label alone. -->
        <button
          type="button"
          class="vw-popover-item with-desc"
          role="menuitem"
          @click="onMenuRename"
        >
          <span class="popover-item-label">Rename</span>
          <span class="popover-item-desc">Give this chat a label only you see.</span>
        </button>
        <button
          type="button"
          class="vw-popover-item with-desc"
          role="menuitem"
          @click="onMenuToggleHide"
        >
          <span class="popover-item-label">{{
            sessionHidden ? 'Show messages' : 'Hide messages'
          }}</span>
          <span class="popover-item-desc">{{
            sessionHidden
              ? 'Bring the conversation back on this device.'
              : 'Empty the chat on this device only. Toggle again to restore.'
          }}</span>
        </button>
        <button
          v-if="deleteRequestState === 'none'"
          type="button"
          class="vw-popover-item with-desc danger"
          role="menuitem"
          @click="onMenuRequestDelete"
        >
          <span class="popover-item-label">Request delete</span>
          <span class="popover-item-desc">
            Asks the other party. Both must agree before history is wiped.
          </span>
        </button>
      </div>

      <!-- E2E explainer popover. Anchored to the header (position: relative
           via .chat-header) so it floats under the badge. Plain-language
           three liner: what is encrypted, who can read it, what the server
           sees. role="dialog" makes screen readers announce the surface
           as a discrete affordance rather than a wandered-into popover. -->
      <div
        v-if="e2eExplainerOpen"
        class="vw-popover e2e-popover"
        role="dialog"
        aria-label="About end-to-end encryption"
        @click.stop
      >
        <p class="e2e-explainer-line">
          <strong>End-to-end encrypted.</strong> Only you and the other person can read these
          messages.
        </p>
        <p class="e2e-explainer-line">
          The server only ever sees scrambled bytes. There's no way to recover messages once they
          vanish.
        </p>
      </div>
    </header>

    <ChatRenamePanel
      v-model:open="renaming"
      :session-id="props.id"
      :other-uid="opened?.otherParticipant ?? null"
      @error="(msg: string) => setError(new Error(msg))"
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

    <!-- Error banner. role="alert" + aria-live="assertive" makes screen
         readers announce failures the moment they surface. The retry button
         is shown only when the underlying error is retryable (network,
         transient Firestore codes) — permission-denied / not-found pass
         through with no retry button because tapping again won't help. -->
    <div
      v-if="error"
      class="error-banner"
      role="alert"
      aria-live="assertive"
    >
      <span class="error-banner-msg">{{ error.message }}</span>
      <button
        v-if="error.retry"
        type="button"
        class="error-banner-retry"
        :disabled="sending || sendingImage"
        @click="onRetry"
      >
        Retry
      </button>
      <button
        type="button"
        class="error-banner-dismiss"
        aria-label="Dismiss error"
        @click="error = null"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <!-- Visually hidden live region for screen-reader announcements.
         Currently used for incoming-message notifications; the live region
         pattern (off-screen text with aria-live="polite") lets the reader
         announce arrivals without interrupting whatever they were doing,
         and without painting anything sighted users have to see. -->
    <div class="sr-live" aria-live="polite" aria-atomic="true">{{ liveAnnouncement }}</div>

    <!-- Loading -->
    <div v-if="!opened && !error" class="chat-loading">
      <p style="font-size: 13px; color: var(--vw-text3)">Opening session…</p>
    </div>

    <!-- Messages -->
    <div v-else-if="opened" ref="messagesContainerRef" class="chat-messages" @scroll="onChatScroll">
      <div v-if="visibleMessages.length === 0" class="chat-empty">
        <img v-if="shhSticker" :src="shhSticker" alt="" class="chat-empty-sticker" />
        <p class="chat-empty-copy">Say something. It'll vanish soon enough.</p>
      </div>
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
         (backdrop or image) closes; Esc also closes via document keydown.
         role="dialog" + aria-modal makes screen readers announce it as a
         discrete modal surface rather than a wandered-into image. -->
    <Teleport to="body">
      <div
        v-if="lightboxUrl"
        class="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        @click="closeLightbox"
      >
        <img :src="lightboxUrl" class="lightbox-image" alt="" />
        <button type="button" class="lightbox-close" aria-label="Close" @click.stop="closeLightbox">
          <AppIcon name="close" :size="20" />
        </button>
      </div>
    </Teleport>

    <!-- Image preview overlay. Sits between file-picker resolve and the
         encrypted-send so the user confirms what they're about to send.
         Stops the universal "fat-finger attach → wrong image goes to a
         private chat" failure mode that read-and-vanish makes especially
         consequential (recipient may read + vanish before the unsend
         lands). Click outside cancels (same as lightbox); Esc cancels via
         the useDocumentDismiss handler. Send / Cancel buttons are at the
         bottom in the thumb zone for one-handed use. Teleport to body for
         the same stacking-context reason as the lightbox. -->
    <Teleport to="body">
      <div
        v-if="pendingImage"
        class="image-preview"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm image send"
        @click="cancelImageSend"
      >
        <img :src="pendingImage.url" class="image-preview-image" alt="Image preview" />
        <div class="image-preview-footer" @click.stop>
          <span class="image-preview-meta"
            >{{ formatFileSize(pendingImage.file.size) }} · ready to send</span
          >
          <div class="image-preview-actions">
            <button type="button" class="image-preview-cancel" @click="cancelImageSend">
              Cancel
            </button>
            <button
              type="button"
              class="image-preview-send"
              :disabled="sendingImage"
              @click="confirmImageSend"
            >
              {{ sendingImage ? 'Sending…' : 'Send' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- First-time vanish explainer. Renders as a non-blocking tooltip
         anchored to the bottom of the message area (right above the
         input bar) so it sits where the user's attention is and doesn't
         hijack the screen. Dismissed by tap × or sending the first
         message; persisted in localStorage so subsequent chat opens are
         clean. Aria-modal is intentionally NOT set: this is informational,
         not blocking. -->
    <div
      v-if="vanishOnboardingOpen && opened && !sessionHidden"
      class="vanish-onboard"
      role="status"
    >
      <p class="vanish-onboard-copy">
        First message starts the conversation. Each one disappears after the other person reads it.
      </p>
      <button
        type="button"
        class="vanish-onboard-dismiss"
        aria-label="Dismiss"
        @click="dismissVanishOnboarding"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

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
        @change="onFilePicked"
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
  /* Chat-specific atmospheric shift, layered top-to-bottom:
       (1) bottom-up radial — a soft warm purple glow rising from the
           input-bar level, like candlelight indoors. Mirrors body's
           top-down "moonlight" radial, so the metaphor flips from
           "scene lit by overhead sky" (home / settings) to "scene lit
           from where you're typing" (chat). The glow is intentionally
           subtle (12% peak) so the chat reads CALMER than home, not
           busier — the goal is "I entered a private room", not a
           visual fanfare.
       (2) base — slightly cooler / more purple than --vw-bg so even
           without the radial there's a tonal shift between home (flat
           --vw-bg) and chat. ~6% mix lands below "obviously different
           colour" but above "did anything change?" on a side-by-side. */
  background:
    radial-gradient(
      ellipse 70% 35% at 50% 100%,
      color-mix(in srgb, var(--vw-purple-mid) 12%, transparent) 0%,
      transparent 70%
    ),
    color-mix(in srgb, var(--vw-bg) 94%, var(--vw-purple-deep));
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
     in a 28px visual circle that matches the right-side menu button's
     density. Hit area is extended to 44×44 via ::before below (the visible
     chrome stays small, the tap surface meets PRODUCT.md's commitment). */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--vw-purple-light);
  text-decoration: none;
  flex-shrink: 0;
  /* Anchor for the hit-area pseudo. */
  position: relative;
  transition:
    color 0.15s,
    background 0.15s;
}
.back-btn::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
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
  /* Hit area extended to 44×44 via ::before — see .back-btn for rationale. */
  position: relative;
  transition:
    color 0.15s,
    background 0.15s;
}
.header-menu-btn::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
}
.header-menu-btn:hover {
  color: var(--vw-purple-pale);
  background: var(--vw-surface2);
}

/* Dropdown anchored to the bottom-right of the chat header; absolute
   inside .chat-header (which is position:relative). Sits in the
   --vw-z-dropdown slot of the theme's z-layer system. Surface chrome
   comes from .vw-popover in theme.css; this rule only carries the
   per-instance positioning, layout, and the slightly tighter 8px radius. */
.header-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 12px;
  /* Wider so each item can fit its label + one-line description without
     wrapping the description awkwardly on phone widths. */
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: var(--vw-z-dropdown);
  border-radius: 8px;
}

/* Menu items with descriptions. The .vw-popover-item default lays out as a
   single 13px line; this variant stacks a label over a smaller muted
   description so novel actions (Hide, Request delete) explain themselves
   in-place. Inherits the base hover + danger states from .vw-popover-item.
   The description is text2 (verified ≥4.5:1 on the popover surface) so AT
   users get the same context sighted users do. */
.vw-popover-item.with-desc {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
}
.popover-item-label {
  font-size: 13px;
  line-height: 1.2;
  color: inherit;
}
.popover-item-desc {
  font-size: 11px;
  line-height: 1.35;
  color: var(--vw-text2);
}
/* On danger items the description stays text2 (not danger-tinted) — the
   label itself is danger-colored already, and tinting the description
   red too made the whole row read as "something is wrong" rather than
   "this is a thoughtful, deliberate action". */
.vw-popover-item.danger .popover-item-desc {
  color: var(--vw-text2);
}

/* ── E2E badge → tap-target button ──
   Visually identical to the original .vw-badge-e2e span: same green-dim
   bg / green-strong text / green-deep border / 99px radius / 11px text.
   The .e2e-btn add-on strips browser button defaults and extends the hit
   area to 44 via ::before so the badge becomes an actual interactive
   surface without changing how it looks at rest. */
.e2e-btn {
  appearance: none;
  background: var(--vw-green-dim);
  color: var(--vw-green-strong);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.e2e-btn::before {
  content: '';
  position: absolute;
  inset: -10px -4px;
  border-radius: 99px;
}
.e2e-btn:hover {
  background: color-mix(in srgb, var(--vw-green-dim) 70%, var(--vw-green-strong));
}

/* E2E explainer popover. Anchored to the header (which is position:relative
   per the existing rule) so it floats just under the badge. Width is
   constrained on phones so the explainer doesn't span the whole viewport;
   wider than the header-menu because the copy is prose, not a list. */
.e2e-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 12px;
  /* Cap so the prose reads at a comfortable measure; min so it doesn't
     collapse below readable width on small phones. */
  width: min(280px, calc(100vw - 32px));
  padding: 12px 14px;
  z-index: var(--vw-z-dropdown);
  border-radius: 10px;
  border-color: var(--vw-green-deep);
  background: color-mix(in srgb, var(--vw-surface2) 92%, var(--vw-green-dim));
}
.e2e-explainer-line {
  font-size: 12px;
  line-height: 1.45;
  color: var(--vw-text);
  margin: 0;
}
.e2e-explainer-line + .e2e-explainer-line {
  margin-top: 8px;
}
.e2e-explainer-line strong {
  color: var(--vw-green-strong);
  font-weight: 600;
}

.chat-subtitle {
  font-size: 11px;
  color: var(--vw-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Chat empty state ──
   Mirrors HomeView's hero empty state pattern (sticker + copy stacked,
   centred in the open space) so the main feature surface gets the same
   brand treatment as the secondary list. The painted `shh` Whisp + a
   one-liner that connects directly to the vanish thesis replaces what
   used to be a bare "No messages yet — say hi." text line.

   Copy is set in Fraunces (display) at italic + a high SOFT axis
   value, picked deliberately:
     - Fraunces only otherwise appears in the splash wordmark and the
       chat header title — using it here too gives empty-state copy an
       editorial register that matches the "you're entering a private
       channel" mood, and reuses font-family the page already loaded.
     - 'opsz' 144 hits the largest optical-size (designed for display);
       'SOFT' 100 maxes out the painterly-serif axis so the line reads
       like a hand-painted aside, kin to the Whisp mascot's brushwork.
     - font-style: italic relies on Fraunces Variable's `ital` axis
       being included in `full.css` (loaded in main.ts). If a future
       Fontsource refactor strips italic, the browser falls through to
       synthetic italic — Fraunces is soft enough that it remains
       legible. */
.chat-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px 16px;
}
.chat-empty-sticker {
  /* clamp so the sticker breathes on tablet and stays modest on tiny
     phones (was a fixed 110px regardless of viewport). 96–128 keeps the
     range visually similar to the previous 110 default. */
  width: clamp(96px, 22vw, 128px);
  height: clamp(96px, 22vw, 128px);
  object-fit: contain;
  /* Slightly dimmed so the copy doesn't have to fight the painted
     mascot for attention — same treatment as HomeView's empty hero. */
  opacity: 0.78;
}
.chat-empty-copy {
  font-family: var(--vw-font-display);
  /* opsz matches the rendered size (16px). The previous 'opsz' 144 was
     designed for headline-scale rendering and rendering display strokes
     at body size dulled the SOFT painterly contribution. */
  font-variation-settings: 'opsz' 16, 'SOFT' 100, 'WONK' 0;
  font-style: italic;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.45;
  color: var(--vw-text2);
  text-align: center;
  max-width: 280px;
  margin: 0;
  letter-spacing: 0.005em;
}

/* ── Error banner ──
   Layout flips from "wall of red text" to "message + Retry + ×" — the
   message fills the row, Retry sits at the right (when the underlying
   error is retryable), Dismiss × pins all the way right. role="alert" on
   the wrapper announces immediately to screen readers; aria-live polite
   would have queued, which isn't what failures want. */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 16px;
  background: color-mix(in srgb, var(--vw-danger) 12%, transparent);
  border-bottom: 0.5px solid color-mix(in srgb, var(--vw-danger) 30%, transparent);
  font-size: 12px;
  color: var(--vw-danger);
  flex-shrink: 0;
}
.error-banner-msg {
  flex: 1;
  min-width: 0;
  line-height: 1.4;
}
.error-banner-retry {
  flex-shrink: 0;
  appearance: none;
  background: var(--vw-danger);
  border: none;
  border-radius: 99px;
  padding: 4px 12px;
  color: var(--vw-purple-pale);
  font: inherit;
  font-weight: 500;
  font-size: 11px;
  cursor: pointer;
  position: relative;
  transition:
    background 0.15s,
    opacity 0.15s;
}
/* Hit area expanded to ≥44 tall — same pattern as the rest of the chat
   buttons; visible chrome stays small so the banner doesn't dominate. */
.error-banner-retry::before {
  content: '';
  position: absolute;
  inset: -10px -4px;
  border-radius: 99px;
}
.error-banner-retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error-banner-retry:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vw-danger) 80%, var(--vw-purple-deep));
}
.error-banner-dismiss {
  flex-shrink: 0;
  appearance: none;
  background: none;
  border: none;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--vw-danger);
  cursor: pointer;
  position: relative;
  opacity: 0.7;
  transition: opacity 0.15s;
}
.error-banner-dismiss::before {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: 50%;
}
.error-banner-dismiss:hover {
  opacity: 1;
}

/* Visually-hidden live region. Standard sr-only pattern. */
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
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
  /* Hit area extended to 44×44 via ::before — see .back-btn for rationale.
     Two attach buttons sit adjacent with gap:8px; expanding each side by
     6px leaves a 4px hit overlap in the gap. CSS hit-testing falls to
     the DOM-later element there, which is acceptable: the user's intent
     between two near-identical attach actions is rarely the boundary px. */
  position: relative;
  transition:
    color 0.15s,
    background 0.15s;
}
.attach-btn::before {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
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
  /* Lightbox backdrop is the deepest app surface itself rather than a
     mix into raw black — keeps the overlay on-palette and avoids a
     hardcoded hex in component CSS (CLAUDE.md token discipline).
     --vw-bg #0D0A14 is already near-black, so the visual effect is
     identical to the previous 96/4 mix with #000. */
  background: var(--vw-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--vw-z-modal);
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
/* Hit area extended to 44×44 via ::before — see .back-btn for rationale.
   The lightbox-close sits alone in the top-right corner so the expanded
   area never overlaps another control. */
.lightbox-close::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}
.lightbox-close:hover {
  background: color-mix(in srgb, var(--vw-text) 20%, transparent);
}

/* ── Image preview overlay ──
   Sits between file-pick and encrypted-send. Visual lineage from the
   lightbox (same near-bg backdrop, same center-stage image presentation)
   so users coming from the bubble-tap-lightbox flow recognize the shape
   instantly. Footer adds two buttons + size meta — same thumb-zone
   placement as the input bar. role="dialog" + aria-modal on the wrapper
   in the template. */
.image-preview {
  position: fixed;
  inset: 0;
  background: var(--vw-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: var(--vw-z-modal);
  padding: 20px 20px 0;
  animation: lightbox-fade 0.12s ease-out;
}
.image-preview-image {
  /* Cap height so the footer always has room without scroll. The 70vh
     leaves ~120px for the footer + safe-area + breathing — more headroom
     than the lightbox needs because we have a row of controls under it. */
  max-width: 95vw;
  max-height: 70vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
}
.image-preview-footer {
  width: min(420px, 100%);
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Bottom safe-area padding so the footer doesn't fight the iOS home
     indicator on phones with no physical home button. */
  padding-bottom: calc(20px + env(safe-area-inset-bottom));
}
.image-preview-meta {
  font-size: 11px;
  color: var(--vw-text3);
  text-align: center;
  font-family: var(--vw-font-mono);
  letter-spacing: 0.04em;
}
.image-preview-actions {
  display: flex;
  gap: 10px;
  justify-content: stretch;
}
.image-preview-cancel,
.image-preview-send {
  flex: 1;
  appearance: none;
  border: none;
  border-radius: 10px;
  /* 14px vertical lands the visual button at ~44 tall, no ::before needed
     because these are the only two controls in the row and they own the
     full footer width. */
  padding: 14px 16px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.image-preview-cancel {
  background: none;
  color: var(--vw-text);
  border: 0.5px solid var(--vw-border2);
}
.image-preview-cancel:hover {
  background: var(--vw-surface2);
  border-color: var(--vw-purple-mid);
}
.image-preview-send {
  background: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.image-preview-send:hover:not(:disabled) {
  background: var(--vw-purple-mid);
}
.image-preview-send:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── First-time vanish explainer ──
   Floats above the input bar (not inside it) so it doesn't fight the
   composer for attention but stays in the same visual zone where the
   user's eye lands after sending the first message. Auto-dismisses on
   first sent message (the act of sending IS the moment vanish becomes
   self-explanatory). Soft surface treatment so it reads as a hint, not
   an alert — role="status" semantically (template), color/contrast
   semantically. */
.vanish-onboard {
  /* Pin above the input bar in document order — Vue renders this before
     the input-bar form, so flex-direction: column places it above. The
     margin-block-end + softer padding keeps it visually separate from
     both the chat scroll above and the input bar below. */
  flex-shrink: 0;
  margin: 0 12px 8px;
  padding: 10px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: color-mix(in srgb, var(--vw-purple-mid) 14%, var(--vw-surface2));
  border: 0.5px solid var(--vw-border2);
  border-radius: 10px;
  /* Soft entrance — sits in the page from first paint, but the brief
     fade-in keeps the first-mount transition from feeling hard. */
  animation: vanish-onboard-fade 0.24s ease-out;
}
@keyframes vanish-onboard-fade {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vanish-onboard {
    animation: none;
  }
}
.vanish-onboard-copy {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--vw-text);
}
.vanish-onboard-dismiss {
  flex-shrink: 0;
  appearance: none;
  background: none;
  border: none;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--vw-text3);
  cursor: pointer;
  position: relative;
  transition: color 0.15s;
}
.vanish-onboard-dismiss::before {
  content: '';
  position: absolute;
  inset: -12px;
  border-radius: 50%;
}
.vanish-onboard-dismiss:hover {
  color: var(--vw-purple-pale);
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
