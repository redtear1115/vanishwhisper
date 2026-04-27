import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// Cached because per-message vanish countdowns read this constantly. The value
// is per-user-doc and changes only when the user edits their settings, so a
// process-lifetime cache is fine for now (refreshed on full reload).
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
