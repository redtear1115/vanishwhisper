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
