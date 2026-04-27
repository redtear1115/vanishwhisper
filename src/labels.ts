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

// Derives the two-line session display: when a label is set, the friendly
// name promotes to `primary` and the UID-derived fallback drops to `secondary`
// so the underlying identifiers always remain visible (request from the
// user — labels don't *replace* the IDs, they *augment* them).
export function sessionDisplay(
  labels: Map<string, SessionLabel>,
  sessionId: string,
  otherUid: string,
  opts: { sessionShortLen?: number; otherShortLen?: number } = {},
): SessionDisplay {
  const sessionLen = opts.sessionShortLen ?? 14
  const otherLen = opts.otherShortLen ?? 12
  const lbl = labels.get(sessionId)
  const sessionShort = `${sessionId.slice(0, sessionLen)}…`
  const otherShort = `${otherUid.slice(0, otherLen)}…`
  const primary = lbl?.sessionName ?? sessionShort
  const parts: string[] = []
  // If the title is the friendly name, surface the underlying session id in
  // the secondary line. (If no name, the id is already the title — don't
  // duplicate.)
  if (lbl?.sessionName) parts.push(sessionShort)
  // Always include the other-party segment. If the user has named them,
  // append the UID-fingerprint so identity is still verifiable at a glance.
  parts.push(lbl?.otherName ? `with ${lbl.otherName} · ${otherShort}` : `with ${otherShort}`)
  return { primary, secondary: parts.join(' · ') }
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
