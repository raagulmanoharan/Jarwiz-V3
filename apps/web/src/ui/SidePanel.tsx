/**
 * Left-edge side panel (Flora / Figma-style drawer). Hosts the workspace
 * switcher and the board list — opened by the hamburger logo or the title
 * caret. Click-outside or Escape closes.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation } from 'tldraw';
import {
  createBoard,
  deleteBoard,
  getActiveBoardId,
  getBoards,
  renameBoard,
  subscribeBoards,
  switchBoard,
} from '../boards/boardStore';
import { closeSidePanel, isSidePanelOpen, subscribeSidePanel } from './sidePanelStore';

export function SidePanel() {
  const open = useSyncExternalStore(subscribeSidePanel, isSidePanelOpen, isSidePanelOpen);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Click-outside closes. Don't close if the user clicks the hamburger itself
  // — that button toggles, and we'd race with its handler.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (t.closest('.jz-logo-btn')) return;
      closeSidePanel();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="jz-side-scrim" onMouseDown={() => closeSidePanel()} aria-hidden />
      <aside
        ref={panelRef}
        className="jz-side"
        role="dialog"
        aria-label="Workspace & boards"
        onPointerDown={stopEventPropagation}
      >
        <WorkspaceSection />
        <div className="jz-side-divider" aria-hidden />
        <BoardsSection />
      </aside>
    </>
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
      <ul className="jz-side-list">
        {boards.map((b) => {
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
                    switchBoard(b.id);
                    closeSidePanel();
                  }}
                  onDoubleClick={() => startRename(b.id, b.name)}
                  title="Click to switch · double-click to rename"
                >
                  <BoardGlyph />
                  <span className="jz-side-item-name">{b.name}</span>
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
