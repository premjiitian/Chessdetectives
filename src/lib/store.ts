// Tiny key-value store on top of IndexedDB (falls back to memory if blocked).
// Everything the app learns about you lives here, in your own browser.

const DB_NAME = 'chess-detectives';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function set(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memory.set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(key: string): Promise<void> {
  const db = await open();
  if (!db) {
    memory.delete(key);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function keys(prefix = ''): Promise<string[]> {
  const db = await open();
  if (!db) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]).filter((k) => k.startsWith(prefix)));
    req.onerror = () => resolve([]);
  });
}

export async function clearAll(): Promise<void> {
  for (const k of await keys()) await del(k);
}
