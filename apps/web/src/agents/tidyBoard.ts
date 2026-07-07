/**
 * Tidy up — masonry compaction for loose cards (feature: Tidy Up).
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
 * and lose the mental map the user built. Each tidy is one undo.
 *
 * Columns are detected by horizontal OVERLAP, not raw centre distance, so a
 * wide table and a narrow note that visually stack still read as one column
 * even though their centres differ (see splitColumns).
 *
 * The move animates: cards glide from where they were to their packed slot on
 * an ease-out over --jz-dur-slow, honouring prefers-reduced-motion (which snaps
 * instantly). The animation is purely visual — the committed change is the
 * final layout, so undo restores the original in one step.
 *
 * Distinct from `useTidy.ts`, which re-lays a *connector-wired diagram* into
 * layered rows. That one follows arrows; this one follows whitespace.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useEditor, type Box, type Editor, type TLShapeId } from 'tldraw';

/** Gutters between packed cards (page px). Matches the board's calm rhythm. */
export const TIDY_GAP_X = 40;
export const TIDY_GAP_Y = 40;

/**
 * Column merge threshold. Two cards belong to the same column when their
 * horizontal spans overlap by at least this fraction of the narrower card.
 * Overlap (not centre distance) is what lets a 560px table and a 220px note
 * share a column when they're stacked, while a genuine side-by-side layout —
 * where spans barely touch — still splits into separate columns.
 */
const COLUMN_OVERLAP_RATIO = 0.5;

/** Settle animation. Duration is read live from the --jz-dur-slow token so it
 *  tracks the design system; the curve is an ease-out (mirrors --jz-ease-glide:
 *  a quick start that decelerates into place). */
const FALLBACK_DURATION_MS = 420;

/** The Jarwiz card shapes we reposition. Arrows/connectors are left out — they
 *  follow their bound cards automatically. */
const TIDYABLE_TYPES = new Set([
  'link-card', 'youtube-card', 'image-card', 'pdf-card', 'note-card',
  'doc-card', 'table-card', 'diagram-card', 'prototype-card',
  'machine-card', 'sheet-card', 'dashboard-card',
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
 * Group cards into columns by horizontal overlap. Walking left→right by centre,
 * a card joins the current column when it overlaps that column's footprint by
 * ≥ COLUMN_OVERLAP_RATIO of the narrower span; otherwise it starts a new one.
 * The column footprint grows to the union of its members, so a column tracks
 * the real spread of what's stacked in it.
 */
function splitColumns(cards: Card[]): Card[][] {
  const byX = [...cards].sort((a, b) => a.b.center.x - b.b.center.x);
  const columns: Array<{ items: Card[]; minX: number; maxX: number }> = [];
  for (const c of byX) {
    const col = columns[columns.length - 1];
    if (col) {
      const overlap = Math.min(c.b.maxX, col.maxX) - Math.max(c.b.minX, col.minX);
      const narrower = Math.min(c.b.w, col.maxX - col.minX);
      if (overlap >= narrower * COLUMN_OVERLAP_RATIO) {
        col.items.push(c);
        col.minX = Math.min(col.minX, c.b.minX);
        col.maxX = Math.max(col.maxX, c.b.maxX);
        continue;
      }
    }
    columns.push({ items: [c], minX: c.b.minX, maxX: c.b.maxX });
  }
  return columns.map((c) => c.items);
}

/**
 * The masonry pack. Pure geometry so it's easy to reason about and test:
 * given each card's current page bounds, return where each one should go.
 *
 * 1. Split into columns by overlap (splitColumns) — preserves the user's
 *    columns instead of inventing new ones.
 * 2. Order columns left→right; give each a width = its widest card.
 * 3. Pack columns left→right from the block's current top-left, one GAP_X apart
 *    (closes horizontal voids, keeps column order).
 * 4. Inside a column, keep the cards' existing top→bottom order and stack them
 *    from the shared top, one GAP_Y apart (closes vertical voids = the masonry).
 */
function packMasonry(cards: Card[]): Move[] {
  const originX = Math.min(...cards.map((c) => c.b.minX));
  const originY = Math.min(...cards.map((c) => c.b.minY));

  const moves: Move[] = [];
  let x = originX;
  for (const col of splitColumns(cards)) {
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

/** Settle duration from the design tokens, falling back if unreadable (SSR). */
function settleDurationMs(): number {
  if (typeof window === 'undefined') return FALLBACK_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--jz-dur-slow').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_DURATION_MS;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Decelerating ease-out (mirrors --jz-ease-glide's feel) — quick off the mark,
 *  gentle into place. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface TidyOptions {
  /** Re-select the tidied cards afterwards (local tidy keeps the selection). */
  select?: boolean;
  /** Gently zoom to frame the tidied block. */
  frame?: boolean;
}

export function useTidyBoard() {
  const editor = useEditor();
  const rafRef = useRef<number | null>(null);

  // Stop a settle mid-flight if the button/menu unmounts, so the rAF loop can't
  // keep repositioning cards after its host is gone.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

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
      // x/y. Skip no-op moves so an already-tidy board doesn't churn.
      const targets = moves
        .map((m) => {
          const s = editor.getShape(m.id);
          if (!s) return null;
          return { id: m.id, type: s.type, fromX: s.x, fromY: s.y, toX: m.x, toY: m.y };
        })
        .filter((t): t is NonNullable<typeof t> => !!t)
        .filter((t) => Math.round(t.fromX) !== Math.round(t.toX) || Math.round(t.fromY) !== Math.round(t.toY));
      if (targets.length === 0) return;

      // Cancel any in-flight settle before starting a new one.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const frameBounds = opts?.frame ? unionBounds(moves) : null;
      const duration = settleDurationMs();
      const reduced = prefersReducedMotion();

      // Commit the final layout as ONE recorded change — this is the undo
      // target. Everything after is history-ignored, so undo restores the
      // original board in a single step.
      editor.markHistoryStoppingPoint('tidy-board');
      editor.updateShapes(targets.map((t) => ({ id: t.id, type: t.type, x: t.toX, y: t.toY })));
      if (opts?.select) editor.select(...ids);

      const finish = () => {
        if (frameBounds) {
          editor.zoomToBounds(frameBounds, { animation: { duration }, inset: 80, targetZoom: 1 });
        }
      };

      if (reduced) {
        // Snap: the committed state above is already final. Just frame it.
        finish();
        return;
      }

      // Reset to the start positions in the SAME synchronous tick (no paint
      // happens between the commit and this reset, so the final layout never
      // flashes), then glide start→final over the settle duration.
      editor.run(
        () => editor.updateShapes(targets.map((t) => ({ id: t.id, type: t.type, x: t.fromX, y: t.fromY }))),
        { history: 'ignore' },
      );
      finish(); // camera glides while the cards settle

      const start = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        const k = easeOut(t);
        editor.run(() => {
          editor.updateShapes(
            targets
              .filter((tg) => editor.getShape(tg.id)) // a card deleted mid-settle is skipped
              .map((tg) => ({
                id: tg.id,
                type: tg.type,
                x: tg.fromX + (tg.toX - tg.fromX) * k,
                y: tg.fromY + (tg.toY - tg.fromY) * k,
              })),
          );
        }, { history: 'ignore' });
        rafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [editor],
  );

  return { tidyBoard };
}
