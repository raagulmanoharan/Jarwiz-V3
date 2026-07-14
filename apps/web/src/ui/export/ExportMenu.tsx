/**
 * Export menu — the header entry point AND the whole export surface. A pill
 * button ("Export ▾") opens a dropdown with two rows:
 *
 *   ✦ As a slideshow      — synthesise the board into a PDF deck
 *   ⌁ Markdown for an LLM  — a comprehensive handoff to continue elsewhere
 *
 * There is no separate modal: each row carries its OWN state inline — idle →
 * a progress bar while it generates → a Download button when ready. The two
 * run INDEPENDENTLY, so the user can trigger both at once. The button lives
 * inside the tldraw overlay (it has the editor); on start it gathers the board
 * and hands it to the export store, which owns the runs.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import type { ExportMode } from '@jarwiz/shared';
import { gatherBoardCards } from '../../agents/boardText';
import { getActiveBoard } from '../../boards/boardStore';
import {
  getExportState,
  retryExport,
  startExport,
  subscribeExport,
  type ExportSlot,
} from './exportStore';
import { downloadText, printDeckToPdf, slugify } from './download';

export function ExportMenu() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const state = useSyncExternalStore(subscribeExport, getExportState, getExportState);
  // Enable as soon as there's anything on the board to read.
  const hasContent = useValue('topbar-can-export', () => editor.getCurrentPageShapes().length > 0, [editor]);
  const anyReady = state.slideshow.phase === 'ready' || state.markdown.phase === 'ready';

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

  // Start a run WITHOUT closing the panel — so its progress shows inline and the
  // other mode can be started too.
  const start = (mode: ExportMode) => {
    const cards = gatherBoardCards(editor);
    const title = getActiveBoard()?.name ?? 'Untitled board';
    startExport(mode, cards, title);
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
        {anyReady && !open ? <span className="jz-export-dot" aria-hidden /> : null}
        <ChevronDown className="jz-export-caret" />
      </button>
      {open ? (
        <div className="jz-export-menu" role="menu">
          <ExportRow
            mode="slideshow"
            slot={state.slideshow}
            title={state.title}
            icon={<SlidesGlyph />}
            label="As a slideshow"
            sub="A presentation-ready PDF deck built from your board"
            onStart={() => start('slideshow')}
          />
          <ExportRow
            mode="markdown"
            slot={state.markdown}
            title={state.title}
            icon={<DocGlyph />}
            label="Markdown for another LLM"
            sub="A comprehensive handoff to continue elsewhere"
            onStart={() => start('markdown')}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One export row: its whole lifecycle (idle → progress → download) inline. */
function ExportRow({
  mode,
  slot,
  title,
  icon,
  label,
  sub,
  onStart,
}: {
  mode: ExportMode;
  slot: ExportSlot;
  title: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
  onStart: () => void;
}) {
  // A smoothly-easing bar while working: we can't know the true duration, so it
  // decelerates toward ~92% and completes when the row flips to 'ready'.
  const [pct, setPct] = useState(8);
  useEffect(() => {
    if (slot.phase !== 'working') {
      setPct(slot.phase === 'ready' ? 100 : 8);
      return;
    }
    setPct(8);
    const id = window.setInterval(() => setPct((p) => (p >= 92 ? p : p + (92 - p) * 0.08)), 350);
    return () => window.clearInterval(id);
  }, [slot.phase]);

  const download = () => {
    if (mode === 'slideshow') printDeckToPdf(slot.text);
    else downloadText(slot.text, `${slugify(title)}.md`, 'text/markdown');
  };

  // The trailing action morphs with state: + (kick off) → spinner → ↓ (download).
  const action =
    slot.phase === 'working' ? (
      <span className="jz-icon-btn jz-icon-btn--busy" aria-label="Generating" role="status">
        <span className="jz-spinner" />
      </span>
    ) : slot.phase === 'ready' ? (
      <button
        className="jz-icon-btn jz-icon-btn--go"
        onClick={download}
        title={mode === 'slideshow' ? 'Download PDF' : 'Download .md'}
        aria-label={mode === 'slideshow' ? 'Download PDF' : 'Download markdown'}
      >
        <DownloadIcon />
      </button>
    ) : slot.phase === 'error' ? (
      <button className="jz-icon-btn" onClick={() => retryExport(mode)} title="Try again" aria-label="Try again">
        <RetryIcon />
      </button>
    ) : (
      <button
        className="jz-icon-btn"
        onClick={onStart}
        title={`Build the ${mode === 'slideshow' ? 'slideshow' : 'markdown'}`}
        aria-label={`Build the ${mode === 'slideshow' ? 'slideshow' : 'markdown'}`}
      >
        <PlusIcon />
      </button>
    );

  // The secondary line under the title reflects state.
  const secondary =
    slot.phase === 'working' ? (
      <>
        <span className="jz-export-item-progress" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="jz-export-item-status">{slot.status || 'Working…'}</span>
      </>
    ) : slot.phase === 'ready' ? (
      <span className="jz-export-item-sub">
        {mode === 'slideshow' ? 'Ready — download as PDF' : 'Ready — download .md'}
      </span>
    ) : slot.phase === 'error' ? (
      <span className="jz-export-item-err">{slot.error}</span>
    ) : (
      <span className="jz-export-item-sub">{sub}</span>
    );

  return (
    <div className={`jz-export-item${slot.phase !== 'idle' ? ' jz-export-item--active' : ''}`} role="menuitem">
      <span className="jz-export-item-icon">{icon}</span>
      <span className="jz-export-item-text">
        <span className="jz-export-item-title">{label}</span>
        {secondary}
      </span>
      <span className="jz-export-item-action">{action}</span>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M12 15l-4-4M12 15l4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </svg>
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

/** Presentation screen — the slideshow row. */
function SlidesGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M12 16v3M9 21h6" />
    </svg>
  );
}

/** Document with a corner fold + text lines — the markdown row. */
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
