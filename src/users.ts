import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

// Cached because per-message vanish countdowns read this constantly. The value
// is per-user-doc and changes only when the user edits their settings, so a
// process-lifetime cache is fine for now: setDeletedInMinutes() updates the
// cache for the writer in-place, and the chat view re-fetches both sides on
// each mount, so navigating away and back picks up the latest value. We
// deliberately don't subscribe to Users docs — that would mean a snapshot
// listener per open chat per participant just to catch a setting that
// changes a few times in a session's lifetime.
const cache = new Map<string, number>()

export async function getDeletedInMinutes(uid: string): Promise<number> {
  const cached = cache.get(uid)
  if (cached !== undefined) return cached
  const snap = await getDoc(doc(db, 'Users', uid))
  if (!snap.exists()) throw new Error(`User ${uid} not found.`)
  const minutes = snap.get('DeletedInMinutes') as number | undefined
  if (typeof minutes !== 'number') {
    throw new Error(`User ${uid} has no DeletedInMinutes.`)
  }
  cache.set(uid, minutes)
  return minutes
}

export async function setDeletedInMinutes(uid: string, minutes: number): Promise<void> {
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new Error('DeletedInMinutes must be a positive number.')
  }
  const rounded = Math.floor(minutes)
  await updateDoc(doc(db, 'Users', uid), {
    DeletedInMinutes: rounded,
    UpdatedAt: serverTimestamp(),
  })
  cache.set(uid, rounded)
}
