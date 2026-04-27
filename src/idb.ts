// Shared IndexedDB connection for browser-local state. Both identity (RSA
// keypair) and labels (per-session display names) live here, so the schema
// must be migrated through one set of `onupgradeneeded` paths — having two
// modules each call `indexedDB.open(name, version)` with different versions
// would race.
//
// Stores:
// - 'identity' (v1+): the user's RSA-OAEP keypair, stored under fixed key
//   'keypair'. See src/identity.ts.
// - 'labels'   (v3+): per-session human-readable display labels, keyPath
//   'sessionId'. Local-only — names never reach the server. See src/labels.ts.
//
// Upgrade history (each step is a discrete `if (oldVersion < N)` branch so
// users at any prior version migrate forward correctly):
// - v1: created 'identity' store.
// - v2: cleared 'identity' (early keypairs had non-extractable public keys).
// - v3: created 'labels' store.

const IDB_NAME = 'vanishwhisper'
const IDB_VERSION = 3

let dbPromise: Promise<IDBDatabase> | null = null

export function openIdb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      const tx = req.transaction
      if (event.oldVersion < 1) {
        db.createObjectStore('identity')
      }
      if (event.oldVersion >= 1 && event.oldVersion < 2 && tx) {
        tx.objectStore('identity').clear()
      }
      if (event.oldVersion < 3) {
        db.createObjectStore('labels', { keyPath: 'sessionId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}
