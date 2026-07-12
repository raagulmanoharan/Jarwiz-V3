/**
 * Boards side panel — DOCKED to the app shell's left edge, pushing the canvas
 * aside rather than floating over it (owner call, 2026-07-11; it used to be a
 * floating drawer). Hosts the workspace switcher, the board list, and
 * backup/restore — opened by the hamburger logo or the title caret, closed by
 * the same toggle or Escape. Lives beside the Tldraw tree in App (not in the
 * overlay slot): the app shell is a flex row and tldraw re-measures as the
 * panel's width animates in.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  createBoard,
  deleteBoard,
  getActiveBoardId,
  getBoards,
  renameBoard,
  subscribeBoards,
  switchBoard,
} from '../boards/boardStore';
import { exportBackup, parseBackup, restoreBackup, type JarwizBackup } from '../boards/backup';
import { searchBoardContents } from '../boards/boardSearch';
import { closeSidePanel, isSidePanelOpen, subscribeSidePanel } from './sidePanelStore';
import { DemoAccessCard } from './DemoAccess';

export function SidePanel() {
  const open = useSyncExternalStore(subscribeSidePanel, isSidePanelOpen, isSidePanelOpen);

  // Escape closes. (No click-outside/scrim: a docked panel is a workspace
  // column, not a popover — it holds its ground until toggled away.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Always mounted: the container's width animates 0 ↔ 300px so the canvas is
  // pushed smoothly; visibility (in CSS) drops closed content from tab order.
  return (
    <aside
      className={`jz-side${open ? ' jz-side--open' : ''}`}
      role="complementary"
      aria-label="Workspace & boards"
      aria-hidden={!open}
    >
      <div className="jz-side-inner">
        <WorkspaceSection />
        <div className="jz-side-divider" aria-hidden />
        <BoardsSection />
        <div className="jz-side-divider" aria-hidden />
        <BackupSection />
        <DemoAccessCard />
      </div>
    </aside>
  );
}

function WorkspaceSection() {
  // Stub — workspace management isn't wired up yet. The list is shown for the
  // affordance; the only switcher behaviour is the active highlight.
  const workspaces = [{ id: 'personal', name: 'Personal workspace' }];
  const activeWs = 'personal';
  return (
    <section className="jz-side-section">
      <header className="jz-side-section-header">
        <span className="jz-side-section-title">Workspace</span>
      </header>
      <ul className="jz-side-list">
        {workspaces.map((ws) => (
          <li key={ws.id}>
            <button
              className={`jz-side-item${ws.id === activeWs ? ' jz-side-item--active' : ''}`}
              onClick={() => console.info('[jarwiz] workspace switching is not wired up yet')}
            >
              <WorkspaceGlyph />
              <span className="jz-side-item-name">{ws.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BoardsSection() {
  const boards = useSyncExternalStore(subscribeBoards, getBoards, getBoards);
  const activeId = useSyncExternalStore(subscribeBoards, getActiveBoardId, getActiveBoardId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Deleting a board destroys its canvas permanently — arm the trash button on
  // first click ("Sure?") and only delete on a second click within 3s.
  const [armedId, setArmedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Search across boards (ROADMAP §10 #7): title matches filter instantly;
  // content matches (read from each board's database) merge in when the
  // debounced search lands, each with a snippet under the board's name.
  const [query, setQuery] = useState('');
  const [contentHits, setContentHits] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setContentHits(new Map());
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      void searchBoardContents(q, boards).then((hits) => {
        if (!stale) setContentHits(hits);
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, boards]);

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraft(name);
  };
  const commitRename = (id: string) => {
    renameBoard(id, draft);
    setEditingId(null);
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? boards.filter((b) => b.name.toLowerCase().includes(q) || contentHits.has(b.id))
    : boards;

  return (
    <section className="jz-side-section">
      <header className="jz-side-section-header">
        <span className="jz-side-section-title">Boards</span>
        <button
          className="jz-side-new"
          onClick={() => {
            createBoard();
            closeSidePanel();
          }}
          title="Create a new board"
        >
          <PlusGlyph /> New
        </button>
      </header>
      {boards.length > 1 ? (
        <div className="jz-side-searchrow">
          <SearchGlyph />
          <input
            className="jz-side-search"
            type="search"
            placeholder="Search boards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // Escape clears the field, not the panel
              if (e.key === 'Escape') setQuery('');
            }}
            aria-label="Search boards by title or content"
          />
        </div>
      ) : null}
      {q && visible.length === 0 ? (
        <p className="jz-side-note">No boards match “{query.trim()}”.</p>
      ) : null}
      <ul className="jz-side-list">
        {visible.map((b) => {
          const isActive = b.id === activeId;
          const isEditing = editingId === b.id;
          return (
            <li key={b.id} className="jz-side-row">
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="jz-side-rename"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(b.id)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitRename(b.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <button
                  className={`jz-side-item${isActive ? ' jz-side-item--active' : ''}`}
                  onClick={() => {
                    // Clicking the board you're already on shouldn't close the
                    // panel — it would also make double-click-to-rename
                    // unreachable (the first click would dismiss the panel
                    // before the second lands).
                    if (b.id === activeId) return;
                    switchBoard(b.id);
                    closeSidePanel();
                  }}
                  onDoubleClick={() => startRename(b.id, b.name)}
                  title="Click to switch · double-click to rename"
                >
                  <BoardGlyph />
                  <span className="jz-side-item-text">
                    <span className="jz-side-item-name">{b.name}</span>
                    {q && contentHits.has(b.id) ? (
                      <span className="jz-side-item-snippet">{contentHits.get(b.id)}</span>
                    ) : null}
                  </span>
                </button>
              )}
              {!isEditing && (
                <div className="jz-side-row-actions">
                  <button
                    className="jz-side-action"
                    title="Rename"
                    onClick={() => startRename(b.id, b.name)}
                    aria-label={`Rename ${b.name}`}
                  >
                    <PencilGlyph />
                  </button>
                  {boards.length > 1 && (
                    <button
                      className="jz-side-action jz-side-action--danger"
                      title={armedId === b.id ? 'Click again to delete permanently' : 'Delete board'}
                      onClick={() => {
                        if (armedId === b.id) {
                          setArmedId(null);
                          deleteBoard(b.id);
                        } else {
                          setArmedId(b.id);
                        }
                      }}
                      aria-label={armedId === b.id ? `Confirm delete ${b.name}` : `Delete ${b.name}`}
                    >
                      {armedId === b.id ? <span className="jz-side-confirm">Sure?</span> : <TrashGlyph />}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Backup & restore — the whole workspace lives in this browser profile, so
 *  "save it to a file" is the only insurance. Restore is a full replace and
 *  is confirmed inline before anything is touched (backup.ts does the rest,
 *  ending in a reload). */
function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<JarwizBackup | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Status notes are transient; errors stay until the next action.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const onBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await exportBackup();
      const files = r.assets ? ` · ${r.assets} file${r.assets === 1 ? '' : 's'}` : '';
      const missing = r.missingAssets ? ` · ${r.missingAssets} missing on server` : '';
      setNote(`Backed up ${r.boards} board${r.boards === 1 ? '' : 's'}${files}${missing}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File) => {
    setError(null);
    setNote(null);
    try {
      setPending(parseBackup(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  return (
    <section className="jz-side-section">
      <header className="jz-side-section-header">
        <span className="jz-side-section-title">Backup</span>
      </header>
      {pending ? (
        <div className="jz-side-restore" role="alertdialog" aria-label="Confirm restore">
          <p className="jz-side-restore-text">
            Replace everything with {pending.boards.length} board
            {pending.boards.length === 1 ? '' : 's'} from{' '}
            {new Date(pending.exportedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
            ? Your current boards will be lost.
          </p>
          <div className="jz-side-restore-actions">
            <button className="jz-side-restore-go" onClick={() => void restoreBackup(pending)}>
              Restore
            </button>
            <button className="jz-side-restore-cancel" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <ul className="jz-side-list">
          <li>
            <button className="jz-side-item" disabled={busy} onClick={() => void onBackup()}>
              <DownloadGlyph />
              <span className="jz-side-item-name">{busy ? 'Backing up…' : 'Back up to file'}</span>
            </button>
          </li>
          <li>
            <button className="jz-side-item" onClick={() => fileRef.current?.click()}>
              <UploadGlyph />
              <span className="jz-side-item-name">Restore from backup…</span>
            </button>
          </li>
        </ul>
      )}
      {(error || note) && (
        <p className={`jz-side-note${error ? ' jz-side-note--danger' : ''}`}>{error ?? note}</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // allow re-picking the same file
          if (file) void onPickFile(file);
        }}
      />
    </section>
  );
}

// ─── Inline glyphs ─────────────────────────────────────────────────────────

function WorkspaceGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
    </svg>
  );
}

function BoardGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 4v16" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V4M7 9l5-5 5 5M4 20h16" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l4-1 11-11a2 2 0 0 0-3-3L5 16z" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}
