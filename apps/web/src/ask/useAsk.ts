/**
 * The Ask pipeline, client side. Given a prompt and one or more source cards,
 * opens an SSE connection to /api/ask, creates a single response card adjacent
 * to the sources (a doc or a table — the server picks), streams the answer in,
 * and draws a provenance edge from each source to the answer.
 *
 * This is the one AI interaction of the PDF journey (docs/PDF-JOURNEY.md): the
 * same code path serves a typed question and a predefined seed pill.
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
import { startStreaming, stopStreaming } from '../agents/streaming';
import { setResponsePdfSource } from '../pdf/provenance';

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
  const [error, setError] = useState<string | null>(null);
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

      // Place the answer just to the right of the sources' combined bounds.
      const boxes = sourceIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      const placeX = boxes.length ? Math.max(...boxes.map((b) => b.maxX)) + 72 : 0;
      const placeY = boxes.length ? Math.min(...boxes.map((b) => b.minY)) : 0;
      // Citations on the answer flip this source PDF (the first PDF in the set).
      const pdfSourceId = sourceShapes.find((s) => s.type === 'pdf-card')?.id ?? null;

      setIsAsking(true);
      setError(null);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      let responseId: TLShapeId | null = null;
      const apply = (event: AskEvent) => {
        responseId = applyAskEvent(editor, event, { placeX, placeY, sourceIds, responseId, pdfSourceId });
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
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
      } finally {
        if (responseId) stopStreaming(responseId);
        setIsAsking(false);
      }
    },
    [editor, isAsking],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsAsking(false);
  }, []);

  return { ask, isAsking, error, abort };
}

interface AskCtx {
  placeX: number;
  placeY: number;
  sourceIds: TLShapeId[];
  responseId: TLShapeId | null;
  pdfSourceId: TLShapeId | null;
}

function applyAskEvent(editor: Editor, event: AskEvent, ctx: AskCtx): TLShapeId | null {
  switch (event.type) {
    case 'card.create': {
      const id = createShapeId();
      if (ctx.pdfSourceId) setResponsePdfSource(id, ctx.pdfSourceId);
      if (event.shape === 'table') {
        const columns = event.columns ?? [];
        const rows = event.rows ?? [];
        editor.createShape<TableCardShape>({
          id,
          type: 'table-card',
          x: ctx.placeX,
          y: ctx.placeY,
          props: {
            w: TABLE_CARD_SIZE.w,
            h: Math.max(TABLE_CARD_SIZE.h, 56 + rows.length * 44),
            columns,
            rows,
          },
        });
      } else {
        editor.createShape<DocCardShape>({
          id,
          type: 'doc-card',
          x: ctx.placeX,
          y: ctx.placeY,
          props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, title: event.title ?? '', text: '' },
        });
        startStreaming(id);
      }
      for (const from of ctx.sourceIds) createEdge(editor, from, id);
      return id;
    }
    case 'card.delta': {
      if (!ctx.responseId) return ctx.responseId;
      const shape = editor.getShape(ctx.responseId);
      if (shape && 'text' in (shape.props as object)) {
        editor.updateShape({
          id: ctx.responseId,
          type: shape.type,
          props: { text: (shape.props as { text: string }).text + event.textDelta },
        } as Parameters<typeof editor.updateShape>[0]);
      }
      return ctx.responseId;
    }
    case 'card.done':
      if (ctx.responseId) stopStreaming(ctx.responseId);
      return ctx.responseId;
    default:
      return ctx.responseId;
  }
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
