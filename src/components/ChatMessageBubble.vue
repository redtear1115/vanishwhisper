<script setup lang="ts">
// One row in the chat message list — quote strip + bubble + (optional)
// shared progress line + meta + reactions row. Extracted from
// ChatSessionView so the chat view itself only owns cross-message state
// (group boundaries, "only one picker open at a time", vanish cache).
//
// Props are deliberately pre-derived in the parent: vanishLabel /
// progressStyle / isLastOfGroup all depend on the surrounding message
// list, and computing them here would either duplicate work the parent
// already does (group detection compares vanishLabel of THIS to NEXT) or
// require passing the whole list down. Cheap props out of a parent loop
// is the simpler boundary.
//
// `data-mid` lives on the root element so the parent's jumpToReply can
// querySelector('[data-mid="…"]') without knowing about this component.
import { stickerUrl } from '../stickers'
import type { ChatMessageRow } from '../messages'

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const props = defineProps<{
  message: ChatMessageRow
  myUid: string
  isLastOfGroup: boolean
  showProgress: boolean
  // Stable object identity across renders (parent caches by messageId+readAt)
  // so the inline :style binding doesn't restart the keyframe each tick.
  progressStyle: Record<string, string>
  vanishLabel: string
  pulse: boolean
  pickerOpen: boolean
  // Pre-resolved by the parent — undefined when the original has been
  // cascade-deleted / never existed; deletedAt-set when vanished. The
  // snippet covers both cases so we don't need to re-derive here.
  replyTarget: ChatMessageRow | undefined
  replySnippet: string
}>()

const emit = defineEmits<{
  delete: []
  react: [emoji: string, hasMine: boolean]
  reply: []
  pickerOpen: []
  jump: [replyId: string]
  lightbox: [url: string]
}>()

function iReacted(emoji: string): boolean {
  return props.message.reactions[emoji]?.includes(props.myUid) ?? false
}

function reactionCount(emoji: string): number {
  return props.message.reactions[emoji]?.length ?? 0
}
</script>

<template>
  <div
    :data-mid="message.id"
    class="msg-row"
    :class="[
      message.fromMe ? 'msg-me' : 'msg-them',
      isLastOfGroup ? 'group-end' : 'group-mid',
      { pulse },
    ]"
  >
    <!-- Quote strip — appears above the bubble whenever this message
         replies to another. Clicking jumps to and pulses the original.
         Renders even if the target has vanished (snippet helper shows
         the placeholder), so the conversational thread is preserved
         visually even after the original disappears. Pure typographic
         treatment: indent + thin border-left + muted text colour. No
         icon prefix — the indented quote-block convention reads as
         "quoted text" without a glyph. -->
    <button
      v-if="message.replyTo"
      type="button"
      class="reply-jump"
      :title="replyTarget ? 'Jump to original' : 'Original message has vanished'"
      @click.stop="emit('jump', message.replyTo)"
    >
      <span class="reply-jump-snippet">{{ replySnippet }}</span>
    </button>

    <!-- Bubble. Unsend lives inside the bubble as a hover affordance so
         even mid-group messages can be unsent — the shared meta row
         below carries no per-message controls. Sticker / image / text
         are mutually exclusive in the UI (the input bar offers them via
         separate paths), so v-else-if down the chain. -->
    <div
      class="msg-bubble"
      :class="[
        message.fromMe ? 'vw-bubble-me' : 'vw-bubble-them',
        { 'has-image': message.attachment, 'has-sticker': message.sticker },
      ]"
    >
      <!-- Reply trigger — inbound bubbles only. Quoting your own
           outbound message is intentionally not offered: the action is
           about responding to the OTHER party's text, and exposing it
           on outbound bubbles clutters the hover cluster without a
           real use case in a 2-party chat. Hover-revealed on the
           OPPOSITE side from react/unsend so the two don't collide. -->
      <button
        v-if="!message.fromMe"
        class="bubble-reply"
        type="button"
        title="Reply"
        @click.stop="emit('reply')"
      >↩</button>
      <template v-if="message.sticker">
        <img
          v-if="stickerUrl(message.sticker)"
          :src="stickerUrl(message.sticker)!"
          class="msg-sticker"
          alt=""
        />
        <span v-else class="decrypt-err">[unknown sticker: {{ message.sticker }}]</span>
      </template>
      <img
        v-else-if="message.attachment?.blobUrl"
        :src="message.attachment.blobUrl"
        :width="message.attachment.width"
        :height="message.attachment.height"
        class="msg-image"
        alt=""
        @click.stop="emit('lightbox', message.attachment!.blobUrl!)"
      />
      <span v-else-if="message.attachment" class="decrypt-err">[unable to decrypt image]</span>
      <span v-if="message.text">{{ message.text }}</span>
      <span v-else-if="message.text === null" class="decrypt-err">[unable to decrypt]</span>
      <button
        v-if="message.fromMe"
        class="bubble-delete"
        type="button"
        title="Unsend"
        @click.stop="emit('delete')"
      >×</button>
      <!-- Reaction picker trigger — only on inbound messages, hover-revealed
           like the unsend button. Stops propagation so the document
           click-outside handler doesn't immediately re-close the picker. -->
      <button
        v-if="!message.fromMe"
        class="bubble-react"
        type="button"
        title="React"
        @click.stop="emit('pickerOpen')"
      >+</button>
    </div>

    <!-- Shared progress line + meta row — only on the LAST message of a
         grouped run. Same-bucket adjacent messages from the same sender
         collapse into one visual indicator instead of N. -->
    <div v-if="isLastOfGroup && showProgress" class="msg-progress">
      <div class="msg-progress-fill" :style="progressStyle" />
    </div>
    <div v-if="isLastOfGroup" class="msg-meta">
      <span class="msg-time">{{ message.createdAt?.toLocaleTimeString() ?? '…' }}</span>
      <span class="vw-pill" :class="{ 'vw-pill--live': message.readAt }">{{ vanishLabel }}</span>
    </div>

    <!-- Reactions row — existing pills always visible (with counts). The
         picker (extra emoji choices) is opened from the bubble's hover
         "+" button, not from the row itself. .stop on each pill so a
         toggle doesn't bubble out and trigger the click-outside close. -->
    <div class="reactions-row">
      <button
        v-for="emoji in REACTION_EMOJIS"
        v-show="reactionCount(emoji) > 0 || (!message.fromMe && pickerOpen)"
        :key="emoji"
        type="button"
        class="reaction-pill"
        :class="{ mine: iReacted(emoji) }"
        @click.stop="emit('react', emoji, iReacted(emoji))"
      >
        {{ emoji }}<span v-if="reactionCount(emoji) > 0" class="reaction-count"> {{ reactionCount(emoji) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
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
   (= NEGATIVE elapsed since readAt) come from progressStyle inline (parent
   caches by messageId+readAt for stable object identity), so the browser
   drives the animation on the compositor without per-second JS updates.
   The line spans the whole message-row column (75% viewport max) rather
   than fitting the bubble; it reads as a divider between bubble and meta
   as well as a countdown indicator. */
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

/* ── Reply / quote ──
   Two pieces work together here (the third — the input-bar reply chip —
   lives in the parent):
   (1) `.bubble-reply` — hover-revealed ↩ on the OPPOSITE corner from
       delete/react, sized identically so the clusters look uniform.
   (2) `.reply-jump` — quote strip above a bubble that itself replies to
       another message. Click → emit('jump'), parent smooth-scrolls and
       pulses the original.

   The pulse keyframe applies a brief outline ring on the bubble inside the
   target row when the parent toggles `pulse`; the ring uses box-shadow
   rather than background-color so it composes cleanly with the bubble's
   own purple/dark fill instead of overriding it. */
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

/* Quote strip — pure typographic treatment. A 2px left rule + a small
   indent + secondary text colour reads as "this is quoted" without any
   icon or chip background, matching how indented-quote blocks work in
   prose. Hover brightens the rule so the click affordance is still
   discoverable. The strip mirrors to the right edge for outbound rows
   so the rule visually "points at" the bubble below it. */
.reply-jump {
  background: none;
  border: none;
  border-left: 2px solid var(--vw-border2);
  border-radius: 0;
  padding: 1px 0 1px 8px;
  max-width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: block;
  transition: border-color 0.15s, color 0.15s;
}
.reply-jump:hover { border-left-color: var(--vw-purple-light); }
.msg-me .reply-jump {
  border-left: none;
  border-right: 2px solid var(--vw-border2);
  padding: 1px 8px 1px 0;
  text-align: right;
}
.msg-me .reply-jump:hover { border-right-color: var(--vw-purple-light); }
.reply-jump-snippet {
  display: block;
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
</style>
