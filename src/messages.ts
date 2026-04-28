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

export interface AttachmentInfo {
  mime: string
  width: number
  height: number
  // Pre-decrypted blob URL ready for an <img src>. null when decryption
  // failed (rendered as "[unable to decrypt image]" by the view). The URL
  // is owned by the subscribeMessages closure — it's revoked on unsubscribe
  // and on per-message remove, so the view must NOT call URL.revokeObjectURL.
  blobUrl: string | null
}

export interface ChatMessageRow {
  id: string
  senderUid: string
  fromMe: boolean
  text: string | null // null when decryption fails; '' when message has no text body
  createdAt: Date | null
  readAt: Date | null
  deletedAt: Date | null
  reactions: Record<string, string[]> // emoji -> uids; plaintext per Phase 2 design
  attachment: AttachmentInfo | null
  // Sticker key from the bundled set (see src/stickers.ts). Plaintext for
  // the same reason as reactions — drawn from a public 9-item list, no
  // confidential payload. Mutually exclusive with text/attachment in the UI
  // (sticker-only messages skip Context entirely).
  sticker: string | null
}

// Image attachment caps, all client-side enforced. Firestore docs are limited
// to 1 MiB; binary 750KB → +16-byte AES-GCM tag → +12-byte IV prefix → base64
// ~+33% lands at ~1 MB, which leaves ~24KB headroom in the doc for everything
// else. Keep the binary cap at 750KB to stay safely under the limit.
const IMAGE_MAX_INPUT_BYTES = 5 * 1024 * 1024
const IMAGE_MAX_COMPRESSED_BYTES = 750 * 1024
const IMAGE_MAX_DIMENSION = 1600
const IMAGE_QUALITY_STEPS = [0.85, 0.7, 0.55] as const

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
  // Cache decrypted attachment blob URLs by message id. Decrypting a 750KB
  // image on every snapshot tick (e.g. when a reaction toggle re-emits the
  // doc) would be wasteful — once we have the URL we keep it for the
  // message's lifetime. Revoked on per-message removed and on unsubscribe
  // so we don't leak object-URL slots.
  const attachmentUrls = new Map<string, string>()

  function disposeAttachment(messageId: string): void {
    const url = attachmentUrls.get(messageId)
    if (url) {
      URL.revokeObjectURL(url)
      attachmentUrls.delete(messageId)
    }
  }

  const unsub = onSnapshot(
    query(
      collection(db, 'ChatMessages'),
      where('SessionID', '==', sessionId),
      orderBy('CreatedAt', 'asc'),
    ),
    async (snap: QuerySnapshot<DocumentData>) => {
      await Promise.all(
        snap.docChanges().map(async (change) => {
          if (change.type === 'removed') {
            disposeAttachment(change.doc.id)
            map.delete(change.doc.id)
            return
          }
          const data = change.doc.data()
          const senderUid = data.UserID as string
          const attachmentData = data.Attachment as
            | { Mime: string; Width: number; Height: number; Context: string }
            | undefined
          let attachment: AttachmentInfo | null = null
          if (attachmentData) {
            let blobUrl: string | null = attachmentUrls.get(change.doc.id) ?? null
            if (!blobUrl) {
              const bytes = await tryDecryptBytes(sessionKey, attachmentData.Context)
              if (bytes) {
                const blob = new Blob([bytes], { type: attachmentData.Mime })
                blobUrl = URL.createObjectURL(blob)
                attachmentUrls.set(change.doc.id, blobUrl)
              }
            }
            attachment = {
              mime: attachmentData.Mime,
              width: attachmentData.Width,
              height: attachmentData.Height,
              blobUrl,
            }
          }
          map.set(change.doc.id, {
            id: change.doc.id,
            senderUid,
            fromMe: senderUid === me.uid,
            text: data.Context ? await tryDecrypt(sessionKey, data.Context as string) : '',
            createdAt: (data.CreatedAt as Timestamp | undefined)?.toDate() ?? null,
            readAt: (data.ReadAt as Timestamp | undefined)?.toDate() ?? null,
            deletedAt: (data.DeletedAt as Timestamp | undefined)?.toDate() ?? null,
            reactions: (data.Reactions as Record<string, string[]> | undefined) ?? {},
            attachment,
            sticker: (data.Sticker as string | undefined) ?? null,
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

  return () => {
    unsub()
    for (const url of attachmentUrls.values()) {
      URL.revokeObjectURL(url)
    }
    attachmentUrls.clear()
  }
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
  const bytes = await tryDecryptBytes(sessionKey, contextBase64)
  return bytes ? new TextDecoder().decode(bytes) : null
}

// Explicit Uint8Array<ArrayBuffer> return so the result satisfies the strict
// BlobPart / BufferSource types in lib.dom (a default Uint8Array is typed
// over ArrayBufferLike, which can be SharedArrayBuffer and is rejected).
async function tryDecryptBytes(
  sessionKey: CryptoKey,
  contextBase64: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const packed = base64ToBytes(contextBase64)
    const iv = packed.slice(0, 12)
    const cipher = packed.slice(12)
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, cipher)
    return new Uint8Array(data)
  } catch {
    return null
  }
}

// ----- Image attachments (Phase 2 step 3) -----

export async function sendImageMessage(
  sessionId: string,
  sessionKey: CryptoKey,
  file: File,
): Promise<void> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file.')
  }
  if (file.size > IMAGE_MAX_INPUT_BYTES) {
    throw new Error('Image larger than 5 MB.')
  }
  const me = getIdentity()

  // 1. Compress: resize down to <= 1600 on the longer side, then iterate
  //    JPEG quality until we fit under 750KB binary.
  const { blob, width, height } = await compressImage(file)

  // 2. Encrypt the compressed bytes with the session AES-GCM key. Same wire
  //    format as text Context (`base64(iv ‖ ciphertext)`); a fresh IV per
  //    message is required for AES-GCM safety.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sessionKey,
    new Uint8Array(await blob.arrayBuffer()),
  )
  const packed = new Uint8Array(iv.length + cipher.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(cipher), iv.length)

  // 3. Write — Attachment is a sub-map; Width/Height stay plaintext for
  //    layout (not confidential — the recipient can read them from the
  //    decrypted image anyway). Image-only messages have no Context field.
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'ChatMessages')), {
    SessionID: sessionId,
    UserID: me.uid,
    Attachment: {
      Mime: 'image/jpeg', // compressImage always emits JPEG
      Width: width,
      Height: height,
      Context: bytesToBase64(packed),
    },
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'ChatSessions', sessionId), {
    UpdatedAt: serverTimestamp(),
  })
  await batch.commit()
}

async function compressImage(file: File): Promise<{
  blob: Blob
  width: number
  height: number
}> {
  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  // Resize so the longer side is at most IMAGE_MAX_DIMENSION (preserve aspect).
  if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
    const scale = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas 2D context unavailable.')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  // Step quality down until we fit under the binary cap. Three attempts is
  // enough in practice — a photo that fails 0.55 is too detailed to send.
  for (const quality of IMAGE_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (blob.size <= IMAGE_MAX_COMPRESSED_BYTES) {
      return { blob, width, height }
    }
  }
  throw new Error('Image too detailed to compress under 750 KB. Try a smaller image.')
}

// ----- Stickers (Phase 2 step 4) -----

export async function sendStickerMessage(
  sessionId: string,
  stickerKey: string,
): Promise<void> {
  const me = getIdentity()
  // Plaintext like reactions — sticker keys are drawn from a public 9-item
  // list bundled with the app, so encryption adds no confidentiality. No
  // session key required for this path.
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'ChatMessages')), {
    SessionID: sessionId,
    UserID: me.uid,
    Sticker: stickerKey,
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'ChatSessions', sessionId), {
    UpdatedAt: serverTimestamp(),
  })
  await batch.commit()
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality,
    )
  })
}
