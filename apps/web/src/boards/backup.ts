/**
 * Backup & restore — one-click insurance for everything Jarwiz keeps in the
 * browser. Every board lives in one browser profile: metadata in localStorage,
 * canvas documents in per-board IndexedDB databases (tldraw's local sync
 * store), and PDF bytes on the server's blob store (cards hold only the
 * `/api/assets/<id>` URL). A backup folds all three into a single JSON file:
 *
 *   { app: 'jarwiz', kind: 'backup', version: 1, boards: [...], serverAssets: [...] }
 *
 * Restore is a full replace — the backup becomes the workspace — and ends in a
 * page reload so tldraw remounts on the restored databases. Because the live
 * editor holds an open connection to the active board's database, restore
 * first raises a flag (subscribeRestore/isRestoring) that App uses to unmount
 * the canvas before any database is touched.
 *
 * Server assets are re-uploaded under their original ids, so restored cards
 * keep working URLs even on a fresh server (dev's blob store is a temp dir).
 */

import {
  boardPersistenceKey,
  getActiveBoardId,
  getBoards,
  writeBoardsForRestore,
  type Board,
} from './boardStore';

// tldraw's local persistence layout (LocalIndexedDb): one database per
// persistenceKey, four object stores. Pinned here deliberately — if a tldraw
// upgrade changes this, restore of old files must keep reading version 1.
const DB_PREFIX = 'TLDRAW_DOCUMENT_v2';
const DB_VERSION = 4;
const DB_STORES = ['records', 'schema', 'session_state', 'assets'] as const;

const ASSET_URL_RE = /\/api\/assets\/([A-Za-z0-9_-]{1,128})/g;

// ─── Types (backup format v1) ────────────────────────────────────────────────

interface BackupBlob {
  id: string;
  type: string;
  /** Raw base64 (no data: prefix). */
  b64: string;
}

interface BackupBoard {
  id: string;
  name: string;
  createdAt: number;
  isNew: boolean;
  /** tldraw records, keyed in the store by their own `id`. */
  records: Array<{ id: string } & Record<string, unknown>>;
  /** Serialized store schema — null for a board that was never opened. */
  schema: unknown;
  /** tldraw's local asset blobs (native image/video drops), usually empty. */
  localAssets: BackupBlob[];
}

export interface JarwizBackup {
  app: 'jarwiz';
  kind: 'backup';
  version: 1;
  exportedAt: string;
  activeBoardId: string;
  boards: BackupBoard[];
  /** Server blob-store files referenced by any board (PDF bytes). */
  serverAssets: BackupBlob[];
}

// ─── Restore-in-progress flag (external store for App) ──────────────────────

let _restoring = false;
let _restoreError: string | null = null;
const _listeners = new Set<() => void>();

export function subscribeRestore(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function isRestoring(): boolean {
  return _restoring;
}

export function getRestoreError(): string | null {
  return _restoreError;
}

function _setRestoring(on: boolean, error: string | null = null): void {
  _restoring = on;
  _restoreError = error;
  _listeners.forEach((cb) => cb());
}

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function openBoardDb(name: string): Promise<IDBDatabase> {
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
 *  data. The editor in THIS tab is already unmounted when this runs. */
function deleteDb(name: string): Promise<void> {
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
 *  but never opened (they have no database yet). */
async function existingDbNames(): Promise<Set<string> | null> {
  if (!('databases' in indexedDB)) return null; // unsupported → caller opens blind
  const dbs = await indexedDB.databases();
  return new Set(dbs.map((d) => d.name).filter((n): n is string => !!n));
}

// ─── base64 helpers (Blob-safe, no fetch round-trip) ────────────────────────

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ─── Export ──────────────────────────────────────────────────────────────────

export interface BackupResult {
  boards: number;
  assets: number;
  /** Assets referenced by a card but no longer on the server (skipped). */
  missingAssets: number;
}

async function readBoardDocument(
  board: Board,
  present: Set<string> | null,
): Promise<Pick<BackupBoard, 'records' | 'schema' | 'localAssets'>> {
  const dbName = DB_PREFIX + boardPersistenceKey(board.id);
  if (present && !present.has(dbName)) return { records: [], schema: null, localAssets: [] };
  const db = await openBoardDb(dbName);
  try {
    const tx = db.transaction(['records', 'schema', 'assets'], 'readonly');
    const records = (await req(tx.objectStore('records').getAll())) as BackupBoard['records'];
    const schema = ((await req(tx.objectStore('schema').get('schema'))) ?? null) as unknown;
    const assetStore = tx.objectStore('assets');
    const assetKeys = (await req(assetStore.getAllKeys())) as string[];
    const localAssets: BackupBlob[] = [];
    for (const key of assetKeys) {
      const blob = (await req(assetStore.get(key))) as Blob | undefined;
      if (blob instanceof Blob) {
        localAssets.push({ id: String(key), type: blob.type, b64: await blobToB64(blob) });
      }
    }
    return { records, schema, localAssets };
  } finally {
    db.close();
  }
}

/** Every server blob-store id referenced anywhere in the given records. */
function referencedAssetIds(boards: BackupBoard[]): string[] {
  const ids = new Set<string>();
  for (const board of boards) {
    for (const match of JSON.stringify(board.records).matchAll(ASSET_URL_RE)) {
      ids.add(match[1]!);
    }
  }
  return [...ids];
}

/** Gather everything into a backup file and hand it to the browser as a
 *  download. Returns counts for the UI to report honestly. */
export async function exportBackup(): Promise<BackupResult> {
  const boards = getBoards();
  const present = await existingDbNames();

  const backupBoards: BackupBoard[] = [];
  for (const board of boards) {
    const doc = await readBoardDocument(board, present);
    backupBoards.push({
      id: board.id,
      name: board.name,
      createdAt: board.createdAt,
      isNew: board.isNew,
      ...doc,
    });
  }

  const serverAssets: BackupBlob[] = [];
  let missingAssets = 0;
  for (const id of referencedAssetIds(backupBoards)) {
    try {
      const res = await fetch(`/api/assets/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      serverAssets.push({ id, type: blob.type, b64: await blobToB64(blob) });
    } catch {
      missingAssets += 1; // gone from the server — back up the board anyway
    }
  }

  const backup: JarwizBackup = {
    app: 'jarwiz',
    kind: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    activeBoardId: getActiveBoardId(),
    boards: backupBoards,
    serverAssets,
  };

  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jarwiz-backup-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return { boards: backupBoards.length, assets: serverAssets.length, missingAssets };
}

// ─── Parse / validate ────────────────────────────────────────────────────────

/** Parse a backup file's text, throwing a user-readable error if it isn't a
 *  Jarwiz backup we can restore. Never trust the file's shape. */
export function parseBackup(text: string): JarwizBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not readable as JSON.');
  }
  const b = parsed as Partial<JarwizBackup>;
  if (b?.app !== 'jarwiz' || b.kind !== 'backup') {
    throw new Error('That file is not a Jarwiz backup.');
  }
  if (b.version !== 1) {
    throw new Error('This backup was made by a newer Jarwiz — update the app first.');
  }
  if (!Array.isArray(b.boards) || b.boards.length === 0) {
    throw new Error('This backup contains no boards.');
  }
  for (const board of b.boards) {
    const ok =
      board &&
      typeof board.id === 'string' &&
      typeof board.name === 'string' &&
      typeof board.createdAt === 'number' &&
      Array.isArray(board.records) &&
      board.records.every((r) => r && typeof r.id === 'string');
    if (!ok) throw new Error('This backup file is damaged (a board entry is malformed).');
  }
  if (!Array.isArray(b.serverAssets)) {
    throw new Error('This backup file is damaged (missing asset section).');
  }
  return b as JarwizBackup;
}

// ─── Restore ─────────────────────────────────────────────────────────────────

async function writeBoardDocument(board: BackupBoard): Promise<void> {
  if (board.records.length === 0 && board.schema == null) return; // never opened
  const db = await openBoardDb(DB_PREFIX + boardPersistenceKey(board.id));
  try {
    const tx = db.transaction(['records', 'schema', 'assets'], 'readwrite');
    const records = tx.objectStore('records');
    for (const record of board.records) await req(records.put(record, record.id));
    if (board.schema != null) await req(tx.objectStore('schema').put(board.schema, 'schema'));
    const assets = tx.objectStore('assets');
    for (const asset of board.localAssets ?? []) {
      await req(assets.put(b64ToBlob(asset.b64, asset.type), asset.id));
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

/**
 * Replace the whole workspace with the backup, then reload. Destructive by
 * design — the caller confirms with the user first. If it fails midway the
 * flag store carries the error so the restore splash can report it honestly
 * (state may be partially replaced; the reload button shows what survived).
 */
export async function restoreBackup(backup: JarwizBackup): Promise<void> {
  _setRestoring(true);
  try {
    // Let React unmount the canvas so tldraw releases its database connection.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Re-upload server assets first (non-destructive; card URLs keep working).
    // Best-effort: a missing server shouldn't block getting the boards back.
    for (const asset of backup.serverAssets) {
      try {
        await fetch(`/api/assets/${asset.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': asset.type || 'application/octet-stream' },
          body: b64ToBlob(asset.b64, asset.type),
        });
      } catch {
        /* offline / server gone — boards still restore */
      }
    }

    // Drop every board database this profile knows about (current workspace
    // AND ids arriving from the backup), then write the backup's documents.
    const names = new Set<string>();
    for (const b of getBoards()) names.add(DB_PREFIX + boardPersistenceKey(b.id));
    for (const b of backup.boards) names.add(DB_PREFIX + boardPersistenceKey(b.id));
    for (const name of names) await deleteDb(name);
    for (const board of backup.boards) await writeBoardDocument(board);

    // Metadata last — if anything above threw, the old board list still points
    // at whatever data survived.
    const boards: Board[] = backup.boards.map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      isNew: !!b.isNew,
    }));
    const activeId = boards.some((b) => b.id === backup.activeBoardId)
      ? backup.activeBoardId
      : boards[0]!.id;
    writeBoardsForRestore(boards, activeId);

    window.location.reload();
  } catch (err) {
    _setRestoring(true, err instanceof Error ? err.message : 'Restore failed unexpectedly.');
  }
}
