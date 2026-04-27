import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { base64ToBytes, bytesToBase64 } from './codec'
import { db } from './firebase'
import { getIdentity } from './identity'

export interface ChatMessageRow {
  id: string
  fromMe: boolean
  text: string | null // null when decryption fails
  createdAt: Date | null
}

export async function sendMessage(
  sessionId: string,
  sessionKey: CryptoKey,
  plaintext: string,
): Promise<void> {
  const me = getIdentity()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sessionKey,
    new TextEncoder().encode(plaintext),
  )
  const packed = new Uint8Array(iv.length + cipher.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(cipher), iv.length)

  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'ChatMessages')), {
    SessionID: sessionId,
    UserID: me.uid,
    Context: bytesToBase64(packed),
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'ChatSessions', sessionId), {
    UpdatedAt: serverTimestamp(),
  })
  await batch.commit()
}

export function subscribeMessages(
  sessionId: string,
  sessionKey: CryptoKey,
  onUpdate: (rows: ChatMessageRow[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const me = getIdentity()
  const map = new Map<string, ChatMessageRow>()

  return onSnapshot(
    query(
      collection(db, 'ChatMessages'),
      where('SessionID', '==', sessionId),
      orderBy('CreatedAt', 'asc'),
    ),
    async (snap: QuerySnapshot<DocumentData>) => {
      await Promise.all(
        snap.docChanges().map(async (change) => {
          if (change.type === 'removed') {
            map.delete(change.doc.id)
            return
          }
          const data = change.doc.data()
          map.set(change.doc.id, {
            id: change.doc.id,
            fromMe: data.UserID === me.uid,
            text: await tryDecrypt(sessionKey, data.Context as string),
            createdAt: (data.CreatedAt as Timestamp | undefined)?.toDate() ?? null,
          })
        }),
      )
      onUpdate(
        Array.from(map.values()).sort(
          (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
        ),
      )
    },
    onError,
  )
}

async function tryDecrypt(sessionKey: CryptoKey, contextBase64: string): Promise<string | null> {
  try {
    const packed = base64ToBytes(contextBase64)
    const iv = packed.slice(0, 12)
    const cipher = packed.slice(12)
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, cipher)
    return new TextDecoder().decode(data)
  } catch {
    return null
  }
}
