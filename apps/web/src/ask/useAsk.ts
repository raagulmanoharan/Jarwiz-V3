/**
 * The Ask pipeline, client side. The answer streams straight onto the canvas as
 * a live "draft" card in its source's lane — doc text grows, a table builds
 * column header then fills cell by cell — while the camera gently follows. The
 * draft's Keep / Discard controls (DraftControls) let the user confirm or throw
 * it away. The same path serves a typed question and a predefined seed pill.
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
import { clearDraft, getDraft, setDraft, updateDraft } from './draft';
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
      if (!trimmed || sourceIds.length === 0 || isAsking || getDraft()) return;

      const sourceShapes = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s));
      const sources = sourceShapes.map((s) => toSource(s)).filter((s): s is AskSource => Boolean(s));
      if (sources.length === 0) return;

      const pdfSourceId = sourceShapes.find((s) => s.type === 'pdf-card')?.id ?? null;

      setIsAsking(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      let cardId: TLShapeId | null = null;
      let cols: string[] = [];
      let rows: string[][] = [];
      let lastFollow = 0;

      const follow = () => {
        if (!cardId) return;
        const now = Date.now();
        if (now - lastFollow < 280) return;
        lastFollow = now;
        followCard(editor, cardId);
      };

      const apply = (event: AskEvent) => {
        switch (event.type) {
          case 'card.create': {
            const id = createShapeId();
            cardId = id;
            const at = placeInLane(
              editor,
              sourceIds,
              event.shape === 'table' ? TABLE_CARD_SIZE.w : DOC_CARD_SIZE.w,
              event.shape === 'table' ? TABLE_CARD_SIZE.h : DOC_CARD_SIZE.h,
            );
            if (event.shape === 'table') {
              cols = (event.columns ?? []).slice(0, 6);
              rows = Array.from({ length: event.rowCount ?? 0 }, () => cols.map(() => ''));
              editor.createShape<TableCardShape>({
                id,
                type: 'table-card',
                x: at.x,
                y: at.y,
                props: { w: TABLE_CARD_SIZE.w, h: TABLE_CARD_SIZE.h, columns: cols, rows },
              });
            } else {
              editor.createShape<DocCardShape>({
                id,
                type: 'doc-card',
                x: at.x,
                y: at.y,
                props: {
                  w: DOC_CARD_SIZE.w,
                  h: DOC_CARD_SIZE.h,
                  title: event.title ?? '',
                  text: '',
                  sourcePdfId: pdfSourceId ?? '',
                },
              });
            }
            if (pdfSourceId) setResponsePdfSource(id, pdfSourceId);
            startStreaming(id);
            const arrowIds = sourceIds.map((from) => createEdge(editor, from, id)).filter(Boolean) as TLShapeId[];
            setDraft({ id, arrowIds, status: 'streaming', prompt: trimmed, sourceIds, shape: event.shape, pdfSourceId });
            frameCard(editor, id);
            break;
          }
          case 'card.title': {
            if (cardId && editor.getShape(cardId)?.type === 'doc-card') {
              editor.updateShape<DocCardShape>({ id: cardId, type: 'doc-card', props: { title: event.title } });
            }
            break;
          }
          case 'card.delta': {
            if (!cardId) break;
            const s = editor.getShape(cardId);
            if (s && 'text' in (s.props as object)) {
              editor.updateShape({
                id: cardId,
                type: s.type,
                props: { text: (s.props as { text: string }).text + event.textDelta },
              } as Parameters<typeof editor.updateShape>[0]);
            }
            follow();
            break;
          }
          case 'table.cell': {
            if (!cardId) break;
            if (rows[event.r]) {
              rows = rows.map((r) => [...r]);
              rows[event.r]![event.c] = event.text;
              editor.updateShape<TableCardShape>({ id: cardId, type: 'table-card', props: { rows } });
            }
            follow();
            break;
          }
          case 'card.done':
            if (cardId) stopStreaming(cardId);
            break;
          case 'done':
            updateDraft({ status: 'done' });
            break;
          case 'error':
            updateDraft({ status: 'error', error: event.message });
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
        if (cardId) stopStreaming(cardId);
        updateDraft({ status: 'done' });
      } catch (err) {
        if (cardId) stopStreaming(cardId);
        if (err instanceof Error && err.name !== 'AbortError') {
          if (getDraft()) updateDraft({ status: 'error', error: err.message });
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

/** Keep the streamed draft — log it and drop the draft state (the card stays). */
export function finalizeDraft(editor: Editor): TLShapeId | null {
  const d = getDraft();
  if (!d || d.status === 'error') return null;
  stopStreaming(d.id);
  logEvent(editor, {
    kind: 'artefact',
    label: d.prompt,
    detail: d.shape === 'table' ? 'Table' : 'Doc',
    shapeIds: [d.id, ...d.sourceIds],
  });
  clearDraft();
  return d.id;
}

/** Throw the streamed draft away — delete the card and its provenance edges. */
export function discardDraft(editor: Editor): void {
  const d = getDraft();
  if (!d) return;
  stopStreaming(d.id);
  editor.deleteShapes([d.id, ...d.arrowIds]);
  clearDraft();
}

/* ── camera ──────────────────────────────────────────────────────────────── */

/** Frame a card comfortably in view (used when the draft first appears). */
function frameCard(editor: Editor, id: TLShapeId): void {
  const b = editor.getShapePageBounds(id);
  if (b) editor.zoomToBounds(b, { animation: { duration: 360, easing: (t) => 1 - Math.pow(1 - t, 3) }, targetZoom: 0.9 });
}

/** Pan to keep a growing card's latest content in view, without yanking zoom. */
function followCard(editor: Editor, id: TLShapeId): void {
  const b = editor.getShapePageBounds(id);
  if (!b) return;
  const vp = editor.getViewportPageBounds();
  const pad = 100 / editor.getZoomLevel();
  if (b.maxY > vp.maxY - pad) {
    const y = b.maxY - vp.h / 2 + pad;
    editor.centerOnPoint({ x: vp.center.x, y }, { animation: { duration: 250 } });
  }
}

/* ── layout ──────────────────────────────────────────────────────────────── */

/**
 * Stitch-style per-source lanes: each source establishes a horizontal lane at
 * its top edge, and its answers are appended to the right end of THAT lane. So
 * every document gets its own row and the work fans out left-to-right within it.
 */
export function placeInLane(
  editor: Editor,
  sourceIds: TLShapeId[],
  w: number,
  h: number,
): { x: number; y: number } {
  const bounds = (id: TLShapeId) => editor.getShapePageBounds(id);
  const all = editor
    .getCurrentPageShapes()
    .filter((s) => s.type !== 'arrow')
    .map((s) => bounds(s.id))
    .filter((b): b is NonNullable<ReturnType<typeof bounds>> => Boolean(b));
  if (all.length === 0) {
    const c = editor.getViewportPageBounds().center;
    return { x: c.x - w / 2, y: c.y - h / 2 };
  }
  const srcBounds = sourceIds
    .map((id) => bounds(id))
    .filter((b): b is NonNullable<ReturnType<typeof bounds>> => Boolean(b));
  const GAP = 48;
  const LANE_TOL = Math.max(80, h * 0.6);
  const laneTop = srcBounds.length
    ? Math.min(...srcBounds.map((b) => b.minY))
    : Math.min(...all.map((b) => b.minY));
  const sameLane = all.filter((b) => Math.abs(b.minY - laneTop) < LANE_TOL);
  const anchor = sameLane.length ? sameLane : srcBounds;
  const x = (anchor.length ? Math.max(...anchor.map((b) => b.maxX)) : Math.max(...all.map((b) => b.maxX))) + GAP;
  return { x, y: laneTop };
}

/** A quiet provenance link — a gently curved, dotted, low-key arrow that only
 *  stands out when you click it. Returns the arrow id (for discard). */
function createEdge(editor: Editor, fromId: TLShapeId, toId: TLShapeId): TLShapeId | null {
  if (!editor.getShape(fromId) || !editor.getShape(toId)) return null;
  const arrowId = createShapeId();
  editor.createShape<TLArrowShape>({
    id: arrowId,
    type: 'arrow',
    props: { color: 'grey', size: 's', dash: 'dotted', bend: 28, arrowheadStart: 'none', arrowheadEnd: 'arrow' },
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
  return arrowId;
}
