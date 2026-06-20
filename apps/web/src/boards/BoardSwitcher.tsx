/**
 * Floating board-list panel. Appears below the board chip in the topbar.
 * Create, switch, inline-rename, and delete boards from here.
 */

import { useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation } from 'tldraw';
import {
  createBoard,
  deleteBoard,
  getActiveBoardId,
  getBoards,
  renameBoard,
  subscribeBoards,
  switchBoard,
} from './boardStore';

export function BoardSwitcher({ onClose }: { onClose: () => void }) {
  const boards = useSyncExternalStore(subscribeBoards, getBoards, getBoards);
  const activeId = useSyncExternalStore(subscribeBoards, getActiveBoardId, getActiveBoardId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    createBoard();
    onClose();
  };

  const handleSwitch = (id: string) => {
    switchBoard(id);
    onClose();
  };

  const startRename = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditName(name);
    setTimeout(() => renameRef.current?.focus(), 20);
  };

  const commitRename = (id: string) => {
    renameBoard(id, editName);
    setEditingId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteBoard(id);
  };

  return (
    <div className="jz-bsw" onPointerDown={stopEventPropagation} role="dialog" aria-label="Board list">
      <div className="jz-bsw-header">
        <span className="jz-bsw-title">Boards</span>
        <button className="jz-bsw-new" onClick={handleCreate}>+ New</button>
      </div>
      <ul className="jz-bsw-list">
        {boards.map((b) => (
          <li
            key={b.id}
            className={`jz-bsw-item${b.id === activeId ? ' jz-bsw-item--active' : ''}`}
          >
            {editingId === b.id ? (
              <input
                ref={renameRef}
                className="jz-bsw-rename"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(b.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <button className="jz-bsw-name" onClick={() => handleSwitch(b.id)}>
                {b.name}
              </button>
            )}
            <div className="jz-bsw-actions">
              <button
                className="jz-bsw-action"
                title="Rename"
                onClick={(e) => startRename(b.id, b.name, e)}
              >
                ✎
              </button>
              {boards.length > 1 && (
                <button
                  className="jz-bsw-action jz-bsw-action--del"
                  title="Delete board"
                  onClick={(e) => handleDelete(b.id, e)}
                >
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
