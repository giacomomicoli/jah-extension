export const DB_NAME = 'jah';
export const DB_VERSION = 1;

export type StoreName = 'pages' | 'highlights' | 'groups';

let connection: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      db.onclose = () => {
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error);
    };
  });
  return connection;
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const pages = db.createObjectStore('pages', { keyPath: 'id' });
    pages.createIndex('canonicalUrl', 'canonicalUrl', { unique: true });
    pages.createIndex('urls', 'urls', { multiEntry: true });
    pages.createIndex('site', 'site');
    pages.createIndex('updatedAt', 'updatedAt');

    const highlights = db.createObjectStore('highlights', { keyPath: 'id' });
    highlights.createIndex('pageId', 'pageId');
    highlights.createIndex('groupId', 'groupId');
    highlights.createIndex('createdAt', 'createdAt');
    highlights.createIndex('updatedAt', 'updatedAt');

    db.createObjectStore('groups', { keyPath: 'id' });
  }
}

export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs `work` inside one transaction and resolves once it has committed.
 * `work` may only await IndexedDB requests of this transaction, or it would auto-commit.
 */
export async function transaction<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, mode);
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
  committed.catch(() => undefined);
  try {
    const result = await work(tx);
    await committed;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already committed or aborted.
    }
    throw error;
  }
}

export function getAll<T>(tx: IDBTransaction, store: StoreName): Promise<T[]> {
  return promisify(tx.objectStore(store).getAll()) as Promise<T[]>;
}

export function get<T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return promisify(tx.objectStore(store).get(key)) as Promise<T | undefined>;
}
