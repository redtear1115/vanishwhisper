import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
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
  }
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

