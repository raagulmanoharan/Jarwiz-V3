/**
 * Compose (board fan-out), client side. Ask the server to plan a set of cards
 * from the board, then stream each one in — reusing the Ask event vocabulary
 * (card.create / delta / table.cell) per slot, so composed cards are identical
 * to hand-typed ones.
 *
 * Layout: cards sit SIDE BY SIDE in one row at a common top edge, flowing left
 * to right. Widths are fixed (doc = DOC_W, table ∝ column count) and compose
 * cards are NOT marked "streaming" — so the page-shaping width-grow never fires
 * and can't bump a neighbour. Fixed widths + shared top = cards can never
 * overlap, whatever each one's final height.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type Box, type Editor, type TLShape, type TLShapeId } from 'tldraw';
import type { ComposeEvent } from '@jarwiz/shared';
import { DIAGRAM_CARD_SIZE, DOC_CARD_SIZE, TABLE_CARD_SIZE, UIMOCKUP_CARD_SIZE, type DiagramCardShape, type DocCardShape, type TableCardShape, type UiMockupCardShape } from '../shapes';
import { setShapeTitle } from '../shapes/shapeTitle';
import { readSSE } from './sse';
import { gatherBoardCards } from './boardText';

export type ComposePhase = 'idle' | 'planning' | 'building' | 'done' | 'error';

const DOC_W = 500;
const H_GAP = 48; // between cards, laid side by side in a single row
const CELL_W = 480; // uniform card width in a machine-board grid (e.g. SWOT 2×2)
const V_GAP = 64; // between grid rows — clears the floating title tag above a card

/** A readable table width: ~190px per column, clamped so it's never cramped
 *  (the owner's "less narrow, easier to read, less tall") nor absurdly wide. */
function tableWidth(colCount: number): number {
  return Math.max(460, Math.min(960, colCount * 190));
}

interface Slot {
  cardId?: TLShapeId;
  kind: 'doc' | 'table' | 'diagram' | 'uimockup';
  cols?: string[];
  rows?: string[][];
}

export function useCompose() {
  const editor = useEditor();
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (intent?: string, opts?: { machineId?: string; anchorId?: TLShapeId; options?: string[] }) => {
    if (phase === 'planning' || phase === 'building') return;
    const board = gatherBoardCards(editor);
    if (board.length === 0 && !intent?.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('planning');

    // Origin: beside the anchor (a machine block) when one's given, else a fresh
    // strip to the right of everything on the board.
    const anchor = opts?.anchorId ? editor.getShapePageBounds(opts.anchorId) : null;
    const bounds = editor.getCurrentPageBounds();
    const originX = anchor ? anchor.maxX + 120 : bounds ? bounds.maxX + 120 : editor.getViewportPageBounds().minX + 80;
    const originY = anchor ? anchor.minY : bounds ? bounds.minY : editor.getViewportPageBounds().minY + 80;

    const titles = new Map<number, string>();
    const slots = new Map<number, Slot>();
    const gridPos = new Map<number, { col: number; row: number; span: number }>();
    const created: TLShapeId[] = [];
    let isGrid = false; // a machine board that supplied col/row → grid layout
    let framed = false;

    const relayout = () => {
      if (!isGrid) return shelfPack(editor, created, originX, originY);
      const cells: Array<{ id: TLShapeId; col: number; row: number }> = [];
      for (const [slotIdx, slot] of slots) {
        const g = gridPos.get(slotIdx);
        if (slot.cardId && g) cells.push({ id: slot.cardId, col: g.col, row: g.row });
      }
      gridPack(editor, cells, originX, originY);
    };

    const applySlot = (slotIdx: number, ev: Extract<ComposeEvent, { type: 'slot' }>['event']) => {
      const slot = slots.get(slotIdx);
      switch (ev.type) {
        case 'card.create': {
          const id = createShapeId();
          created.push(id);
          // In a grid, a card's width is its span of cells; else its natural width.
          const g = gridPos.get(slotIdx);
          const gridW = g ? g.span * CELL_W + (g.span - 1) * H_GAP : CELL_W;
          if (ev.shape === 'table') {
            const cols = (ev.columns ?? []).slice(0, 6);
            const rows = Array.from({ length: ev.rowCount ?? 0 }, () => cols.map(() => ''));
            editor.createShape<TableCardShape>({
              id, type: 'table-card', x: originX, y: originY,
              props: { w: isGrid ? gridW : tableWidth(cols.length), h: TABLE_CARD_SIZE.h, columns: cols, rows },
            });
            slots.set(slotIdx, { cardId: id, kind: 'table', cols, rows });
          } else if (ev.shape === 'diagram') {
            editor.createShape<DiagramCardShape>({
              id, type: 'diagram-card', x: originX, y: originY,
              props: { w: isGrid ? gridW : DIAGRAM_CARD_SIZE.w, h: DIAGRAM_CARD_SIZE.h, code: '', title: titles.get(slotIdx) ?? '' },
            });
            slots.set(slotIdx, { cardId: id, kind: 'diagram' });
          } else if (ev.shape === 'uimockup') {
            editor.createShape<UiMockupCardShape>({
              id, type: 'uimockup-card', x: originX, y: originY,
              props: { w: isGrid ? gridW : UIMOCKUP_CARD_SIZE.w, h: UIMOCKUP_CARD_SIZE.h, html: '', title: titles.get(slotIdx) ?? '' },
            });
            slots.set(slotIdx, { cardId: id, kind: 'uimockup' });
          } else {
            editor.createShape<DocCardShape>({
              id, type: 'doc-card', x: originX, y: originY,
              props: { w: isGrid ? gridW : DOC_W, h: DOC_CARD_SIZE.h, title: titles.get(slotIdx) ?? '', text: '', sourcePdfId: '' },
            });
            slots.set(slotIdx, { cardId: id, kind: 'doc' });
          }
          const title = titles.get(slotIdx);
          const shape = editor.getShape(id);
          if (title && shape) setShapeTitle(editor, shape, title);
          relayout(); // place the newcomer after the finished cards
          if (!framed) { framed = true; frame(editor, created); }
          break;
        }
        case 'card.title': // plan titles are authoritative — ignore the generated one
          break;
        case 'card.delta': {
          if (!slot?.cardId) break;
          const s = editor.getShape(slot.cardId);
          if (!s) break;
          if (s.type === 'diagram-card') {
            // Mermaid source streams into `code`; the shape renders it to SVG
            // once it settles (same path as a hand-typed diagram ask).
            editor.updateShape<DiagramCardShape>({
              id: slot.cardId, type: 'diagram-card',
              props: { code: (s.props as { code: string }).code + ev.textDelta },
            });
          } else if (s.type === 'uimockup-card') {
            // HTML streams into `html`; the shape renders it in a sandboxed
            // iframe once it settles (same path as a hand-typed mockup ask).
            editor.updateShape<UiMockupCardShape>({
              id: slot.cardId, type: 'uimockup-card',
              props: { html: (s.props as { html: string }).html + ev.textDelta },
            });
          } else if ('text' in (s.props as object)) {
            editor.updateShape({
              id: slot.cardId, type: s.type,
              props: { text: (s.props as { text: string }).text + ev.textDelta },
            } as Parameters<typeof editor.updateShape>[0]);
          }
          break;
        }
        case 'table.cell': {
          if (!slot?.cardId || !slot.rows?.[ev.r]) break;
          slot.rows = slot.rows.map((r) => [...r]);
          slot.rows[ev.r]![ev.c] = ev.text;
          editor.updateShape<TableCardShape>({ id: slot.cardId, type: 'table-card', props: { rows: slot.rows } });
          break;
        }
        case 'card.done': {
          if (!slot?.cardId) break;
          // A slot that produced no content (a rare generation miss) shouldn't
          // leave an empty husk on the board — drop it.
          const s = editor.getShape(slot.cardId);
          if (s && isEmptyCard(s)) {
            editor.deleteShapes([slot.cardId]);
            const i = created.indexOf(slot.cardId);
            if (i >= 0) created.splice(i, 1);
          }
          relayout(); // snap the board tidy now this card's final height is known
          break;
        }
      }
    };

    try {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, intent, machineId: opts?.machineId, options: opts?.options }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Compose failed (${res.status})`);
      await readSSE<ComposeEvent>(res.body, (e) => {
        if (e.type === 'plan') {
          setPhase('building');
          for (const c of e.cards) {
            titles.set(c.slot, c.title);
            if (c.col !== undefined && c.row !== undefined) {
              gridPos.set(c.slot, { col: c.col, row: c.row, span: c.span ?? 1 });
              isGrid = true;
            }
          }
        } else if (e.type === 'slot') {
          applySlot(e.slot, e.event);
        } else if (e.type === 'error') {
          setPhase('error');
        }
      });
      // Sweep any husks — a slot whose generation errored before card.done can
      // leave a titled-but-empty card. Drop them so the board is all real cards.
      for (const id of [...created]) {
        const s = editor.getShape(id);
        if (!s || isEmptyCard(s)) {
          if (s) editor.deleteShapes([id]);
          const i = created.indexOf(id);
          if (i >= 0) created.splice(i, 1);
        }
      }
      // Auto-fit heights land a tick after the last delta (ResizeObserver), so
      // re-tidy across a couple of frames + a short delay to catch late growth —
      // this is what guarantees nothing ends up overlapping.
      relayout();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      relayout();
      if (created.length) frame(editor, created);
      // Content heights keep settling for a beat after the last delta; re-tidy a
      // couple more times so the final board never has an overlap.
      window.setTimeout(relayout, 350);
      window.setTimeout(() => { relayout(); if (created.length) frame(editor, created); }, 900);
      setPhase((p) => (p === 'error' ? 'error' : 'done'));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setPhase('error');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [editor, phase]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
  }, []);

  return { phase, run, cancel };
}

/** A card that finished with no content — a rare generation miss. Husks like
 *  this get swept so the board is only ever real cards. Checks the field each
 *  card type actually carries: doc/list → text, table → cells, diagram → code. */
function isEmptyCard(s: TLShape): boolean {
  if (s.type === 'doc-card') return !String((s.props as { text?: string }).text ?? '').trim();
  if (s.type === 'table-card')
    return !((s.props as { rows?: string[][] }).rows ?? []).flat().some((c) => String(c).trim());
  if (s.type === 'diagram-card') return !String((s.props as { code?: string }).code ?? '').trim();
  if (s.type === 'uimockup-card') return !String((s.props as { html?: string }).html ?? '').trim();
  return false;
}

/** Grid layout for a machine board (e.g. SWOT). Cards sit in fixed columns.
 *  Row tops are shared so a real matrix aligns — but the row heights come only
 *  from the columns that actually STACK (the 2×2 quadrants in cols 0–1); a
 *  single tall card in its own column (TOWS, Verdict in cols 2–3) sits beside
 *  the matrix, top-aligned, without inflating the rows. So the four quadrants
 *  form a clean aligned 2×2 and the strategy cards grow the board sideways. */
function gridPack(
  editor: Editor,
  cells: Array<{ id: TLShapeId; col: number; row: number }>,
  originX: number,
  originY: number,
): void {
  const byCol = new Map<number, number>(); // col → card count
  for (const c of cells) byCol.set(c.col, (byCol.get(c.col) ?? 0) + 1);

  // Row heights from stacking columns only (>1 card in the column).
  const rowH = new Map<number, number>();
  for (const c of cells) {
    if ((byCol.get(c.col) ?? 0) < 2) continue;
    const b = editor.getShapePageBounds(c.id);
    if (b) rowH.set(c.row, Math.max(rowH.get(c.row) ?? 0, b.h));
  }
  const rowY = new Map<number, number>();
  let y = originY;
  for (const row of [...rowH.keys()].sort((a, b) => a - b)) {
    rowY.set(row, y);
    y += rowH.get(row)! + V_GAP;
  }

  for (const c of cells) {
    const s = editor.getShape(c.id);
    if (!s) continue;
    const x = originX + c.col * (CELL_W + H_GAP);
    const cy = rowY.get(c.row) ?? originY;
    if (s.x !== x || s.y !== cy) editor.updateShape({ id: c.id, type: s.type, x, y: cy });
  }
}

/** Lay the created cards SIDE BY SIDE in one row using their measured widths —
 *  each card at the same top edge, flowing left to right. Widths are fixed, so
 *  this never overlaps, whatever the heights. */
function shelfPack(editor: Editor, ids: TLShapeId[], originX: number, originY: number): void {
  let x = originX;
  for (const id of ids) {
    const b = editor.getShapePageBounds(id);
    const s = editor.getShape(id);
    if (!b || !s) continue;
    if (s.x !== x || s.y !== originY) editor.updateShape({ id, type: s.type, x, y: originY });
    x += b.w + H_GAP;
  }
}

/** Gently frame the whole composition so the user watches the board fill in. */
function frame(editor: Editor, ids: TLShapeId[]): void {
  const boxes = ids
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is Box => Boolean(b));
  if (boxes.length === 0) return;
  const u = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
  editor.zoomToBounds(u, { animation: { duration: 400 }, inset: 100, targetZoom: 1 });
}
