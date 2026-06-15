/**
 * The Ask pipeline, client side. Given a prompt and one or more source cards,
 * opens an SSE connection to /api/ask and streams the answer into a floating
 * preview (askPreview store) — NOT straight onto the canvas. The user judges it
 * and commits with "Add to canvas" (commitPreview), which creates the answer
 * card adjacent to the sources and draws a provenance edge from each.
 *
 * This is the one AI interaction of the PDF journey (docs/PDF-JOURNEY.md): the
 * same path serves a typed question and a predefined seed pill.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createBindingId,
  createShapeId,
  useEditor,
  type Editor,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import type { AskEvent, AskSource } from '@jarwiz/shared';
import { DOC_CARD_SIZE, TABLE_CARD_SIZE, type DocCardShape, type TableCardShape } from '../shapes';
import { stopStreaming } from '../agents/streaming';
import { setResponsePdfSource } from '../pdf/provenance';
import { appendPreviewText, clearPreview, getPreview, setPreview, updatePreview } from './askPreview';
import { logEvent } from '../log/eventLog';

/** Build the server-side source descriptor from a card shape. */
function toSource(shape: TLShape): AskSource | null {
  const p = shape.props as Record<string, unknown>;
  switch (shape.type) {
    case 'pdf-card':
      return { kind: 'pdf', assetId: String(p.assetId ?? ''), title: String(p.name ?? '') };
    case 'doc-card':
      return { kind: 'doc', title: String(p.title ?? ''), text: String(p.text ?? '') };
    case 'note-card':
      return { kind: 'note', text: String(p.text ?? '') };
    case 'table-card': {
      const cols = (p.columns as string[]) ?? [];
      const rows = (p.rows as string[][]) ?? [];
      const text = [cols, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      return { kind: 'table', title: String(p.title ?? ''), text };
    }
    default:
      return null;
  }
}

export function useAsk() {
  const editor = useEditor();
  const [isAsking, setIsAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (prompt: string, sourceIds: TLShapeId[]) => {
      const trimmed = prompt.trim();
      if (!trimmed || sourceIds.length === 0 || isAsking) return;

      const sourceShapes = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s));
      const sources = sourceShapes
        .map((s) => toSource(s))
        .filter((s): s is AskSource => Boolean(s));
      if (sources.length === 0) return;

      const { x: placeX, y: placeY } = placeNear(editor, sourceIds, DOC_CARD_SIZE.w, DOC_CARD_SIZE.h);
      const pdfSourceId = sourceShapes.find((s) => s.type === 'pdf-card')?.id ?? null;

      setIsAsking(true);
      // Seed an empty preview so the panel opens immediately with a status.
      setPreview({
        shape: 'doc',
        prompt: trimmed,
        text: '',
        status: 'streaming',
        placeX,
        placeY,
        sourceIds,
        pdfSourceId,
      });

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      const apply = (event: AskEvent) => {
        switch (event.type) {
          case 'card.create':
            updatePreview({
              shape: event.shape,
              title: event.title,
              columns: event.columns,
              rows: event.rows,
              text: '',
              status: event.shape === 'table' ? 'done' : 'streaming',
            });
            break;
          case 'card.delta':
            appendPreviewText(event.textDelta);
            break;
          case 'card.done':
          case 'done':
            updatePreview({ status: 'done' });
            break;
          case 'error':
            updatePreview({ status: 'error', error: event.message });
            break;
        }
      };

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, sources }),
          signal,
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.error ?? `Ask failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const flush = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            apply(JSON.parse(line.slice(6)) as AskEvent);
          } catch (e) {
            console.error('[jarwiz] bad ask event', line, e);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) flush(line);
        }
        flush(buffer);
        updatePreview({ status: 'done' });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          updatePreview({ status: 'error', error: err.message });
        }
      } finally {
        setIsAsking(false);
      }
    },
    [editor, isAsking],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsAsking(false);
  }, []);

  return { ask, isAsking, abort };
}

/**
 * Commit the current preview to the canvas — create the answer card at its
 * placement, draw a provenance edge from each source, and wire citations.
 * Returns the new shape id, or null if there was nothing to add.
 */
export function commitPreview(editor: Editor): TLShapeId | null {
  const p = getPreview();
  if (!p || p.status === 'error') return null;

  const id = createShapeId();
  if (p.pdfSourceId) setResponsePdfSource(id, p.pdfSourceId);

  if (p.shape === 'table') {
    const columns = (p.columns ?? []).slice(0, 6);
    const rows = (p.rows ?? []).slice(0, 14).map((r) => r.slice(0, 6));
    // Bounded height; the body scrolls if the content is taller.
    const h = Math.min(460, Math.max(TABLE_CARD_SIZE.h, 52 + rows.length * 56));
    const at = placeNear(editor, p.sourceIds, TABLE_CARD_SIZE.w, h);
    editor.createShape<TableCardShape>({
      id,
      type: 'table-card',
      x: at.x,
      y: at.y,
      props: { w: TABLE_CARD_SIZE.w, h, columns, rows },
    });
  } else {
    const at = placeNear(editor, p.sourceIds, DOC_CARD_SIZE.w, DOC_CARD_SIZE.h);
    editor.createShape<DocCardShape>({
      id,
      type: 'doc-card',
      x: at.x,
      y: at.y,
      props: {
        w: DOC_CARD_SIZE.w,
        h: DOC_CARD_SIZE.h,
        title: p.title ?? '',
        text: p.text,
        sourcePdfId: p.pdfSourceId ?? '',
      },
    });
  }
  for (const from of p.sourceIds) createEdge(editor, from, id);
  stopStreaming(id);
  logEvent(editor, {
    kind: 'artefact',
    label: p.prompt || (p.title ?? 'Answer'),
    detail: p.shape === 'table' ? 'Table' : p.title || 'Doc',
    shapeIds: [id, ...p.sourceIds],
  });
  clearPreview();
  return id;
}

/**
 * A non-overlapping spot for a new card, just right of the source(s). If that
 * column is occupied, slide down past whatever's there — so generated artefacts
 * tile instead of piling on top of each other.
 */
export function placeNear(
  editor: Editor,
  sourceIds: TLShapeId[],
  w: number,
  h: number,
): { x: number; y: number } {
  const boxes = sourceIds
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
  const center = editor.getViewportPageBounds().center;
  let x = boxes.length ? Math.max(...boxes.map((b) => b.maxX)) + 72 : center.x - w / 2;
  let y = boxes.length ? Math.min(...boxes.map((b) => b.minY)) : center.y - h / 2;

  const GAP = 28;
  const others = editor
    .getCurrentPageShapes()
    .filter((s) => s.type !== 'arrow' && !sourceIds.includes(s.id))
    .map((s) => editor.getShapePageBounds(s.id))
    .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
  const hits = (ry: number) =>
    others.some((b) => x < b.maxX + GAP && x + w > b.minX - GAP && ry < b.maxY + GAP && ry + h > b.minY - GAP);

  let guard = 0;
  while (hits(y) && guard++ < 80) y += 48;
  return { x, y };
}

/** A neutral provenance arrow from a source card to the answer. */
function createEdge(editor: Editor, fromId: TLShapeId, toId: TLShapeId): void {
  if (!editor.getShape(fromId) || !editor.getShape(toId)) return;
  const arrowId = createShapeId();
  editor.createShape<TLArrowShape>({
    id: arrowId,
    type: 'arrow',
    props: { color: 'violet', size: 's', dash: 'solid', arrowheadEnd: 'triangle' },
  });
  editor.createBindings([
    {
      id: createBindingId(),
      type: 'arrow',
      fromId: arrowId,
      toId: fromId,
      props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' },
    },
    {
      id: createBindingId(),
      type: 'arrow',
      fromId: arrowId,
      toId: toId,
      props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' },
    },
  ]);
}
