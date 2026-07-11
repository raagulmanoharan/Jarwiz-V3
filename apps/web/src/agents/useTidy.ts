/**
 * "Tidy this diagram" (canvas pivot P3 — native-canvas craft).
 *
 * Re-lays a selected set of shapes wired by connectors into a clean layered
 * flow, in place, as one undo. Reads the connector graph (arrows whose both ends
 * bind selected shapes), runs the shared layered layout, and repositions the
 * nodes; bound connectors follow automatically. Fixes a hand-drawn mess — or the
 * occasional crossing in an agent-built flowchart — without redrawing anything.
 */

import { useCallback } from 'react';
import { getArrowBindings, useEditor, type Editor, type TLArrowShape, type TLShapeId, type TLShapePartial } from 'tldraw';
import { computeRows, GAP_X, GAP_Y } from './flowLayout';

/** Shapes worth repositioning — nodes, not the connectors between them. */
const NODE_TYPES = new Set([
  'geo', 'text', 'note', 'frame',
  'doc-card', 'note-card', 'table-card', 'diagram-card', 'prototype-card', 'link-card', 'image-card',
]);

/** Can a tidy do anything useful with this selection? (≥2 connected nodes.) */
export function canTidy(editor: Editor, ids: TLShapeId[]): boolean {
  const nodes = ids.filter((id) => {
    const s = editor.getShape(id);
    return s && NODE_TYPES.has(s.type);
  });
  if (nodes.length < 2) return false;
  const set = new Set(nodes);
  // At least one connector binding two selected nodes.
  return editor
    .getCurrentPageShapes()
    .filter((s): s is TLArrowShape => s.type === 'arrow')
    .some((a) => {
      const b = getArrowBindings(editor, a);
      return b.start?.toId && b.end?.toId && set.has(b.start.toId) && set.has(b.end.toId);
    });
}

export function useTidy() {
  const editor = useEditor();

  const tidy = useCallback(
    (ids: TLShapeId[]) => {
      const nodeIds = ids.filter((id) => {
        const s = editor.getShape(id);
        return s && NODE_TYPES.has(s.type);
      });
      if (nodeIds.length < 2) return;
      const set = new Set(nodeIds);

      // Edges = connectors binding two selected nodes (selected or not themselves).
      const edges: Array<{ from: string; to: string }> = [];
      for (const a of editor.getCurrentPageShapes()) {
        if (a.type !== 'arrow') continue;
        const b = getArrowBindings(editor, a as TLArrowShape);
        const from = b.start?.toId;
        const to = b.end?.toId;
        if (from && to && set.has(from) && set.has(to)) edges.push({ from, to });
      }
      if (edges.length === 0) return; // nothing connecting them — leave as-is

      const rows = computeRows(nodeIds as string[], edges);

      // Cell size from the largest node, so rows/cols line up cleanly.
      let cellW = 0;
      let cellH = 0;
      let originX = Infinity;
      let originY = Infinity;
      for (const id of nodeIds) {
        const bb = editor.getShapePageBounds(id);
        if (!bb) continue;
        cellW = Math.max(cellW, bb.w);
        cellH = Math.max(cellH, bb.h);
        originX = Math.min(originX, bb.minX);
        originY = Math.min(originY, bb.minY);
      }
      if (!isFinite(originX)) return;

      editor.markHistoryStoppingPoint('tidy-diagram'); // whole tidy = one undo

      rows.forEach((rowIds, r) => {
        const rowW = rowIds.length * cellW + (rowIds.length - 1) * GAP_X;
        const maxCols = Math.max(...rows.map((x) => x.length), 1);
        const totalW = maxCols * cellW + (maxCols - 1) * GAP_X;
        const rowX = originX + (totalW - rowW) / 2;
        rowIds.forEach((id, c) => {
          const bb = editor.getShapePageBounds(id as TLShapeId);
          if (!bb) return;
          // Centre each node within its cell so mixed sizes still align.
          const x = rowX + c * (cellW + GAP_X) + (cellW - bb.w) / 2;
          const y = originY + r * (cellH + GAP_Y);
          editor.updateShape({ id: id as TLShapeId, type: editor.getShape(id as TLShapeId)!.type, x, y } as TLShapePartial);
        });
      });

      editor.select(...nodeIds);
      const b = editor.getSelectionPageBounds();
      if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 80, targetZoom: 1 });
    },
    [editor],
  );

  return { tidy };
}
