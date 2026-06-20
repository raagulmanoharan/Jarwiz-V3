/**
 * Cluster & summarise (Big Rocks 2.1 — synthesis is the moat).
 *
 * Takes the user's selected sticky notes and synthesises *backward*: asks the
 * server to group them into named themes, then lays them out as a color-coded
 * affinity board — notes restacked into per-theme columns under a text header —
 * plus a summary doc card ("3 themes emerged: …"). One undo. This absorbs the
 * 30 minutes a PM spends grouping and naming clusters by hand.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createShapeId,
  toRichText,
  useEditor,
  type Editor,
  type TLShapeId,
} from 'tldraw';
import type { ClusterResult } from '@jarwiz/shared';
import { affinityColor, DOC_CARD_SIZE, type DocCardShape, type NoteCardShape } from '../shapes';

const COL_W = 240;
const GAP_X = 44;
const GAP_Y = 14;
const HEADER_H = 40;

/** Selected sticky notes in reading order (top→bottom, then left→right). */
function selectedNotes(editor: Editor): TLShapeId[] {
  return editor
    .getSelectedShapeIds()
    .map((id) => ({ id, b: editor.getShapePageBounds(id), s: editor.getShape(id) }))
    .filter((x) => x.s?.type === 'note-card' && x.b)
    .sort((a, b) => (Math.abs(a.b!.minY - b.b!.minY) > 24 ? a.b!.minY - b.b!.minY : a.b!.minX - b.b!.minX))
    .map((x) => x.id);
}

/** True when the selection is worth clustering (≥3 sticky notes). */
export function canCluster(editor: Editor, ids: TLShapeId[]): boolean {
  let n = 0;
  for (const id of ids) if (editor.getShape(id)?.type === 'note-card') n++;
  return n >= 3;
}

export function useCluster() {
  const editor = useEditor();
  const [isClustering, setIsClustering] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cluster = useCallback(async () => {
    if (isClustering) return;
    const noteIds = selectedNotes(editor);
    if (noteIds.length < 3) return;

    const items = noteIds.map((id) => {
      const s = editor.getShape(id);
      return s ? String((s.props as { text?: string }).text ?? '') : '';
    });

    // Anchor at the selection's top-left so the board lands where the notes are.
    const bounds = noteIds
      .map((id) => editor.getShapePageBounds(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b));
    const originX = Math.min(...bounds.map((b) => b.minX));
    const originY = Math.min(...bounds.map((b) => b.minY));

    setIsClustering(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`cluster failed (${res.status})`);
      const result = (await res.json()) as ClusterResult;
      if (!result?.themes?.length) return;

      editor.markHistoryStoppingPoint('cluster-stickies'); // whole synthesis = one undo
      const created: TLShapeId[] = [];

      result.themes.forEach((theme, c) => {
        const x = originX + c * (COL_W + GAP_X);
        const tint = affinityColor(c);

        // Theme header — a native text label naming the cluster.
        const headerId = createShapeId();
        created.push(headerId);
        editor.createShape({
          id: headerId,
          type: 'text',
          x,
          y: originY,
          props: { richText: toRichText(theme.name), size: 's', color: 'black', w: COL_W, autoSize: false, scale: 1 },
        } as Parameters<typeof editor.createShape>[0]);

        // Restack the member notes into this column, tinted by theme.
        let y = originY + HEADER_H + GAP_Y;
        for (const m of theme.members) {
          const id = noteIds[m];
          if (!id) continue;
          const shape = editor.getShape(id) as NoteCardShape | undefined;
          if (!shape) continue;
          editor.updateShape<NoteCardShape>({
            id,
            type: 'note-card',
            x,
            y,
            props: { w: COL_W, color: tint },
          });
          y += shape.props.h + GAP_Y;
        }
      });

      // Summary doc to the right of the columns.
      const summaryId = createShapeId();
      created.push(summaryId);
      editor.createShape<DocCardShape>({
        id: summaryId,
        type: 'doc-card',
        x: originX + result.themes.length * (COL_W + GAP_X),
        y: originY,
        props: {
          w: DOC_CARD_SIZE.w,
          h: DOC_CARD_SIZE.h,
          title: 'Themes',
          text: result.summary,
          sourcePdfId: '',
        },
      });

      editor.select(...created, ...noteIds);
      const b = editor.getSelectionPageBounds();
      if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 80 });
      editor.selectNone();
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[jarwiz] cluster error:', err.message);
      }
    } finally {
      setIsClustering(false);
    }
  }, [editor, isClustering]);

  return { cluster, isClustering };
}
