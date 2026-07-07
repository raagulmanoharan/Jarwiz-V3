/**
 * Tidy up — masonry compaction for loose cards (feature: Tidy Up spike).
 *
 * One algorithm, two entry points:
 *   • Global tidy  — the topbar ⊞ button → every top-level card on the page.
 *   • Local tidy   — right-click on a drag-selection → just the selected cards.
 *
 * Intent (owner brief, 2026-07-07): clean the board WITHOUT throwing away
 * positional context. Cards keep their left→right column order and their
 * top→bottom order inside a column; we only *pack out the gaps* so a short card
 * nestles up under its neighbour (masonry / "up up up"). We deliberately never
 * reflow a card into a different column — that would be "reshuffling wildly"
 * and lose the mental map the user built. The whole move is one undo.
 *
 * This is distinct from `useTidy.ts`, which re-lays a *connector-wired diagram*
 * into layered rows. That one follows arrows; this one follows whitespace.
 */

import { useCallback } from 'react';
import { useEditor, type Box, type Editor, type TLShapeId } from 'tldraw';

/** Gutters between packed cards (page px). Matches the board's calm rhythm. */
export const TIDY_GAP_X = 40;
export const TIDY_GAP_Y = 40;

/**
 * Column detection threshold. Walking the cards left→right, a horizontal gap
 * wider than this between two neighbours starts a new column; anything closer
 * is treated as the same column (a vertical stack). Sized just under the
 * narrowest card (note = 220) so genuinely stacked cards stay together while
 * a real side-by-side layout still reads as separate columns.
 */
const COLUMN_SPLIT_PX = 180;

/** The Jarwiz card shapes we reposition. Arrows/connectors are left out — they
 *  follow their bound cards automatically. */
const TIDYABLE_TYPES = new Set([
  'link-card', 'youtube-card', 'image-card', 'pdf-card', 'note-card',
  'doc-card', 'table-card', 'diagram-card', 'prototype-card',
  'machine-card', 'sheet-card',
]);

/**
 * The tidyable cards in scope. Pass an explicit id list (local tidy on a
 * selection) or omit it for the whole page (global tidy). We only ever move
 * cards parented directly to the page — cards nested in a frame or group are
 * left to their container.
 */
export function tidyableIds(editor: Editor, scope?: TLShapeId[]): TLShapeId[] {
  const pageId = editor.getCurrentPageId();
  const source = scope ?? editor.getCurrentPageShapes().map((s) => s.id);
  return source.filter((id) => {
    const s = editor.getShape(id);
    return !!s && s.parentId === pageId && TIDYABLE_TYPES.has(s.type);
  });
}

/** Is there anything a tidy could meaningfully do here? (≥2 tidyable cards.) */
export function canTidyBoard(editor: Editor, scope?: TLShapeId[]): boolean {
  return tidyableIds(editor, scope).length >= 2;
}

interface Card { id: TLShapeId; b: Box }
interface Move { id: TLShapeId; x: number; y: number; w: number; h: number }

/**
 * The masonry pack. Pure geometry so it's easy to reason about and test:
 * given each card's current page bounds, return where each one should go.
 *
 * 1. Sort by centre-x and split into columns on wide horizontal gaps — this is
 *    what preserves the user's columns instead of inventing new ones.
 * 2. Order columns left→right; give each a width = its widest card.
 * 3. Pack columns left→right from the block's current top-left, one GAP_X apart
 *    (closes horizontal voids, keeps column order).
 * 4. Inside a column, keep the cards' existing top→bottom order and stack them
 *    from the shared top, one GAP_Y apart (closes vertical voids = the masonry).
 */
function packMasonry(cards: Card[]): Move[] {
  const originX = Math.min(...cards.map((c) => c.b.minX));
  const originY = Math.min(...cards.map((c) => c.b.minY));

  const byX = [...cards].sort((a, b) => a.b.center.x - b.b.center.x);
  const columns: Card[][] = [];
  let prevCenter = -Infinity;
  for (const c of byX) {
    if (c.b.center.x - prevCenter > COLUMN_SPLIT_PX) columns.push([]);
    columns[columns.length - 1]!.push(c);
    prevCenter = c.b.center.x;
  }

  const moves: Move[] = [];
  let x = originX;
  for (const col of columns) {
    const colW = Math.max(...col.map((c) => c.b.w));
    col.sort((a, b) => a.b.minY - b.b.minY);
    let y = originY;
    for (const c of col) {
      moves.push({ id: c.id, x, y, w: c.b.w, h: c.b.h });
      y += c.b.h + TIDY_GAP_Y;
    }
    x += colW + TIDY_GAP_X;
  }
  return moves;
}

/** Page-space union of the packed positions — for framing the result. */
function unionBounds(moves: Move[]): Box | null {
  if (moves.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of moves) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + m.w);
    maxY = Math.max(maxY, m.y + m.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY } as Box;
}

export interface TidyOptions {
  /** Re-select the tidied cards afterwards (local tidy keeps the selection). */
  select?: boolean;
  /** Gently zoom to frame the tidied block (global tidy shows off the result). */
  frame?: boolean;
}

export function useTidyBoard() {
  const editor = useEditor();

  const tidyBoard = useCallback(
    (scope?: TLShapeId[], opts?: TidyOptions) => {
      const ids = tidyableIds(editor, scope);
      const cards: Card[] = [];
      for (const id of ids) {
        const b = editor.getShapePageBounds(id);
        if (b) cards.push({ id, b });
      }
      if (cards.length < 2) return;

      const moves = packMasonry(cards);

      // Top-level cards are parented to the page, so page-space x/y === parent
      // x/y. Skip no-op moves so an already-tidy board doesn't churn history.
      const changed = moves.filter((m) => {
        const s = editor.getShape(m.id);
        return s && (Math.round(s.x) !== Math.round(m.x) || Math.round(s.y) !== Math.round(m.y));
      });
      if (changed.length === 0) return;

      editor.markHistoryStoppingPoint('tidy-board'); // whole tidy = one undo
      editor.updateShapes(
        changed.map((m) => ({ id: m.id, type: editor.getShape(m.id)!.type, x: m.x, y: m.y })),
      );

      if (opts?.select) editor.select(...ids);
      if (opts?.frame) {
        const b = unionBounds(moves);
        if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 80, targetZoom: 1 });
      }
    },
    [editor],
  );

  return { tidyBoard };
}
