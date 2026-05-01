// Auto-scroll behaviour for the chat message list. Keeps the scroll
// pinned to the bottom when the user is already there (so newly arrived
// messages stay visible without manual scroll), but leaves their
// position alone if they've scrolled up to read older history. Resumes
// sticking the moment they scroll back down.
//
// Sending a message also forces stick-to-bottom because the user
// clearly wants to see what they just sent — callers expose this via
// `forceStick()` and call it from their send handlers.
//
// `stickToBottom` is intentionally a plain `let` rather than a ref:
// nothing in the template reads it (only the internal watch does), so
// reactivity would just add overhead. The exposed API is `onScroll`
// (handler) + `forceStick()` (imperative) + `messagesContainerRef`
// (template binding AND for parent code that needs to querySelector
// inside the scroll viewport, e.g. jumpToReply).
//
// The watch is owned here so the composable's "I'm responsible for
// keeping the scroll position right" invariant doesn't depend on the
// caller remembering to wire it up. Caller passes the reactive source
// to watch — typically a computed of the visible message list.

import { nextTick, ref, watch, type Ref, type WatchSource } from 'vue'

export interface UseChatScrollReturn {
  messagesContainerRef: Ref<HTMLElement | null>
  onScroll: () => void
  forceStick: () => void
}

export function useChatScroll(source: WatchSource): UseChatScrollReturn {
  const messagesContainerRef = ref<HTMLElement | null>(null)
  let stickToBottom = true

  function isNearBottom(): boolean {
    const el = messagesContainerRef.value
    if (!el) return true
    // px — counts as "at bottom" if within this gap. 80px chosen so a
    // user who's mid-paragraph but near the end still gets new messages
    // auto-scrolled in, while someone reading an older message ~one
    // viewport up doesn't have their position yanked.
    const slack = 80
    return el.scrollTop + el.clientHeight >= el.scrollHeight - slack
  }

  function scrollToBottom(): void {
    const el = messagesContainerRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  function onScroll(): void {
    stickToBottom = isNearBottom()
  }

  function forceStick(): void {
    stickToBottom = true
  }

  // Pin to bottom whenever the watched source changes if the user is
  // sticking. nextTick lets Vue paint first so scrollHeight reflects
  // the new content. Initial mount counts: source typically goes [] →
  // first batch, which triggers this watcher and scrolls to the latest
  // immediately on chat open.
  watch(source, async () => {
    if (!stickToBottom) return
    await nextTick()
    scrollToBottom()
  })

  return { messagesContainerRef, onScroll, forceStick }
}
