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
export const GAP_X = 88;
export const GAP_Y = 108;

/** Per node-kind tldraw styling. Monochrome ink on translucent panels — the
 *  GEOMETRY carries the meaning (process/decision/terminal); saturated fills
 *  fought the app's muted chrome (owner call, 2026-07-05). */
export const NODE_STYLE: Record<NonNullable<DiagramNode['shape']>, { geo: string; color: TLDefaultColorStyle }> = {
  rectangle: { geo: 'rectangle', color: 'grey' },
  diamond: { geo: 'diamond', color: 'grey' },
  ellipse: { geo: 'ellipse', color: 'grey' },
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
export interface PlacedNode {
  node: DiagramNode;
  x: number;
  y: number;
  /** Centre, for parking the agent cursor on it. */
  cx: number;
  cy: number;
}

/** Compute the final position of every node (layered, centred at origin). */
export function layoutFlow(spec: DiagramSpec, origin: { x: number; y: number }): PlacedNode[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const rows = computeRows(spec.nodes.map((n) => n.id), spec.edges);
  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const totalW = maxCols * NODE_W + (maxCols - 1) * GAP_X;
  const placed: PlacedNode[] = [];
  rows.forEach((rowIds, d) => {
    const rowW = rowIds.length * NODE_W + (rowIds.length - 1) * GAP_X;
    const rowX = origin.x + (totalW - rowW) / 2;
    rowIds.forEach((nid, i) => {
      const node = byId.get(nid)!;
      const x = rowX + i * (NODE_W + GAP_X);
      const y = origin.y + d * (NODE_H + GAP_Y);
      placed.push({ node, x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 });
    });
  });
  return placed;
}

/** Create one flowchart node shape; returns its tldraw id. */
export function createFlowNode(editor: Editor, p: PlacedNode): TLShapeId {
  const id = createShapeId();
  const style = NODE_STYLE[p.node.shape ?? 'rectangle'];
  editor.createShape({
    id, type: 'geo', x: p.x, y: p.y,
    props: { geo: style.geo, w: NODE_W, h: NODE_H, color: style.color, labelColor: 'black', fill: 'semi', size: 's', font: 'sans', richText: toRichText(p.node.label) },
  } as Parameters<typeof editor.createShape>[0]);
  return id;
}

/** Create one bound connector between two already-created node shapes. */
export function createFlowEdge(editor: Editor, fromId: TLShapeId, toId: TLShapeId, label?: string): TLShapeId {
  const arrowId = createShapeId();
  editor.createShape<TLArrowShape>({
    id: arrowId, type: 'arrow',
    props: { color: 'grey', labelColor: 'black', size: 's', dash: 'solid', font: 'sans', arrowheadEnd: 'triangle', ...(label ? { richText: toRichText(label) } : {}) },
  });
  editor.createBindings([
    { id: createBindingId(), type: 'arrow', fromId: arrowId, toId: fromId, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
    { id: createBindingId(), type: 'arrow', fromId: arrowId, toId: toId, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
  ]);
  return arrowId;
}

/**
 * Fold a finished flowchart into ONE unit: a tldraw group. Click selects the
 * whole diagram (so an ask grounds on all of it); double-click enters the
 * group to move/edit individual shapes — tldraw's native "invisible frame".
 * Returns the group id (or null if grouping wasn't possible).
 */
export function groupFlowchart(editor: Editor, created: TLShapeId[]): TLShapeId | null {
  if (created.length < 2) return null;
  editor.groupShapes(created);
  const parent = editor.getShape(created[0]!)?.parentId;
  const groupId =
    typeof parent === 'string' && parent.startsWith('shape:') ? (parent as TLShapeId) : null;
  // Tag it so chrome can treat a generated diagram specially (e.g. the style
  // panel stays hidden — its color/thickness dials don't apply here).
  if (groupId) {
    editor.updateShape({ id: groupId, type: 'group', meta: { jzFlowchart: true } });
  }
  return groupId;
}

/** Place a whole spec at once (used by templates). Caller owns the history mark. */
export function buildFlowchart(editor: Editor, spec: DiagramSpec, origin: { x: number; y: number }): TLShapeId[] {
  const placed = layoutFlow(spec, origin);
  const nodeId = new Map<string, TLShapeId>();
  const created: TLShapeId[] = [];
  for (const p of placed) { const id = createFlowNode(editor, p); nodeId.set(p.node.id, id); created.push(id); }
  for (const e of spec.edges) {
    const from = nodeId.get(e.from);
    const to = nodeId.get(e.to);
    if (from && to) created.push(createFlowEdge(editor, from, to, e.label));
  }
  groupFlowchart(editor, created);
  return created;
}
