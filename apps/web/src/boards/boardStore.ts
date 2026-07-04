/**
 * Board metadata — multi-board state persisted to localStorage.
 * Each board gets a unique tldraw persistenceKey; tldraw handles the per-board
 * snapshot automatically. Switching boards forces a React key-remount of the
 * Tldraw component so the new persistenceKey takes effect cleanly.
 *
 * The first board reuses "jarwiz-pdf-v2" so existing canvas data is preserved
 * on upgrade. All subsequent boards use "jz-tldraw-{id}".
 */

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  /** True until the user completes (or dismisses) the onboarding dialog. */
  isNew: boolean;
}

const BOARDS_KEY = 'jz-boards-v1';
const ACTIVE_KEY = 'jz-active-board';
const LEGACY_KEY = 'jarwiz-pdf-v2';
const LEGACY_ID = 'legacy';

export function boardPersistenceKey(id: string): string {
  return id === LEGACY_ID ? LEGACY_KEY : `jz-tldraw-${id}`;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── In-memory state ────────────────────────────────────────────────────────

let _boards: Board[] = [];
let _activeId: string = LEGACY_ID;
const _listeners = new Set<() => void>();

function _save(): void {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(_boards));
    localStorage.setItem(ACTIVE_KEY, _activeId);
  } catch {
    /* storage full or private mode — best-effort */
  }
}

function _notify(): void {
  _listeners.forEach((cb) => cb());
}

// ─── Init (called once at module load) ──────────────────────────────────────

/** Validate a persisted entry — localStorage is user-editable and versions
 *  drift, so never trust the parsed JSON's shape. */
function _isBoard(v: unknown): v is Board {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.name === 'string' &&
    typeof b.createdAt === 'number' &&
    typeof b.isNew === 'boolean'
  );
}

function _init(): void {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const boards = Array.isArray(parsed) ? parsed.filter(_isBoard) : [];
      if (boards.length > 0) {
        _boards = boards;
        // The active id must point at a board we actually have; otherwise the
        // app would render a phantom board. Reset to the first board if not.
        const active = localStorage.getItem(ACTIVE_KEY);
        _activeId = active && boards.some((b) => b.id === active) ? active : boards[0]!.id;
        return;
      }
      // Nothing valid survived the filter — treat as corrupted, fall through.
    }
  } catch {
    /* corrupted — fall through to create defaults */
  }
  // First run. Mark the first board `isNew` so a brand-new user gets the
  // "What are you working on?" invitation on first open. An UPGRADING user (who
  // has canvas data from before multi-board) is protected by BoardEntry's
  // isEmpty guard: their board isn't empty, so the dialog never shows and the
  // board is silently marked used. (We can't synchronously detect their tldraw
  // data — it lives in IndexedDB — so the empty-check is the right gate.)
  _boards = [{ id: LEGACY_ID, name: 'My workspace', createdAt: Date.now(), isNew: true }];
  _activeId = LEGACY_ID;
  _save();
}

_init();

// ─── External store API ──────────────────────────────────────────────────────

export function subscribeBoards(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function getBoards(): Board[] {
  return _boards;
}

export function getActiveBoard(): Board | null {
  return _boards.find((b) => b.id === _activeId) ?? null;
}

export function getActivePersistenceKey(): string {
  return boardPersistenceKey(_activeId);
}

export function getActiveBoardId(): string {
  return _activeId;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function createBoard(): Board {
  const board: Board = {
    id: genId(),
    name: 'Untitled board',
    createdAt: Date.now(),
    isNew: true,
  };
  _boards = [..._boards, board];
  _activeId = board.id;
  _save();
  _notify();
  return board;
}

export function switchBoard(id: string): void {
  if (!_boards.find((b) => b.id === id)) return;
  _activeId = id;
  _save();
  _notify();
}

export function renameBoard(id: string, name: string): void {
  _boards = _boards.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b));
  _save();
  _notify();
}

export function deleteBoard(id: string): void {
  if (_boards.length <= 1) return; // can't delete the last board
  const next = _boards.filter((b) => b.id !== id);
  _boards = next;
  if (_activeId === id) _activeId = next[0]!.id;
  // The board's canvas data lives in IndexedDB (tldraw names the database
  // "TLDRAW_DOCUMENT_v2" + persistenceKey) — delete it, best-effort, or every
  // deleted board's shapes are orphaned on disk forever. The old localStorage
  // sweep was a no-op: tldraw never persisted board data there.
  try {
    const key = boardPersistenceKey(id);
    indexedDB.deleteDatabase(`TLDRAW_DOCUMENT_v2${key}`);
  } catch { /* best effort */ }
  _save();
  _notify();
}

export function markBoardUsed(id: string): void {
  _boards = _boards.map((b) => (b.id === id ? { ...b, isNew: false } : b));
  _save();
  _notify();
}
