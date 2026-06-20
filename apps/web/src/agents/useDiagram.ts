/**
 * "Turn this into a flowchart" (canvas pivot P2 — the AI builds primitives).
 *
 * Calls /api/diagram for a { nodes, edges } graph, then lays it out as NATIVE
 * tldraw geo shapes + bound connectors — real, editable primitives the user can
 * drag, restyle, and extend, not a fixed Mermaid card. The whole build is one
 * undo. This is the agent authoring on the same surface humans draw on.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createBindingId,
  createShapeId,
  renderPlaintextFromRichText,
  toRichText,
  useEditor,
  type Editor,
  type TLArrowShape,
  type TLDefaultColorStyle,
  type TLRichText,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import type { AskSource, DiagramNode, DiagramSpec } from '@jarwiz/shared';

const NODE_W = 172;
const NODE_H = 76;
const GAP_X = 56;
const GAP_Y = 72;

/** Per node-kind tldraw styling — a calm, legible flowchart palette. */
const NODE_STYLE: Record<NonNullable<DiagramNode['shape']>, { geo: string; color: TLDefaultColorStyle }> = {
  rectangle: { geo: 'rectangle', color: 'blue' },
  diamond: { geo: 'diamond', color: 'orange' },
  ellipse: { geo: 'ellipse', color: 'green' },
};

function plainText(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try {
    return renderPlaintextFromRichText(editor, richText as TLRichText).trim();
  } catch {
    return '';
  }
}

/** Compact text grounding from a selected shape (card or primitive). */
function sourceFromShape(editor: Editor, shape: TLShape): AskSource | null {
  const p = shape.props as Record<string, unknown>;
  if (shape.type === 'doc-card' || shape.type === 'note-card') {
    const t = typeof p.text === 'string' ? p.text : '';
    return t ? { kind: 'note', text: t.slice(0, 2000) } : null;
  }
  if (shape.type === 'table-card') {
    const cols = (p.columns as string[]) ?? [];
    const rows = (p.rows as string[][]) ?? [];
    const text = [cols, ...rows].map((r) => r.join(' | ')).join('\n');
    return text.trim() ? { kind: 'note', text } : null;
  }
  if (shape.type === 'geo' || shape.type === 'text' || shape.type === 'note' || shape.type === 'arrow') {
    const t = plainText(editor, p.richText);
    return t ? { kind: 'note', text: t } : null;
  }
  return null;
}

/** Longest-path depth per node (bounded so cycles can't loop). Roots → row 0. */
function layoutDepths(spec: DiagramSpec): Map<string, number> {
  const depth = new Map<string, number>();
  for (const n of spec.nodes) depth.set(n.id, 0);
  const cap = spec.nodes.length;
  for (let i = 0; i < cap; i++) {
    for (const e of spec.edges) {
      const next = (depth.get(e.from) ?? 0) + 1;
      if (next <= cap && next > (depth.get(e.to) ?? 0)) depth.set(e.to, next);
    }
  }
  return depth;
}

/** Place the spec's shapes + connectors on the board, return the created ids. */
function buildFlowchart(editor: Editor, spec: DiagramSpec, origin: { x: number; y: number }): TLShapeId[] {
  const depth = layoutDepths(spec);
  // Compress depths to consecutive rows so a back-edge can't leave a huge gap.
  const usedDepths = [...new Set(spec.nodes.map((n) => depth.get(n.id) ?? 0))].sort((a, b) => a - b);
  const rank = new Map(usedDepths.map((d, i) => [d, i]));
  // Group nodes by row (compressed depth), preserving spec order within a row.
  const rows = new Map<number, DiagramNode[]>();
  for (const n of spec.nodes) {
    const d = rank.get(depth.get(n.id) ?? 0) ?? 0;
    (rows.get(d) ?? rows.set(d, []).get(d)!).push(n);
  }
  const maxCols = Math.max(...[...rows.values()].map((r) => r.length), 1);
  const totalW = maxCols * NODE_W + (maxCols - 1) * GAP_X;

  const nodeId = new Map<string, TLShapeId>();
  const created: TLShapeId[] = [];

  editor.markHistoryStoppingPoint('build-flowchart');

  for (const [d, nodesInRow] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const rowW = nodesInRow.length * NODE_W + (nodesInRow.length - 1) * GAP_X;
    const rowX = origin.x + (totalW - rowW) / 2;
    nodesInRow.forEach((n, i) => {
      const id = createShapeId();
      nodeId.set(n.id, id);
      created.push(id);
      const style = NODE_STYLE[n.shape ?? 'rectangle'];
      editor.createShape({
        id,
        type: 'geo',
        x: rowX + i * (NODE_W + GAP_X),
        y: origin.y + d * (NODE_H + GAP_Y),
        props: {
          geo: style.geo,
          w: NODE_W,
          h: NODE_H,
          color: style.color,
          fill: 'solid',
          size: 's',
          richText: toRichText(n.label),
        },
      } as Parameters<typeof editor.createShape>[0]);
    });
  }

  for (const e of spec.edges) {
    const from = nodeId.get(e.from);
    const to = nodeId.get(e.to);
    if (!from || !to) continue;
    const arrowId = createShapeId();
    editor.createShape<TLArrowShape>({
      id: arrowId,
      type: 'arrow',
      props: {
        color: 'black',
        size: 's',
        dash: 'solid',
        arrowheadEnd: 'triangle',
        ...(e.label ? { richText: toRichText(e.label) } : {}),
      },
    });
    editor.createBindings([
      { id: createBindingId(), type: 'arrow', fromId: arrowId, toId: from, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
      { id: createBindingId(), type: 'arrow', fromId: arrowId, toId: to, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
    ]);
  }

  return created;
}

export function useDiagram() {
  const editor = useEditor();
  const [isDiagramming, setIsDiagramming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const diagram = useCallback(
    async (prompt: string, sourceIds: TLShapeId[]) => {
      if (isDiagramming) return;

      const sources = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s))
        .map((s) => sourceFromShape(editor, s))
        .filter((s): s is AskSource => Boolean(s));

      // Anchor: to the right of the selection, else viewport centre.
      const selBounds = sourceIds.length ? editor.getShapePageBounds(sourceIds[0]!) : null;
      const allBounds = sourceIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      let origin: { x: number; y: number };
      if (allBounds.length) {
        const right = Math.max(...allBounds.map((b) => b.maxX));
        const top = Math.min(...allBounds.map((b) => b.minY));
        origin = { x: right + 80, y: top };
      } else {
        const c = editor.getViewportPageBounds().center;
        origin = { x: c.x - 100, y: c.y - 100 };
      }
      void selBounds;

      setIsDiagramming(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch('/api/diagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, sources: sources.length ? sources : undefined }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`diagram failed (${res.status})`);
        const spec = (await res.json()) as DiagramSpec;
        if (!spec?.nodes?.length) return;
        const ids = buildFlowchart(editor, spec, origin);
        if (ids.length) {
          editor.select(...ids);
          const b = editor.getSelectionPageBounds();
          if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 80 });
          editor.selectNone();
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[jarwiz] diagram error:', err.message);
        }
      } finally {
        setIsDiagramming(false);
      }
    },
    [editor, isDiagramming],
  );

  return { diagram, isDiagramming };
}
