import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  FieldPath,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
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
  senderUid: string
  fromMe: boolean
  text: string | null // null when decryption fails
  createdAt: Date | null
  readAt: Date | null
  deletedAt: Date | null
  reactions: Record<string, string[]> // emoji -> uids; plaintext per Phase 2 design
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
          const senderUid = data.UserID as string
          map.set(change.doc.id, {
            id: change.doc.id,
            senderUid,
            fromMe: senderUid === me.uid,
            text: await tryDecrypt(sessionKey, data.Context as string),
            createdAt: (data.CreatedAt as Timestamp | undefined)?.toDate() ?? null,
            readAt: (data.ReadAt as Timestamp | undefined)?.toDate() ?? null,
            deletedAt: (data.DeletedAt as Timestamp | undefined)?.toDate() ?? null,
            reactions: (data.Reactions as Record<string, string[]> | undefined) ?? {},
          })
        }),
      )
      onUpdate(
        Array.from(map.values()).sort((a, b) => {
          // Pending writes (the writer's own just-sent message before the
          // server confirms serverTimestamp()) come back with createdAt =
          // null. Sorting null as 0 would briefly slot the new message at
          // the TOP of the list and snap it back to the bottom on the
          // confirm — visible jank. Sort null as MAX_SAFE_INTEGER instead
          // so pending messages settle at the bottom from the first frame.
          const aT = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER
          const bT = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER
          return aT - bT
        }),
      )
    },
    onError,
  )
}

// Vanish lifecycle. ReadAt and the auto-vanish DeletedAt are recipient-only
// (Firestore rules: sender !== writer, single-field write, value ==
// request.time). deleteMessage() is the sender-initiated unsend — same
// DeletedAt field, separate rule path that requires sender == writer.

export async function markRead(messageId: string): Promise<void> {
  await updateDoc(doc(db, 'ChatMessages', messageId), { ReadAt: serverTimestamp() })
}

export async function markDeleted(messageId: string): Promise<void> {
  await updateDoc(doc(db, 'ChatMessages', messageId), { DeletedAt: serverTimestamp() })
}

export async function deleteMessage(messageId: string): Promise<void> {
  await updateDoc(doc(db, 'ChatMessages', messageId), { DeletedAt: serverTimestamp() })
}

// Reactions are plaintext (Phase 2 decision — emoji codepoints carry no
// confidential payload and the threat model already names both participants).
// Use FieldPath() rather than dot-notation so emoji keys never collide with
// Firestore's path parser.
export async function toggleReaction(
  messageId: string,
  emoji: string,
  hasMine: boolean,
): Promise<void> {
  const me = getIdentity()
  const op = hasMine ? arrayRemove(me.uid) : arrayUnion(me.uid)
  await updateDoc(doc(db, 'ChatMessages', messageId), new FieldPath('Reactions', emoji), op)
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
