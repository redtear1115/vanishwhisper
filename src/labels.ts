import { ref, type Ref } from 'vue'
import { openIdb } from './idb'

// Per-session display labels — local-only. Both fields are optional so
// callers can rename one without clearing the other. Names never reach
// Firestore: they live exclusively in this user's IndexedDB, which keeps
// the no-PII-on-the-server rule intact (see CLAUDE.md "Auth & key management").
export interface SessionLabel {
  sessionName?: string
  otherName?: string
}

interface LabelRow extends SessionLabel {
  sessionId: string
}

const IDB_STORE = 'labels'

const labelsRef = ref(new Map<string, SessionLabel>())
let initPromise: Promise<void> | null = null

export function useLabels(): { labels: Ref<Map<string, SessionLabel>> } {
  if (!initPromise) initPromise = init()
  return { labels: labelsRef }
}

// Sync getter for non-component callers — assumes useLabels() has been
// called at least once (it is, on the home view + chat view mount paths).
export function getLabel(sessionId: string): SessionLabel | undefined {
  return labelsRef.value.get(sessionId)
}

export async function setLabel(sessionId: string, label: SessionLabel): Promise<void> {
  if (!initPromise) initPromise = init()
  await initPromise

  const cleaned: SessionLabel = {}
  const sn = label.sessionName?.trim()
  const on = label.otherName?.trim()
  if (sn) cleaned.sessionName = sn
  if (on) cleaned.otherName = on

  const db = await openIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    if (Object.keys(cleaned).length === 0) {
      // Both fields blank — drop the row entirely so the UI falls back to
      // UID-derived defaults rather than carrying around an empty record.
      tx.objectStore(IDB_STORE).delete(sessionId)
    } else {
      const row: LabelRow = { sessionId, ...cleaned }
      tx.objectStore(IDB_STORE).put(row)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  // Reassign Map so Vue sees the change — `set`/`delete` on a reactive Map
  // works in Vue 3 but reassignment is the most defensive across Vue versions
  // and avoids a class of edge cases with computed dependencies.
  const next = new Map(labelsRef.value)
  if (Object.keys(cleaned).length === 0) next.delete(sessionId)
  else next.set(sessionId, cleaned)
  labelsRef.value = next
}

async function init(): Promise<void> {
  const db = await openIdb()
  const rows = await new Promise<LabelRow[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => resolve(req.result as LabelRow[])
    req.onerror = () => reject(req.error)
  })
  const map = new Map<string, SessionLabel>()
  for (const row of rows) {
    const { sessionId, ...rest } = row
    map.set(sessionId, rest)
  }
  labelsRef.value = map
}

// ----- Display helpers (label-aware, UID fallback) -----

export interface SessionDisplay {
  primary: string
  secondary: string
}

// Two-line session display for the chat header AND home list. Session id is
// treated as an internal Firestore key and never surfaces here — labels are
// edited in the chat's rename panel where the underlying ids are shown as
// info text for power-user verification. Other-party identity DOES surface
// (label or truncated UID) because that's "who you're talking to".
//
// Behaviour:
//   neither label set         → `Chat with d71Y…wLm8` / (no subtitle)
//   sessionName only          → `My Chat`             / `with d71Y…wLm8`
//   otherName only            → `Chat with Mann`      / (no subtitle)
//   both labels               → `My Chat`             / `with Mann`
//
// Earlier iteration (pre-2026-04) tried to "augment never replace" by piling
// the truncated session id and uid into the subtitle on every row. That made
// labelled sessions HARDER to read than unlabelled ones — three pieces of
// identity (sessionId · with X · otherUid) crammed into one line. Now labels
// REPLACE in display surfaces and the underlying ids live exclusively in the
// rename panel.
export function sessionDisplay(
  labels: Map<string, SessionLabel>,
  sessionId: string,
  otherUid: string,
  opts: { otherShortLen?: number } = {},
): SessionDisplay {
  const otherLen = opts.otherShortLen ?? 12
  const lbl = labels.get(sessionId)
  const otherDisplay = lbl?.otherName ?? `${otherUid.slice(0, otherLen)}…`
  // Title falls back to "Chat with X" rather than the session id — matches
  // chat-app convention (WhatsApp / iMessage / Signal: the chat IS the
  // contact, no separate "session name" concept). Subtitle only appears
  // when sessionName takes the title slot, to clarify who the chat is with.
  const primary = lbl?.sessionName ?? `Chat with ${otherDisplay}`
  const secondary = lbl?.sessionName ? `with ${otherDisplay}` : ''
  return { primary, secondary }
}

// Per-contact avatar colour — hash the *other party's* UID into a small
// palette so each contact gets a stable colour across sessions and across
// reloads, but adjacent rows in the home list aren't all the same shade.
// Two schemes (purple / green) keep us on-brand without inventing new colours.
export function avatarScheme(uid: string): 'purple' | 'green' {
  let h = 0
  for (let i = 0; i < uid.length; i++) {
    h = ((h << 5) - h + uid.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 2 === 0 ? 'purple' : 'green'
}

export function avatarInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}
