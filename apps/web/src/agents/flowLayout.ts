/**
 * Shared flow-layout for the canvas pivot. A layered (top-down) placement used
 * by both "◇ Flowchart" (P2 — build new shapes) and "⤢ Tidy" (P3 — re-lay an
 * existing graph). Kept framework-free so non-hook callers (templates) can use it.
 */

import {
  createBindingId,
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLDefaultColorStyle,
  type TLShapeId,
} from 'tldraw';
import type { DiagramNode, DiagramSpec } from '@jarwiz/shared';

export const NODE_W = 172;
export const NODE_H = 76;
export const GAP_X = 56;
export const GAP_Y = 72;

/** Per node-kind tldraw styling — a calm, legible flowchart palette. */
export const NODE_STYLE: Record<NonNullable<DiagramNode['shape']>, { geo: string; color: TLDefaultColorStyle }> = {
  rectangle: { geo: 'rectangle', color: 'blue' },
  diamond: { geo: 'diamond', color: 'orange' },
  ellipse: { geo: 'ellipse', color: 'green' },
};

/**
 * Group ids into layered rows by longest-path depth (bounded so a cycle / back-
 * edge can't loop), then compress to consecutive rows so a back-edge can't leave
 * a huge vertical gap. Order within a row follows input order. Edge endpoints not
 * in `ids` are ignored.
 */
export function computeRows(ids: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const depth = new Map<string, number>();
  for (const id of ids) depth.set(id, 0);
  const cap = ids.length;
  for (let i = 0; i < cap; i++) {
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      const next = (depth.get(e.from) ?? 0) + 1;
      if (next <= cap && next > (depth.get(e.to) ?? 0)) depth.set(e.to, next);
    }
  }
  const used = [...new Set(ids.map((id) => depth.get(id) ?? 0))].sort((a, b) => a - b);
  const rank = new Map(used.map((d, i) => [d, i]));
  const rows: string[][] = used.map(() => []);
  for (const id of ids) rows[rank.get(depth.get(id) ?? 0)!]!.push(id);
  return rows;
}

/** Place a diagram spec on the board as native geo shapes + bound connectors.
 *  Caller owns the history mark. Returns the created node + connector ids. */
export function buildFlowchart(
  editor: Editor,
  spec: DiagramSpec,
  origin: { x: number; y: number },
): TLShapeId[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const rows = computeRows(spec.nodes.map((n) => n.id), spec.edges);
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const totalW = maxCols * NODE_W + (maxCols - 1) * GAP_X;

  const nodeId = new Map<string, TLShapeId>();
  const created: TLShapeId[] = [];

  rows.forEach((rowIds, d) => {
    const rowW = rowIds.length * NODE_W + (rowIds.length - 1) * GAP_X;
    const rowX = origin.x + (totalW - rowW) / 2;
    rowIds.forEach((nid, i) => {
      const n = byId.get(nid)!;
      const id = createShapeId();
      nodeId.set(nid, id);
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
  });

  for (const e of spec.edges) {
    const from = nodeId.get(e.from);
    const to = nodeId.get(e.to);
    if (!from || !to) continue;
    const arrowId = createShapeId();
    created.push(arrowId);
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
