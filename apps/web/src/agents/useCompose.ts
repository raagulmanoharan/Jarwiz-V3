/**
 * Compose (board fan-out), client side. Ask the server to plan a set of cards
 * from the board, then stream each one in — reusing the Ask event vocabulary
 * (card.create / delta / table.cell) per slot, so composed cards are identical
 * to hand-typed ones.
 *
 * Layout is a SHELF PACKER that re-tidies on every card using measured sizes:
 * cards flow left-to-right and wrap to a new row when the row is full, and a
 * relayout pass runs whenever a card is created or finishes — so nothing ever
 * overlaps, whatever each card's final height turns out to be. Tables get a
 * width proportional to their column count so columns stay readable (not narrow
 * and tall).
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type Box, type Editor, type TLShapeId } from 'tldraw';
import type { ComposeEvent } from '@jarwiz/shared';
import { DOC_CARD_SIZE, TABLE_CARD_SIZE, type DocCardShape, type TableCardShape } from '../shapes';
import { setShapeTitle } from '../shapes/shapeTitle';
import { readSSE } from './sse';
import { startStreaming, stopStreaming } from './streaming';
import { gatherBoardCards } from './boardText';

export type ComposePhase = 'idle' | 'planning' | 'building' | 'done' | 'error';

const DOC_W = 500;
const H_GAP = 48; // between cards, laid side by side in a single row

/** A readable table width: ~190px per column, clamped so it's never cramped
 *  (the owner's "less narrow, easier to read, less tall") nor absurdly wide. */
function tableWidth(colCount: number): number {
  return Math.max(460, Math.min(960, colCount * 190));
}

interface Slot {
  cardId?: TLShapeId;
  kind: 'doc' | 'table';
  cols?: string[];
  rows?: string[][];
}

export function useCompose() {
  const editor = useEditor();
  const [phase, setPhase] = useState<ComposePhase>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (intent?: string) => {
    if (phase === 'planning' || phase === 'building') return;
    const board = gatherBoardCards(editor);
    if (board.length === 0 && !intent?.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('planning');

    // Composition origin: a fresh strip to the right of everything on the board.
    const bounds = editor.getCurrentPageBounds();
    const originX = bounds ? bounds.maxX + 120 : editor.getViewportPageBounds().minX + 80;
    const originY = bounds ? bounds.minY : editor.getViewportPageBounds().minY + 80;

    const titles = new Map<number, string>();
    const slots = new Map<number, Slot>();
    const created: TLShapeId[] = [];
    let framed = false;

    const relayout = () => shelfPack(editor, created, originX, originY);

    const applySlot = (slotIdx: number, ev: Extract<ComposeEvent, { type: 'slot' }>['event']) => {
      const slot = slots.get(slotIdx);
      switch (ev.type) {
        case 'card.create': {
          const id = createShapeId();
          created.push(id);
          if (ev.shape === 'table') {
            const cols = (ev.columns ?? []).slice(0, 6);
            const rows = Array.from({ length: ev.rowCount ?? 0 }, () => cols.map(() => ''));
            editor.createShape<TableCardShape>({
              id, type: 'table-card', x: originX, y: originY,
              props: { w: tableWidth(cols.length), h: TABLE_CARD_SIZE.h, columns: cols, rows },
            });
            slots.set(slotIdx, { cardId: id, kind: 'table', cols, rows });
          } else {
            editor.createShape<DocCardShape>({
              id, type: 'doc-card', x: originX, y: originY,
              props: { w: DOC_W, h: DOC_CARD_SIZE.h, title: titles.get(slotIdx) ?? '', text: '', sourcePdfId: '' },
            });
            slots.set(slotIdx, { cardId: id, kind: 'doc' });
          }
          const title = titles.get(slotIdx);
          const shape = editor.getShape(id);
          if (title && shape) setShapeTitle(editor, shape, title);
          startStreaming(id);
          relayout(); // place the newcomer after the finished cards
          if (!framed) { framed = true; frame(editor, created); }
          break;
        }
        case 'card.title': // plan titles are authoritative — ignore the generated one
          break;
        case 'card.delta': {
          if (!slot?.cardId) break;
          const s = editor.getShape(slot.cardId);
          if (s && 'text' in (s.props as object)) {
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
          stopStreaming(slot.cardId);
          // A slot that produced no content (a rare generation miss) shouldn't
          // leave an empty husk on the board — drop it.
          const s = editor.getShape(slot.cardId);
          const emptyDoc = s?.type === 'doc-card' && !String((s.props as { text?: string }).text ?? '').trim();
          const emptyTable =
            s?.type === 'table-card' &&
            !((s.props as { rows?: string[][] }).rows ?? []).flat().some((c) => String(c).trim());
          if (emptyDoc || emptyTable) {
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
        body: JSON.stringify({ board, intent }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Compose failed (${res.status})`);
      await readSSE<ComposeEvent>(res.body, (e) => {
        if (e.type === 'plan') {
          setPhase('building');
          for (const c of e.cards) titles.set(c.slot, c.title);
        } else if (e.type === 'slot') {
          applySlot(e.slot, e.event);
        } else if (e.type === 'error') {
          setPhase('error');
        }
      });
      created.forEach((id) => stopStreaming(id));
      // Sweep any husks — a slot whose generation errored before card.done can
      // leave a titled-but-empty card. Drop them so the board is all real cards.
      for (const id of [...created]) {
        const s = editor.getShape(id);
        const emptyDoc = s?.type === 'doc-card' && !String((s.props as { text?: string }).text ?? '').trim();
        const emptyTable =
          s?.type === 'table-card' &&
          !((s.props as { rows?: string[][] }).rows ?? []).flat().some((c) => String(c).trim());
        if (!s || emptyDoc || emptyTable) {
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
      created.forEach((id) => stopStreaming(id));
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

/** Lay the created cards SIDE BY SIDE in one row using their measured widths —
 *  each card at the same top edge, flowing left to right. Reading a board left
 *  to right beats scrolling a tall stack; the infinite canvas has the room.
 *  Position-independent widths mean this never overlaps, whatever the heights. */
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
