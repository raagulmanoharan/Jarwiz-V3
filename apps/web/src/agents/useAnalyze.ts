/**
 * The opinion agents (Big Rocks 2.3 / 3.1 / 3.2). Runs an analysis lens over the
 * board (or the selection, for a focused critique) and drops the result as a doc
 * card placed to the side of the content. One undo.
 *
 *  - 'tensions' — conflict detection ("Scan for tensions")
 *  - 'gaps'     — "What am I missing?"
 *  - 'critique' — Devil's Advocate (selection if present, else whole board)
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type TLShapeId } from 'tldraw';
import type { AnalyzeMode, AnalyzeResult } from '@jarwiz/shared';
import { gatherBoardCards } from './boardText';
import { DOC_CARD_SIZE, type DocCardShape } from '../shapes';

export function useAnalyze() {
  const editor = useEditor();
  const [runningMode, setRunningMode] = useState<AnalyzeMode | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (mode: AnalyzeMode) => {
      if (runningMode) return;
      // Critique focuses on a selection when there is one; the scans are board-wide.
      const selectionOnly = mode === 'critique' && editor.getSelectedShapeIds().length > 0;
      const cards = gatherBoardCards(editor, { selectionOnly });
      if (cards.length === 0) return;

      // Place the result to the right of whatever we analysed (or the viewport).
      const considered = selectionOnly ? editor.getSelectedShapeIds() : editor.getCurrentPageShapes().map((s) => s.id);
      const bounds = considered
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      let x: number;
      let y: number;
      if (bounds.length) {
        x = Math.max(...bounds.map((b) => b.maxX)) + 80;
        y = Math.min(...bounds.map((b) => b.minY));
      } else {
        const c = editor.getViewportPageBounds().center;
        x = c.x - DOC_CARD_SIZE.w / 2;
        y = c.y - DOC_CARD_SIZE.h / 2;
      }

      setRunningMode(mode);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, cards }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`analyze failed (${res.status})`);
        const result = (await res.json()) as AnalyzeResult;
        if (!result?.text) return;

        editor.markHistoryStoppingPoint('analyze'); // one undo
        const id = createShapeId();
        editor.createShape<DocCardShape>({
          id,
          type: 'doc-card',
          x,
          y,
          props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, title: result.title, text: result.text, sourcePdfId: '' },
        });
        editor.select(id);
        const b = editor.getShapePageBounds(id);
        if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 120 });
        editor.selectNone();
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[jarwiz] analyze error:', err.message);
        }
      } finally {
        setRunningMode(null);
      }
    },
    [editor, runningMode],
  );

  return { analyze, runningMode };
}
