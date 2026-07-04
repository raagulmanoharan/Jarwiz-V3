/**
 * Raw access to tldraw's per-board local databases — the layer beneath the
 * mounted editor. Backup reads/writes whole documents here; cross-board
 * search reads records of boards that aren't mounted. Layout pinned to
 * tldraw's LocalIndexedDb (one database per persistenceKey, four object
 * stores) — if a tldraw upgrade changes it, these constants keep old data
 * readable.
 */

export const DB_PREFIX = 'TLDRAW_DOCUMENT_v2';
export const DB_VERSION = 4;
export const DB_STORES = ['records', 'schema', 'session_state', 'assets'] as const;

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export function openBoardDb(name: string): Promise<IDBDatabase> {
  const open = indexedDB.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const store of DB_STORES) {
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    }
  };
  return req(open as IDBRequest<IDBDatabase>);
}

/** Delete a database, failing loudly if another connection keeps it alive
 *  (another Jarwiz tab) — silently proceeding would interleave old and new
 *  data. Callers unmount this tab's editor before running. */
export function deleteBoardDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    const timeout = setTimeout(
      () => reject(new Error('A board database is still in use — close other Jarwiz tabs and retry.')),
      5000,
    );
    r.onsuccess = r.onerror = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
}

/** Database names present in this profile — to skip boards that were created
 *  but never opened (they have no database yet). Null when the enumeration
 *  API is unavailable (caller opens blind, which just creates empty stores). */
export async function existingDbNames(): Promise<Set<string> | null> {
  if (!('databases' in indexedDB)) return null;
  const dbs = await indexedDB.databases();
  return new Set(dbs.map((d) => d.name).filter((n): n is string => !!n));
}

/** All tldraw records of one board, read without mounting it. Empty for a
 *  board that has no database yet. */
export async function readBoardRecords(
  dbName: string,
  present: Set<string> | null,
): Promise<Array<{ id: string } & Record<string, unknown>>> {
  if (present && !present.has(dbName)) return [];
  const db = await openBoardDb(dbName);
  try {
    const tx = db.transaction(['records'], 'readonly');
    return (await req(tx.objectStore('records').getAll())) as Array<{ id: string } & Record<string, unknown>>;
  } finally {
    db.close();
  }
}
