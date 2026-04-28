import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { onScopeDispose, ref, type Ref } from 'vue'
import { base64ToBytes, bytesToBase64 } from './codec'
import { db } from './firebase'
import { getIdentity } from './identity'

export async function createSession(inviteeUid: string): Promise<string> {
  const me = getIdentity()
  if (inviteeUid === me.uid) throw new Error('Cannot invite yourself.')

  // Single session per pair (silent dedup). Mirrors standard chat-app UX —
  // WhatsApp / Signal / iMessage / Telegram / Slack DM all keep exactly one
  // 1-on-1 conversation per pair. If we already share a session with this
  // user (either direction of who-invited-whom), return its id so the caller
  // routes into the existing chat instead of spawning a duplicate. The user
  // experiences "this opened our chat" rather than "this created a new chat".
  // To start truly fresh, both sides go through the mutual-delete flow
  // (which is the consensual way to retire a session) and then re-invite.
  // Tiny race window: if A and B both call createSession() with each other
  // concurrently before either write lands, both findExistingSession calls
  // return null and we end up with two docs. Mutual delete cleans this up.
  const existing = await findExistingSession(me.uid, inviteeUid)
  if (existing) return existing

  const inviteeSnap = await getDoc(doc(db, 'Users', inviteeUid))
  if (!inviteeSnap.exists()) throw new Error('Invitee UID not found.')
  const inviteePublicKeyBase64 = inviteeSnap.get('PublicKey') as string | undefined
  if (!inviteePublicKeyBase64) throw new Error('Invitee has no public key.')

  // Per-session symmetric key, wrapped (RSA-OAEP encrypted) for both parties.
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const aesRaw = await crypto.subtle.exportKey('raw', aesKey)

  const inviteePublicKey = await importRsaPublicKey(inviteePublicKeyBase64)
  const wrapped1 = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    me.keyPair.publicKey,
    aesRaw,
  )
  const wrapped2 = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, inviteePublicKey, aesRaw)

  const sessionRef = await addDoc(collection(db, 'ChatSessions'), {
    Participant1: me.uid,
    Participant2: inviteeUid,
    WrappedKey1: bytesToBase64(wrapped1),
    WrappedKey2: bytesToBase64(wrapped2),
    Name: '',
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
  return sessionRef.id
}

export interface OpenSession {
  id: string
  myUid: string
  otherParticipant: string
  sessionKey: CryptoKey
}

export async function openSession(sessionId: string): Promise<OpenSession> {
  const me = getIdentity()
  const snap = await getDoc(doc(db, 'ChatSessions', sessionId))
  if (!snap.exists()) throw new Error('Session not found.')
  const d = snap.data()
  const p1 = d.Participant1 as string
  const p2 = d.Participant2 as string
  if (p1 !== me.uid && p2 !== me.uid) throw new Error('Not a participant of this session.')
  const myWrappedBase64 = (p1 === me.uid ? d.WrappedKey1 : d.WrappedKey2) as string
  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    me.keyPair.privateKey,
    base64ToBytes(myWrappedBase64),
  )
  const sessionKey = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  return {
    id: sessionId,
    myUid: me.uid,
    otherParticipant: p1 === me.uid ? p2 : p1,
    sessionKey,
  }
}

export interface ChatSessionRow {
  id: string
  otherParticipant: string
  name: string
  createdAt: Date | null
  updatedAt: Date | null
  // UID of the participant who has requested mutual deletion of this session
  // (or null when no request is pending). Drives the home-list "delete pending"
  // hint and, in the chat view, the agree/reject banner.
  deleteRequestedBy: string | null
}

export interface SessionMeta {
  deleteRequestedBy: string | null
  deleteRequestedAt: Date | null
}

// Live subscription to a single ChatSessions doc — lets the chat view react
// to remote DeleteRequestedBy changes (banner toggles between "I requested",
// "they requested", and absent) and to the session itself being deleted
// (other party agreed → cascade ran → doc gone → onChange fires with null
// so we can navigate the user back to the home list).
export function subscribeSession(
  sessionId: string,
  onChange: (meta: SessionMeta | null) => void,
  onError?: (err: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, 'ChatSessions', sessionId),
    (snap) => {
      if (!snap.exists()) {
        onChange(null)
        return
      }
      const d = snap.data()
      onChange({
        deleteRequestedBy: (d.DeleteRequestedBy as string | undefined) ?? null,
        deleteRequestedAt: (d.DeleteRequestedAt as Timestamp | undefined)?.toDate() ?? null,
      })
    },
    onError,
  )
}

// Mutual-delete lifecycle. Three operations that both sides can issue from
// the chat view:
//   - requestDeleteSession: writes DeleteRequestedBy = me. Rules enforce no
//     pending request can already exist.
//   - cancelDeleteSession: clears the request fields. Either party can fire
//     this — requester changing their mind = cancel; other party = reject.
//   - agreeDeleteSession: cascade hard-deletes all messages + the session
//     doc. Rules enforce that ONLY the non-requester can do this, so the
//     requester literally cannot delete on their own.

export async function requestDeleteSession(sessionId: string): Promise<void> {
  const me = getIdentity()
  await updateDoc(doc(db, 'ChatSessions', sessionId), {
    DeleteRequestedBy: me.uid,
    DeleteRequestedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
}

export async function cancelDeleteSession(sessionId: string): Promise<void> {
  await updateDoc(doc(db, 'ChatSessions', sessionId), {
    DeleteRequestedBy: deleteField(),
    DeleteRequestedAt: deleteField(),
    UpdatedAt: serverTimestamp(),
  })
}

// Cascade hard-delete. Walks every ChatMessages doc for the session and
// batches the deletes (Firestore caps batches at 500 ops; we chunk at 499
// so the final batch can also delete the session doc). Two-phase isn't
// needed — within a batch, rules evaluate against the pre-batch state, so
// the message rule's get(session) still sees DeleteRequestedBy set.
export async function agreeDeleteSession(sessionId: string): Promise<void> {
  const messagesSnap = await getDocs(
    query(collection(db, 'ChatMessages'), where('SessionID', '==', sessionId)),
  )
  const messageDocs = messagesSnap.docs
  const CHUNK = 499
  for (let i = 0; i < messageDocs.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const m of messageDocs.slice(i, i + CHUNK)) {
      batch.delete(m.ref)
    }
    await batch.commit()
  }
  await deleteDoc(doc(db, 'ChatSessions', sessionId))
}

export function useSessions(): { sessions: Ref<ChatSessionRow[]>; error: Ref<unknown> } {
  const me = getIdentity()
  const sessions = ref<ChatSessionRow[]>([])
  const error = ref<unknown>(null)
  const map = new Map<string, ChatSessionRow>()

  function rebuild() {
    sessions.value = Array.from(map.values()).sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    )
  }

  function applyChange(snap: QuerySnapshot<DocumentData>) {
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') {
        map.delete(change.doc.id)
      } else {
        map.set(change.doc.id, toRow(change.doc, me.uid))
      }
    })
    rebuild()
  }

  const onErr = (err: unknown) => {
    error.value = err
  }

  // Two queries (Participant1==me, Participant2==me) merged client-side —
  // simpler than Firestore `or()` queries and needs no composite index.
  const unsub1 = onSnapshot(
    query(collection(db, 'ChatSessions'), where('Participant1', '==', me.uid)),
    applyChange,
    onErr,
  )
  const unsub2 = onSnapshot(
    query(collection(db, 'ChatSessions'), where('Participant2', '==', me.uid)),
    applyChange,
    onErr,
  )

  onScopeDispose(() => {
    unsub1()
    unsub2()
  })

  return { sessions, error }
}

function toRow(snap: QueryDocumentSnapshot<DocumentData>, myUid: string): ChatSessionRow {
  const d = snap.data()
  const p1 = d.Participant1 as string
  const p2 = d.Participant2 as string
  return {
    id: snap.id,
    otherParticipant: p1 === myUid ? p2 : p1,
    name: (d.Name as string | undefined) ?? '',
    createdAt: (d.CreatedAt as Timestamp | undefined)?.toDate() ?? null,
    updatedAt: (d.UpdatedAt as Timestamp | undefined)?.toDate() ?? null,
    deleteRequestedBy: (d.DeleteRequestedBy as string | undefined) ?? null,
  }
}

// Two equality-only queries (one for each "who is Participant1" direction)
// merged client-side. Firestore serves equality-only compound queries via
// single-field auto-indexes — no composite index required. Returns the
// first matching session id from either direction, or null if no session
// exists between the pair.
async function findExistingSession(
  myUid: string,
  otherUid: string,
): Promise<string | null> {
  const [aSnap, bSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'ChatSessions'),
        where('Participant1', '==', myUid),
        where('Participant2', '==', otherUid),
      ),
    ),
    getDocs(
      query(
        collection(db, 'ChatSessions'),
        where('Participant1', '==', otherUid),
        where('Participant2', '==', myUid),
      ),
    ),
  ])
  return aSnap.docs[0]?.id ?? bSnap.docs[0]?.id ?? null
}

async function importRsaPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const spki = Uint8Array.from(atob(spkiBase64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

