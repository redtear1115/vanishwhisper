import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref, type Ref } from 'vue'
import { auth, db } from './firebase'

const IDB_NAME = 'vanishwhisper'
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
  const publicKeySpkiBase64 = bufferToBase64(publicKeySpki)
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

// ----- IndexedDB minimal helpers -----

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2: v1 mistakenly stored the public key as non-extractable, which broke
    // re-export on subsequent loads. v2 wipes the store so the next call
    // generates a fresh keypair with extractable=true on the public key.
    const req = indexedDB.open(IDB_NAME, 2)
    req.onupgradeneeded = (event) => {
      const tx = req.transaction
      if (event.oldVersion < 1) {
        req.result.createObjectStore(IDB_STORE)
      } else if (tx) {
        tx.objectStore(IDB_STORE).clear()
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(): Promise<CryptoKeyPair | null> {
  const idb = await openDb()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve((req.result as CryptoKeyPair | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(pair: CryptoKeyPair): Promise<void> {
  const idb = await openDb()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(pair, IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
