/**
 * Board-wide search (review backlog G6) — a tool-rail icon that opens a small
 * flyout: type, see matching cards (title + a snippet around the hit), pick
 * one and the camera jumps to it selected. Before this, the only magnifier on
 * screen was the zoom menu — fine at 3 cards, dead at 40.
 *
 * The search is a plain local scan over the board's text-bearing shapes on
 * every keystroke (boards are hundreds of shapes at most — no index needed).
 * ⌘K / Ctrl-K opens it from anywhere; Escape or clicking away closes.
 */

import { useEffect, useRef, useState } from 'react';
import { stopEventPropagation, useEditor, type Editor, type TLShapeId } from 'tldraw';
import { Search } from 'lucide-react';
import { getShapeTitle } from '../shapes/shapeTitle';
import { bringIntoView } from './bringIntoView';

const MAX_RESULTS = 12;
const SNIPPET = 64;

interface Hit {
  id: TLShapeId;
  title: string;
  kind: string;
  snippet: string;
  /** Title hits rank above body hits. */
  inTitle: boolean;
}

const KIND_LABEL: Record<string, string> = {
  'doc-card': 'Text', 'note-card': 'Sticky', 'table-card': 'Table', 'diagram-card': 'Diagram',
  'prototype-card': 'Prototype', 'link-card': 'Link', 'pdf-card': 'PDF', 'youtube-card': 'Video',
  'image-card': 'Image', 'sheet-card': 'Sheet', 'dashboard-card': 'Dashboard',
};

/** The searchable body text of a shape, by what each card kind actually holds. */
function bodyText(shape: NonNullable<ReturnType<Editor['getShape']>>): string {
  const p = shape.props as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (shape.type === 'table-card') {
    const cols = Array.isArray(p.columns) ? (p.columns as string[]).join(' ') : '';
    const rows = Array.isArray(p.rows) ? (p.rows as string[][]).map((r) => r.join(' ')).join(' ') : '';
    return `${cols} ${rows}`;
  }
  if (shape.type === 'diagram-card') return str(p.code);
  if (shape.type === 'link-card') return `${str(p.description)} ${str(p.url)}`;
  return str(p.text) || str(p.name);
}

function searchBoard(editor: Editor, query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (!KIND_LABEL[shape.type]) continue;
    const title = getShapeTitle(shape).trim();
    const body = bodyText(shape);
    const inTitle = title.toLowerCase().includes(q);
    const at = body.toLowerCase().indexOf(q);
    if (!inTitle && at === -1) continue;
    const snippet =
      at === -1
        ? body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET)
        : `${at > 8 ? '…' : ''}${body.slice(Math.max(0, at - 24), at + q.length + SNIPPET - 24).replace(/\s+/g, ' ').trim()}`;
    hits.push({ id: shape.id, title: title || KIND_LABEL[shape.type]!, kind: KIND_LABEL[shape.type]!, snippet, inTitle });
  }
  return hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle)).slice(0, MAX_RESULTS);
}

export function BoardSearchRail() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = open ? searchBoard(editor, q) : [];
  const active = Math.min(idx, Math.max(0, hits.length - 1));

  // Focus the input on open; reset the query on close so each search is fresh.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  // Escape / clicking away closes; ⌘K / Ctrl-K opens from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    if (open) window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  const jump = (id: TLShapeId) => {
    setOpen(false);
    editor.setCurrentTool('select');
    editor.select(id);
    bringIntoView(editor, id);
  };

  return (
    <div className="jz-search" ref={wrapRef} onPointerDown={stopEventPropagation}>
      <button
        className={`jz-rail-tool${open ? ' jz-rail-tool--active' : ''}`}
        title="Search the board (⌘K)"
        aria-label="Search the board"
        onClick={() => setOpen((v) => !v)}
      >
        <Search size={18} strokeWidth={1.7} />
      </button>
      {open ? (
        <div className="jz-search-panel">
          <input
            ref={inputRef}
            className="jz-search-input"
            value={q}
            placeholder="Search cards…"
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && hits[active]) jump(hits[active]!.id);
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {q.trim().length >= 2 ? (
            hits.length ? (
              <div className="jz-search-list" role="listbox">
                {hits.map((h, i) => (
                  <button
                    key={h.id}
                    className={`jz-search-row${i === active ? ' jz-search-row--active' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => jump(h.id)}
                  >
                    <span className="jz-search-row-title">{h.title}</span>
                    <span className="jz-search-row-meta">{h.kind}</span>
                    {h.snippet ? <span className="jz-search-row-snippet">{h.snippet}</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="jz-search-empty">Nothing on the board matches.</div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
