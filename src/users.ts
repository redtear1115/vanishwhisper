import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

// One-shot cache for the Profile page (which reads-then-writes on mount).
// The chat view doesn't go through this — it uses subscribeDeletedInMinutes()
// below so it picks up the OTHER party's edits live, not just on remount.
// setDeletedInMinutes() and the subscription both seed this cache so any
// future getDeletedInMinutes() call returns the latest known value.
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

// Subscribe to a user's DeletedInMinutes. The chat view uses this for both
// participants so that when the other party edits their vanish window via
// the Profile page, our open chat picks up the new value live — without
// this, the cache stays stuck at the value loaded on chat mount and we'd
// keep rendering "vanishes in 1h" for messages that should be 5 min away.
// Cost: one listener per participant per open chat (so 2 per chat). The
// setting changes rarely, so traffic is negligible.
export function subscribeDeletedInMinutes(
  uid: string,
  onChange: (minutes: number) => void,
  onError?: (err: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, 'Users', uid),
    (snap) => {
      if (!snap.exists()) return
      const m = snap.get('DeletedInMinutes') as number | undefined
      if (typeof m !== 'number') return
      cache.set(uid, m)
      onChange(m)
    },
    onError,
  )
}
