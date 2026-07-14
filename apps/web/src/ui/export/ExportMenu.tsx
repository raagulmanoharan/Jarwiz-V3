/**
 * Export menu — the header entry point. A pill button ("Export ▾") beside the
 * zoom control that opens a two-item menu:
 *
 *   ✦ As a slideshow      — synthesise the board into a slick HTML deck
 *   ⌁ Markdown for an LLM  — a comprehensive handoff another model can continue
 *
 * The button lives inside the tldraw overlay (Topbar), so it has the editor:
 * on pick it gathers the board's cards and hands them to the export store,
 * which owns the run and drives the modal. Disabled while the board is empty —
 * there's nothing to export yet.
 */

import { useEffect, useRef, useState } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import type { ExportMode } from '@jarwiz/shared';
import { gatherBoardCards } from '../../agents/boardText';
import { getActiveBoard } from '../../boards/boardStore';
import { openExport } from './exportStore';

export function ExportMenu() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Enable as soon as there's anything on the board to read.
  const hasContent = useValue('topbar-can-export', () => editor.getCurrentPageShapes().length > 0, [editor]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const start = (mode: ExportMode) => {
    setOpen(false);
    const cards = gatherBoardCards(editor);
    const title = getActiveBoard()?.name ?? 'Untitled board';
    openExport(mode, cards, title);
  };

  return (
    <div className="jz-export-wrap" ref={wrapRef} onPointerDown={stopEventPropagation}>
      <button
        className={`jz-export-btn${open ? ' jz-export-btn--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={!hasContent}
        title={hasContent ? 'Export this board' : 'Add something to the board to export it'}
        aria-label="Export this board"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ExportGlyph />
        <span className="jz-export-btn-label">Export</span>
        <ChevronDown className="jz-export-caret" />
      </button>
      {open ? (
        <div className="jz-export-menu" role="menu">
          <button className="jz-export-item" role="menuitem" onClick={() => start('slideshow')}>
            <span className="jz-export-item-icon"><SlidesGlyph /></span>
            <span className="jz-export-item-text">
              <span className="jz-export-item-title">As a slideshow</span>
              <span className="jz-export-item-sub">A presentation-ready PDF deck built from your board</span>
            </span>
          </button>
          <button className="jz-export-item" role="menuitem" onClick={() => start('markdown')}>
            <span className="jz-export-item-icon"><DocGlyph /></span>
            <span className="jz-export-item-text">
              <span className="jz-export-item-title">Markdown for another LLM</span>
              <span className="jz-export-item-sub">A comprehensive handoff to continue elsewhere</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Box with an up-arrow — the "send this out" mark. */
function ExportGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V4M12 4l-4 4M12 4l4 4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Presentation screen — the slideshow item. */
function SlidesGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M12 16v3M9 21h6" />
    </svg>
  );
}

/** Document with a corner fold + text lines — the markdown item. */
function DocGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M14 2v4h4M8 12h8M8 16h8M8 8h3" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
