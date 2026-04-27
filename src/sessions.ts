import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore'
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
    WrappedKey1: bufferToBase64(wrapped1),
    WrappedKey2: bufferToBase64(wrapped2),
    Name: '',
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
  return sessionRef.id
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

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
