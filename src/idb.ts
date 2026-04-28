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

function openConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => {
      const db = req.result
      // Drop the cached promise when this connection becomes unusable so
      // subsequent openIdb() calls grab a fresh connection. Two cases:
      //   - versionchange: another tab opened the db at a higher version
      //     and is asking us to step out of the way.
      //   - close: the browser tore the connection down (Safari does this
      //     aggressively when a tab is backgrounded for a while).
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IDB open blocked by another tab.'))
  })
}

export function openIdb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openConnection()
  return dbPromise
}

// Wraps an IDB transaction with one-shot retry on the "connection is
// closing" InvalidStateError. iOS Safari (and occasionally desktop Safari)
// reports this on the very first transaction immediately after the
// onupgradeneeded path on a brand-new database — the connection settles
// and works on retry. Without this wrapper the user saw "Sign-in failed:
// InvalidStateError" on first load and had to reload to recover.
export async function withIdb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  let attempts = 0
  while (true) {
    try {
      const db = await openIdb()
      return await fn(db)
    } catch (err) {
      const isClosing =
        err instanceof DOMException &&
        (err.name === 'InvalidStateError' ||
          (err.message ?? '').includes('closing'))
      if (isClosing && attempts === 0) {
        attempts++
        // Force a fresh connection on the next openIdb() — the previous
        // one is unusable. Tiny back-off lets Safari finish whatever
        // bookkeeping it was doing post-upgrade.
        dbPromise = null
        await new Promise((r) => setTimeout(r, 50))
        continue
      }
      throw err
    }
  }
}
