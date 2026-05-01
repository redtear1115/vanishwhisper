// Read-and-vanish math + the per-second tick that drives it. Extracted
// from ChatSessionView so the chat view itself stays focused on layout
// and data plumbing — this file owns:
//
//   - The 1-Hz `now` ref (reactive clock; ANY computed that calls one of
//     the helpers below re-evaluates on tick because the helpers read it
//     during the call, registering the dep against the tracker).
//   - Bucketed `vanishLabel` text (CEIL-rounded so the first label after
//     readAt matches the user's configured value — see the long comment
//     on the function).
//   - `progressStyle` for the CSS-driven depletion line, memoised by
//     (messageId, readAt) so the inline :style binding keeps a stable
//     object identity across renders and the keyframe never restarts.
//   - The auto-firing `markDeleted` side effect when an inbound message
//     crosses its vanish line — caller doesn't have to plumb it.
//
// Caller stays responsible for:
//   - Subscribing to both parties' DeletedInMinutes (the Refs come in as
//     props so this composable doesn't need to know about Firestore subs
//     or how errors should surface in the host view).
//   - Filtering vanished messages out of the rendered list — we expose
//     `isVanished()` so the caller can compose its own visible list with
//     whatever extra rules apply (e.g. session-hidden in the chat view).
//   - Group-boundary detection — `vanishLabel` is exported so callers
//     can compare adjacent labels themselves; the grouping rule depends
//     on the surrounding list which is the caller's domain.
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { markDeleted, type ChatMessageRow } from './messages'

export interface UseVanishOptions {
  // Unfiltered message list — the tick walks this to fire markDeleted on
  // inbound messages whose vanish window has elapsed. Pass the same Ref
  // your subscribeMessages handler writes to, NOT a derived visible list
  // (filtering vanished items out of the input would short-circuit the
  // cleanup pass that triggers their actual deletion).
  messages: Ref<ChatMessageRow[]>
  // My DeletedInMinutes (controls how long OUTBOUND messages stay alive
  // after the recipient reads them — they vanish using the recipient's
  // window, which from outbound's POV is `otherMinutes`).
  myMinutes: Ref<number | null>
  // The other party's DeletedInMinutes (controls how long INBOUND
  // messages stay alive after I read them — my window).
  otherMinutes: Ref<number | null>
}

export function useVanish(opts: UseVanishOptions) {
  const now = ref(Date.now())
  // markDeleted dedup across timer ticks. Cleared on subsequent failure
  // so a transient network blip doesn't permanently lock out a retry.
  const deletedFired = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null

  function vanishAtMs(m: ChatMessageRow): number | null {
    if (!m.readAt) return null
    const minutes = m.fromMe ? opts.otherMinutes.value : opts.myMinutes.value
    if (minutes === null) return null
    return m.readAt.getTime() + minutes * 60_000
  }

  function isVanished(m: ChatMessageRow, atMs: number = now.value): boolean {
    if (m.deletedAt) return true
    const at = vanishAtMs(m)
    return at !== null && atMs >= at
  }

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
  // stable across re-renders — the inline style only "changes" the moment
  // readAt transitions null → set, and the keyframe runs uninterrupted from
  // that point. The cache is composable-instance-local so a remount (navigate
  // away and back) recomputes elapsed against the current Date.now(),
  // avoiding stale offsets.
  const progressStyleCache = new Map<
    string,
    { animationDuration: string; animationDelay: string }
  >()

  function progressStyle(m: ChatMessageRow): Record<string, string> {
    if (!m.readAt) return { display: 'none' }
    const minutes = m.fromMe ? opts.otherMinutes.value : opts.myMinutes.value
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
    return Boolean(m.readAt) && !isVanished(m)
  }

  // When either side's vanish window updates, blow away the progress-line
  // cache so existing messages recompute their CSS animation duration. The
  // cache is keyed by (messageId, readAt) which doesn't include minutes, so
  // without this the in-flight animation would keep its original duration
  // even after Vue re-renders the inline style.
  watch([opts.myMinutes, opts.otherMinutes], () => {
    progressStyleCache.clear()
  })

  function tickVanish(): void {
    for (const m of opts.messages.value) {
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

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now()
      tickVanish()
    }, 1000)
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  return { isVanished, vanishLabel, progressStyle, showProgress }
}
