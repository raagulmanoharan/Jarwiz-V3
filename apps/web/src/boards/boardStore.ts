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

function _init(): void {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw) {
      _boards = JSON.parse(raw) as Board[];
      _activeId = localStorage.getItem(ACTIVE_KEY) ?? _boards[0]?.id ?? LEGACY_ID;
      return;
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
  // Remove the tldraw snapshot from localStorage too.
  if (id !== LEGACY_ID) {
    try {
      // tldraw stores its data under keys prefixed with "tldraw_" + persistenceKey
      const prefix = boardPersistenceKey(id);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(prefix) || key.includes(prefix)) localStorage.removeItem(key);
      }
    } catch { /* best effort */ }
  }
  _save();
  _notify();
}

export function markBoardUsed(id: string): void {
  _boards = _boards.map((b) => (b.id === id ? { ...b, isNew: false } : b));
  _save();
  _notify();
}
