// Phase 2.17 — Active hand-off migration.
//
// "I'm switching devices and want to bring my chats with me."
//
// We can't preserve the auth UID across devices: Firebase Anonymous Auth
// binds the UID to the device's local state, and the only way to log back
// in as the same UID elsewhere is via an identity provider (rejected by
// the threat model) or a server-minted custom token (Blaze + server-side
// identity, also off-table). Instead, migration TRANSFERS each session's
// participant slot from the old UID to a fresh one on the new device:
// re-wraps the session AES key for the new device's RSA public key and
// rewrites the slot in Firestore. The session AES key itself doesn't
// change, so the OTHER participant's WrappedKey stays valid and they keep
// being able to decrypt every message — they just see "the other person's
// UID changed" in their UI (auditable feature, not a bug).
//
// After the slot swap, my historical messages still carry UserID = oldUID.
// That UID is now "orphan" — no longer in either participant slot. The
// new device claims those on first sight by rewriting UserID = newUID,
// driven from ChatSessionView's first message batch. Idempotent: re-entry
// of an already-claimed chat is a no-op.
//
// What this CAN'T do:
//   - Migrate from a device that's already dead/lost. The slot-swap writes
//     are authed as the OLD UID, so they need a working old device.
//   - Migrate without trusting the target UID. We fetch the target's
//     PublicKey from Users/{newUID} and surface its fingerprint; the user
//     must verify it matches what the new device displays. Without that
//     check, entering an attacker's UID would migrate sessions to them.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { base64ToBytes, bytesToBase64 } from './codec'
import { db } from './firebase'
import { getIdentity } from './identity'
import type { ChatMessageRow } from './messages'

export interface TargetIdentity {
  uid: string
  publicKeySpkiBase64: string
  fingerprint: string
}

// Same fingerprint format as ProfileView shows for the local identity, so
// the user can compare across both devices without mental conversion.
async function fingerprintOf(spkiBase64: string): Promise<string> {
  const spki = base64ToBytes(spkiBase64)
  const hash = await crypto.subtle.digest('SHA-256', spki)
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
}

// Resolve a target UID → its public key + fingerprint. Throws on not-found
// / no-key / self-uid (you'd be migrating to your current device which
// makes no sense). Caller surfaces the fingerprint to the user for visual
// confirmation against the new device's screen.
export async function fetchTargetIdentity(uid: string): Promise<TargetIdentity> {
  const trimmed = uid.trim()
  if (!trimmed) throw new Error("Enter the new device's UID.")
  const me = getIdentity()
  if (trimmed === me.uid) {
    throw new Error("That's this device's UID. Open the app on the NEW device first to get its UID.")
  }
  const snap = await getDoc(doc(db, 'Users', trimmed))
  if (!snap.exists()) {
    throw new Error('UID not found. Make sure your new device has opened the app at least once.')
  }
  const pk = snap.get('PublicKey') as string | undefined
  if (!pk) throw new Error('Target user has no public key.')
  return { uid: trimmed, publicKeySpkiBase64: pk, fingerprint: await fingerprintOf(pk) }
}

export interface SessionToMigrate {
  id: string
  otherUid: string
}

// One-shot fetch of every session this UID currently participates in.
// Purposely NOT a live subscription — migration is a discrete transaction,
// not an ongoing UI surface.
export async function listMigratableSessions(): Promise<SessionToMigrate[]> {
  const me = getIdentity()
  const [a, b] = await Promise.all([
    getDocs(query(collection(db, 'ChatSessions'), where('Participant1', '==', me.uid))),
    getDocs(query(collection(db, 'ChatSessions'), where('Participant2', '==', me.uid))),
  ])
  const out: SessionToMigrate[] = []
  for (const docSnap of [...a.docs, ...b.docs]) {
    const d = docSnap.data()
    const p1 = d.Participant1 as string
    const p2 = d.Participant2 as string
    out.push({ id: docSnap.id, otherUid: p1 === me.uid ? p2 : p1 })
  }
  return out
}

async function importRsaPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const spki = base64ToBytes(spkiBase64)
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

// Migrate a single session. Idempotent — re-running on an already-migrated
// session is a no-op (the UID check at the top short-circuits). Throws on
// degenerate cases (target == other-side, session vanished). Single
// Firestore update with the slot swap + re-wrap + (conditional) LastMessageBy
// rewrite, gated by rule branch (d) / (d-mirror) in firestore.rules.
async function migrateSession(sessionId: string, target: TargetIdentity): Promise<void> {
  const me = getIdentity()
  const ref = doc(db, 'ChatSessions', sessionId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return // session was deleted between list+migrate
  const d = snap.data()
  const p1 = d.Participant1 as string
  const p2 = d.Participant2 as string
  // Idempotent: already migrated.
  if (p1 !== me.uid && p2 !== me.uid) return
  if (p1 === target.uid || p2 === target.uid) {
    throw new Error(`Cannot migrate session ${sessionId}: target UID is the other participant.`)
  }
  const isP1 = p1 === me.uid
  const wrappedField = isP1 ? 'WrappedKey1' : 'WrappedKey2'
  const participantField = isP1 ? 'Participant1' : 'Participant2'
  // Unwrap the session AES key with the OLD private key — only this device
  // can do this. Stays in RAM; never written anywhere.
  const wrappedBase64 = d[wrappedField] as string
  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    me.keyPair.privateKey,
    base64ToBytes(wrappedBase64),
  )
  // Re-wrap with the new device's public key, then drop the cleartext.
  const targetPub = await importRsaPublicKey(target.publicKeySpkiBase64)
  const newWrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, targetPub, aesRaw)
  // Atomic single update — rule expects exactly { Participant{N},
  // WrappedKey{N}, UpdatedAt, ?LastMessageBy }.
  const update: Record<string, unknown> = {
    [participantField]: target.uid,
    [wrappedField]: bytesToBase64(newWrapped),
    UpdatedAt: serverTimestamp(),
  }
  if (d.LastMessageBy === me.uid) {
    update.LastMessageBy = target.uid
  }
  await updateDoc(ref, update)
}

// Drives the whole batch. Sequential rather than parallel so progress
// reporting maps cleanly to the UI bar and so a mid-batch failure leaves
// a coherent "first N succeeded, the rest still on old UID" state — user
// can retry and the idempotency above picks up where it left off.
export async function migrateAllSessions(
  target: TargetIdentity,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const sessions = await listMigratableSessions()
  onProgress?.(0, sessions.length)
  let done = 0
  for (const s of sessions) {
    await migrateSession(s.id, target)
    done++
    onProgress?.(done, sessions.length)
  }
}

// ---- New device side: claim orphan messages ----
//
// After a session migration, all my historical messages still have
// UserID = oldUID. The new device sees those as "neither me nor the other
// party" — orphan — and rewrites them to its own UID on first sight. This
// makes:
//   - chat view fromMe detection (m.UserID === me.uid) light up old me-
//     authored messages as "me" again
//   - the unsend rule (UserID == auth.uid) once again let me unsend my
//     own historical messages
//   - the auto-vanish recipient checks (UserID != auth.uid) NOT fire on
//     my own old messages (would auto-vanish my own history if we treated
//     orphans as "from someone else")
//
// Idempotent + lazy: only runs once per session per process lifetime; if
// no orphans are found in the row set we mark it done and skip future
// re-runs (no Firestore writes in the steady state).

const claimedSessions = new Set<string>()

export async function claimOrphanMessages(
  sessionId: string,
  rows: ChatMessageRow[],
  otherUid: string,
): Promise<void> {
  if (claimedSessions.has(sessionId)) return
  const me = getIdentity()
  const orphans = rows.filter(
    (m) => m.senderUid !== me.uid && m.senderUid !== otherUid,
  )
  if (orphans.length === 0) {
    // No orphans visible in this row set — mark done so we don't re-scan
    // every snapshot tick. If new orphans arrive later (shouldn't happen
    // post-migration) the cache will be stale, but a page refresh re-
    // initialises it.
    claimedSessions.add(sessionId)
    return
  }
  // writeBatch caps at 500 ops; chunk at 499 to stay well clear. Each op
  // is rule-checked individually as branch (e) on ChatMessages.update, so
  // a single bad message in the batch doesn't take the rest down.
  const CHUNK = 499
  try {
    for (let i = 0; i < orphans.length; i += CHUNK) {
      const batch = writeBatch(db)
      for (const m of orphans.slice(i, i + CHUNK)) {
        batch.update(doc(db, 'ChatMessages', m.id), { UserID: me.uid })
      }
      await batch.commit()
    }
    claimedSessions.add(sessionId)
  } catch (err) {
    // Don't mark done on failure — let the next chat-view mount retry.
    console.error('claimOrphanMessages failed', sessionId, err)
  }
}
