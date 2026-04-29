import { ref, type Ref } from 'vue'
import { withIdb } from './idb'

// Per-session local state. Local-only: nothing here ever reaches Firestore.
// Carries both user-set labels (sessionName, otherName) and system bookkeeping
// (state for pin/archive, lastSeenAt for the unread indicator) — single
// IndexedDB row keyed by sessionId so we don't fan out into multiple stores.
export interface SessionLabel {
  sessionName?: string
  otherName?: string
  // 'pinned' floats to the top of the home list with a ★ marker;
  // 'archived' is hidden from the default home list (visible in the
  // collapsible Archived section, OR auto-surfaced if the OTHER party
  // has a pending mutual-delete request — see HomeView).
  state?: 'pinned' | 'archived'
  // Local epoch ms timestamp written on chat mount/unmount. Combined with
  // session.LastMessageBy + UpdatedAt this drives the home unread dot:
  // unread = LastMessageBy is the OTHER party AND UpdatedAt > lastSeenAt.
  lastSeenAt?: number
  // Per-session client-side hide. When true: chat view renders the same
  // empty-state placeholder as a brand-new session (no message rows, no
  // input bar) AND ackUnread is suppressed so incoming messages don't get
  // ReadAt — vanish stays paused until the user toggles back to visible.
  // Visually indistinguishable from an empty conversation, by design (the
  // user wants plausible deniability if someone glances at the screen).
  // Independent of state (pinned/archived) so you can pin AND hide.
  hidden?: boolean
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

// Public APIs are split by concern even though they share one IDB store —
// setLabel for user names, setSessionState for pin/archive, markVisited for
// the unread bookkeeping. Each one is a partial-merge update that preserves
// the other fields, so renaming a session doesn't blow away its pinned
// state and so on.

export async function setLabel(
  sessionId: string,
  label: { sessionName?: string; otherName?: string },
): Promise<void> {
  await mergePrefs(sessionId, (current) => {
    const next: SessionLabel = { ...current }
    const sn = label.sessionName?.trim()
    const on = label.otherName?.trim()
    if (sn) next.sessionName = sn
    else delete next.sessionName
    if (on) next.otherName = on
    else delete next.otherName
    return next
  })
}

export async function setSessionState(
  sessionId: string,
  state: 'pinned' | 'archived' | undefined,
): Promise<void> {
  await mergePrefs(sessionId, (current) => {
    const next: SessionLabel = { ...current }
    if (state) next.state = state
    else delete next.state
    return next
  })
}

export async function markVisited(sessionId: string): Promise<void> {
  await mergePrefs(sessionId, (current) => ({ ...current, lastSeenAt: Date.now() }))
}

export async function setHidden(sessionId: string, hidden: boolean): Promise<void> {
  await mergePrefs(sessionId, (current) => {
    const next: SessionLabel = { ...current }
    if (hidden) next.hidden = true
    else delete next.hidden
    return next
  })
}

// Phase 2.17 — migration export/import. The migration channel hybrid-
// encrypts the snapshot returned by exportLabels() with the new device's
// RSA public key, ships it through Firestore as ciphertext, and the new
// device feeds the decrypted snapshot to importLabels() on first sight.
//
// labels are still IDB-only end-to-end: the threat-model rule "labels
// don't reach Firestore in plaintext" holds — the wire format the server
// sees is opaque ciphertext, same trust level as RSA-wrapped session keys.

export interface LabelExport extends SessionLabel {
  sessionId: string
}

// Snapshot every label currently in IDB. Awaits initial IDB load so a
// fresh process that immediately calls export doesn't see an empty Map.
export async function exportLabels(): Promise<LabelExport[]> {
  if (!initPromise) initPromise = init()
  await initPromise
  const out: LabelExport[] = []
  for (const [sessionId, label] of labelsRef.value) {
    out.push({ sessionId, ...label })
  }
  return out
}

// Bulk write imported labels. Per-row OVERWRITE semantics (any pre-
// existing label for the same sessionId is replaced) — for the active
// hand-off use case, the new device shouldn't have prior labels for a
// migrated session anyway, since the sessionId only enters its world
// after the slot swap. Each row goes through mergePrefs to keep the
// reactive Map in sync with IDB.
export async function importLabels(rows: LabelExport[]): Promise<void> {
  for (const row of rows) {
    const { sessionId, ...fields } = row
    await mergePrefs(sessionId, () => ({ ...fields }))
  }
}

// Read-merge-write inside one IDB transaction so concurrent calls for the
// same session don't lose updates (mount fires markVisited at the same
// moment a Pin click fires setSessionState — both should land). Drops the
// row entirely when the merged record has no meaningful fields, so unused
// sessions don't accumulate empty IDB rows.
async function mergePrefs(
  sessionId: string,
  merge: (current: SessionLabel) => SessionLabel,
): Promise<void> {
  if (!initPromise) initPromise = init()
  await initPromise

  await withIdb(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        const getReq = store.get(sessionId)
        getReq.onsuccess = () => {
          const existing = getReq.result as LabelRow | undefined
          const { sessionId: _ignored, ...currentFields } = existing ?? {
            sessionId,
          }
          void _ignored
          const merged = merge(currentFields)
          if (isEmpty(merged)) {
            store.delete(sessionId)
          } else {
            store.put({ sessionId, ...merged })
          }
        }
        getReq.onerror = () => reject(getReq.error)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )

  // Reassign the reactive Map so Vue diffs see the change.
  const next = new Map(labelsRef.value)
  const current = next.get(sessionId) ?? {}
  const merged = merge(current)
  if (isEmpty(merged)) next.delete(sessionId)
  else next.set(sessionId, merged)
  labelsRef.value = next
}

function isEmpty(label: SessionLabel): boolean {
  return (
    !label.sessionName &&
    !label.otherName &&
    !label.state &&
    !label.hidden &&
    label.lastSeenAt === undefined
  )
}

async function init(): Promise<void> {
  const rows = await withIdb(
    (db) =>
      new Promise<LabelRow[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).getAll()
        req.onsuccess = () => resolve(req.result as LabelRow[])
        req.onerror = () => reject(req.error)
      }),
  )
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
