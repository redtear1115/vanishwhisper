import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref, type Ref } from 'vue'
import { bytesToBase64 } from './codec'
import { auth, db } from './firebase'
import { withIdb } from './idb'

const IDB_STORE = 'identity'
const IDB_KEY = 'keypair'

const RSA_PARAMS = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
} as const

const RSA_IMPORT = { name: 'RSA-OAEP', hash: 'SHA-256' } as const

export interface Identity {
  uid: string
  keyPair: CryptoKeyPair
  publicKeySpkiBase64: string
}

const identityRef = ref<Identity | null>(null)
const errorRef = ref<unknown>(null)
let initPromise: Promise<Identity> | null = null

export function useIdentity(): { identity: Ref<Identity | null>; error: Ref<unknown> } {
  if (!initPromise) initPromise = init()
  return { identity: identityRef, error: errorRef }
}

// Synchronous getter for non-component callers (e.g. sessions.ts). Throws if
// called before identity has been established (shouldn't happen since the
// rest of the app is gated behind `useIdentity()` resolving).
export function getIdentity(): Identity {
  if (!identityRef.value) throw new Error('Identity not yet initialized.')
  return identityRef.value
}

function init(): Promise<Identity> {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          await signInAnonymously(auth)
          return
        }
        const id = await ensureIdentity(user)
        identityRef.value = id
        resolve(id)
      } catch (err) {
        errorRef.value = err
        reject(err)
      }
    })
  })
}

async function ensureIdentity(user: User): Promise<Identity> {
  let pair = await idbGet()
  let publicKeySpki: ArrayBuffer
  if (pair) {
    publicKeySpki = await crypto.subtle.exportKey('spki', pair.publicKey)
  } else {
    const ext = (await crypto.subtle.generateKey(RSA_PARAMS, true, [
      'encrypt',
      'decrypt',
    ])) as CryptoKeyPair
    publicKeySpki = await crypto.subtle.exportKey('spki', ext.publicKey)
    const privateJwk = await crypto.subtle.exportKey('jwk', ext.privateKey)
    const privateKey = await crypto.subtle.importKey('jwk', privateJwk, RSA_IMPORT, false, [
      'decrypt',
    ])
    // Public key is extractable on purpose: we re-export it as SPKI on every
    // load to write to the Users doc. Private key stays non-extractable.
    const publicKey = await crypto.subtle.importKey('spki', publicKeySpki, RSA_IMPORT, true, [
      'encrypt',
    ])
    pair = { publicKey, privateKey }
    await idbPut(pair)
  }
  const publicKeySpkiBase64 = bytesToBase64(publicKeySpki)
  await ensureUsersDoc(user.uid, publicKeySpkiBase64)
  return { uid: user.uid, keyPair: pair, publicKeySpkiBase64 }
}

async function ensureUsersDoc(uid: string, publicKeyBase64: string): Promise<void> {
  const userDoc = doc(db, 'Users', uid)
  const snap = await getDoc(userDoc)
  if (snap.exists()) {
    if (snap.get('PublicKey') === publicKeyBase64) return
    await setDoc(
      userDoc,
      { PublicKey: publicKeyBase64, UpdatedAt: serverTimestamp() },
      { merge: true },
    )
    return
  }
  await setDoc(userDoc, {
    PublicKey: publicKeyBase64,
    DeletedInMinutes: 60,
    CreatedAt: serverTimestamp(),
    UpdatedAt: serverTimestamp(),
  })
}

// ----- IndexedDB minimal helpers (DB schema lives in src/idb.ts) -----
// All transactions go through withIdb() so the iOS Safari "connection is
// closing" quirk on the first post-upgrade transaction self-heals via
// retry instead of bubbling up as a sign-in failure.

async function idbGet(): Promise<CryptoKeyPair | null> {
  return withIdb(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
        req.onsuccess = () => resolve((req.result as CryptoKeyPair | undefined) ?? null)
        req.onerror = () => reject(req.error)
      }),
  )
}

async function idbPut(pair: CryptoKeyPair): Promise<void> {
  return withIdb(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(pair, IDB_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

