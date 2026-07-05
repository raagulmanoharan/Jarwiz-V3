/**
 * The new-board invitation — appears over an empty, newly-created board and
 * walks the user through naming their project and picking a starting structure.
 * Disappears permanently once they submit or the first shape lands.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import {
  getActiveBoard,
  markBoardUsed,
  renameBoard,
  subscribeBoards,
} from './boardStore';
import { applyTemplate, TEMPLATES } from './templates';

export function BoardEntry() {
  const editor = useEditor();
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const isEmpty = useValue('board-empty', () => editor.getCurrentPageShapeIds().size === 0, [editor]);

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string>('blank');
  const inputRef = useRef<HTMLInputElement>(null);
  // Let tldraw hydrate from IndexedDB before we trust `isEmpty` — otherwise an
  // upgrading user's canvas (which loads async) could flash the dialog for a
  // frame before their shapes register. Newly-created boards re-arm via key.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(false);
    const t = setTimeout(() => setHydrated(true), 400);
    return () => clearTimeout(t);
  }, [board?.id]);

  // Auto-clear isNew when the board gains its first shape (bypass path — e.g.
  // user drags a PDF in without going through the dialog).
  useEffect(() => {
    if (!isEmpty && board?.isNew) markBoardUsed(board.id);
  }, [isEmpty, board]);

  useEffect(() => {
    if (hydrated && board?.isNew && isEmpty) setTimeout(() => inputRef.current?.focus(), 80);
  }, [board?.id, board?.isNew, isEmpty, hydrated]);

  if (!hydrated || !board?.isNew || !isEmpty) return null;

  const submit = () => {
    const projectName = name.trim();
    if (projectName) renameBoard(board.id, projectName);
    markBoardUsed(board.id);

    if (selected !== 'blank') {
      applyTemplate(editor, selected, projectName);
    }
    // "Start blank" means a truly blank canvas. The old starter doc card was
    // permanent clutter — and, being empty, a poisoned grounding source for
    // the first ask (docs/TEST-REPORT.md 2026-07-04, findings #1/#2).
  };

  return (
    <div className="jz-boardentry-scrim" onPointerDown={stopEventPropagation}>
      <div className="jz-boardentry" role="dialog" aria-modal aria-label="Start a new board">
        <div className="jz-boardentry-spark" aria-hidden>✦</div>
        <h2 className="jz-boardentry-heading">What are you working on?</h2>
        <p className="jz-boardentry-sub">Give your board a name, then pick a starting structure.</p>

        <input
          ref={inputRef}
          className="jz-boardentry-input"
          value={name}
          placeholder="e.g. Auth revamp, Q3 planning, Onboarding v3…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { markBoardUsed(board.id); } }}
        />

        <div className="jz-boardentry-templates">
          <button
            className={`jz-tpl-chip${selected === 'blank' ? ' jz-tpl-chip--selected' : ''}`}
            onClick={() => setSelected('blank')}
          >
            <span className="jz-tpl-chip-emoji">✦</span>
            <span className="jz-tpl-chip-label">Start blank</span>
          </button>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`jz-tpl-chip${selected === t.id ? ' jz-tpl-chip--selected' : ''}`}
              title={t.description}
              onClick={() => setSelected(t.id)}
            >
              <span className="jz-tpl-chip-emoji">{t.emoji}</span>
              <span className="jz-tpl-chip-label">{t.label}</span>
            </button>
          ))}
        </div>

        {selected !== 'blank' && (
          <p className="jz-boardentry-tpl-desc">
            {TEMPLATES.find((t) => t.id === selected)?.description}
          </p>
        )}

        <div className="jz-boardentry-actions">
          <button
            className="jz-boardentry-skip"
            onClick={() => markBoardUsed(board.id)}
          >
            Skip
          </button>
          <button className="jz-boardentry-submit" onClick={submit}>
            {selected === 'blank' ? 'Start writing' : `Use ${TEMPLATES.find(t => t.id === selected)?.label ?? 'template'}`} →
          </button>
        </div>
      </div>
    </div>
  );
}
