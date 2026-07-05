/**
 * Compose (board fan-out), client side. Ask the server to plan a set of cards
 * from the board, then stream each one in — laying them out MASONRY-style: each
 * finished card drops into whichever column is currently shortest, so a tall
 * itinerary doc and a wide budget table compose cleanly instead of colliding.
 * Reuses the Ask event vocabulary (card.create / delta / table.cell /
 * affinity.*) per slot, so composed cards are identical to hand-typed ones.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type Box, type TLShapeId } from 'tldraw';
import type { ComposeEvent } from '@jarwiz/shared';
import { DOC_CARD_SIZE, TABLE_CARD_SIZE, type DocCardShape, type TableCardShape } from '../shapes';
import { setShapeTitle } from '../shapes/shapeTitle';
import { readSSE } from './sse';
import { startStreaming, stopStreaming } from './streaming';
import { gatherBoardCards } from './boardText';

export type ComposePhase = 'idle' | 'planning' | 'building' | 'done' | 'error';

const COL_W = 440;
const COL_GAP = 44;
const COLS = 3;

interface Slot {
  col: number;
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
    const colX = (col: number) => originX + col * (COL_W + COL_GAP);
    const colBottom = Array.from({ length: COLS }, () => originY);
    const shortestCol = () => {
      let best = 0;
      for (let i = 1; i < COLS; i++) if (colBottom[i]! < colBottom[best]!) best = i;
      return best;
    };

    const titles = new Map<number, string>();
    const slots = new Map<number, Slot>();
    const created: TLShapeId[] = [];
    let firstCard = false;

    const applySlot = (slotIdx: number, ev: Extract<ComposeEvent, { type: 'slot' }>['event']) => {
      let slot = slots.get(slotIdx);
      switch (ev.type) {
        case 'card.create': {
          const col = shortestCol();
          const x = colX(col);
          const y = colBottom[col]!;
          const id = createShapeId();
          created.push(id);
          if (ev.shape === 'table') {
            const cols = (ev.columns ?? []).slice(0, 6);
            const rows = Array.from({ length: ev.rowCount ?? 0 }, () => cols.map(() => ''));
            editor.createShape<TableCardShape>({
              id, type: 'table-card', x, y,
              props: { w: COL_W, h: TABLE_CARD_SIZE.h, columns: cols, rows },
            });
            slots.set(slotIdx, { col, cardId: id, kind: 'table', cols, rows });
          } else {
            editor.createShape<DocCardShape>({
              id, type: 'doc-card', x, y,
              props: { w: COL_W, h: DOC_CARD_SIZE.h, title: titles.get(slotIdx) ?? '', text: '', sourcePdfId: '' },
            });
            slots.set(slotIdx, { col, cardId: id, kind: 'doc' });
          }
          const title = titles.get(slotIdx);
          const shape = editor.getShape(id);
          if (title && shape) setShapeTitle(editor, shape, title);
          startStreaming(id);
          if (!firstCard) { firstCard = true; frame(editor, created); }
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
          const b = editor.getShapePageBounds(slot.cardId);
          if (b) colBottom[slot.col] = b.maxY + COL_GAP;
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
      if (created.length) frame(editor, created);
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

/** Gently frame the whole composition so the user watches the board fill in. */
function frame(editor: ReturnType<typeof useEditor>, ids: TLShapeId[]): void {
  const boxes = ids
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is Box => Boolean(b));
  if (boxes.length === 0) return;
  const u = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
  editor.zoomToBounds(u, { animation: { duration: 400 }, inset: 100, targetZoom: 1 });
}
