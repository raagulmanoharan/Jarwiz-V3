/**
 * The Ask pipeline, client side. The answer streams straight onto the canvas as
 * a live "draft" card in its source's lane — doc text grows, a table builds
 * column header then fills cell by cell — while the camera gently follows. The
 * draft's Keep / Discard controls (DraftControls) let the user confirm or throw
 * it away. The same path serves a typed question and a predefined seed pill.
 *
 * One run at a time: a single module-level record tracks the live Ask/regen and
 * its AbortController, so Cancel always targets the run that's actually
 * streaming and a second run can't start (and race the first) underneath it.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createBindingId,
  createShapeId,
  renderPlaintextFromRichText,
  useEditor,
  type Editor,
  type TLArrowShape,
  type TLRichText,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import type { AskEvent, AskShape, AskSource } from '@jarwiz/shared';
import {
  DIAGRAM_CARD_SIZE,
  DOC_CARD_SIZE,
  TABLE_CARD_SIZE,
  affinityColor,
  type DiagramCardShape,
  type DocCardShape,
  type NoteCardShape,
  type TableCardShape,
} from '../shapes';
import { readSSE } from '../agents/sse';
import { startStreaming, stopStreaming } from '../agents/streaming';
import { setResponsePdfSource } from '../pdf/provenance';
import { clearDraft, getDraft, setDraft, updateDraft } from './draft';
import { clearRegen, setRegen } from './regen';
import { clearClarify, setClarify } from './clarify';
import { setProvenance } from './provenance';
import { logEvent } from '../log/eventLog';
import { clearAgentTask, setAgentTask } from '../agents/agentTask';

/** The single AI run currently in flight — an Ask or an in-place regen — so a
 *  floating control (RegenControls / DraftControls) can truly cancel the model
 *  call from afar. Exactly one run may be live at a time (`ask` refuses to
 *  start another), so this abort can never hit the wrong run. */
interface ActiveRun {
  controller: AbortController;
  kind: 'ask' | 'regen';
  cardId?: TLShapeId;
}
let activeRun: ActiveRun | null = null;
/** Cancel the in-flight Ask/regen, if any (aborts the fetch/model stream). */
export function cancelActiveAsk(): void {
  activeRun?.controller.abort();
}

/** The answer card kinds that can be refined in place, and the AskShape we send
 *  to the server as the "keep this format" hint for each. */
const REFINABLE: Record<string, AskShape> = {
  'doc-card': 'doc',
  'table-card': 'table',
  'diagram-card': 'diagram',
};

/** Does a server-chosen shape land on the SAME card kind we're refining? A
 *  doc-card hosts both prose ('doc') and bullets/checklists ('list'), so either
 *  updates it in place; a format change (e.g. 'table') falls through to a new
 *  card. Returns true only when the existing card should be regenerated. */
function isInPlace(cardType: string | undefined, shape: AskShape): boolean {
  if (cardType === 'doc-card') return shape === 'doc' || shape === 'list';
  if (cardType === 'table-card') return shape === 'table';
  if (cardType === 'diagram-card') return shape === 'diagram';
  return false;
}

/** Flatten a tldraw rich-text doc to plain text; safe on missing input. */
function plainText(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try {
    return renderPlaintextFromRichText(editor, richText as TLRichText).trim();
  } catch {
    return '';
  }
}

/** Build the server-side source descriptor from a shape — a rich card or a
 *  native primitive (canvas pivot P1: a selected sketch/box/label is askable). */
function toSource(editor: Editor, shape: TLShape): AskSource | null {
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
    case 'diagram-card':
      // The diagram's own Mermaid source is the context a refinement builds on
      // ("add a node" works off the existing graph). Sent as a doc source.
      return { kind: 'doc', title: String(p.title ?? ''), text: String(p.code ?? '') };
    case 'image-card': {
      // An image is a vision input — sent as its data URL (the model sees it on
      // the API path; the dev sidecar notes it but can't).
      const src = String(p.src ?? '');
      if (!src.startsWith('data:image/')) return null;
      return { kind: 'image', title: String(p.name ?? ''), dataUrl: src };
    }
    // ── Native primitives — selected shapes/text/connectors become context ──
    case 'geo':
    case 'text':
    case 'note':
    case 'arrow': {
      const text = plainText(editor, p.richText);
      return text ? { kind: 'note', text } : null; // unlabelled = no content to send
    }
    case 'frame': {
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      return name ? { kind: 'note', text: `Section: ${name}` } : null;
    }
    default:
      return null;
  }
}

/** A short label for an Ask source — its title, else a friendly kind name. */
function sourceLabel(shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '';
  if (title) return title.length > 28 ? `${title.slice(0, 27)}…` : title;
  if (shape.type === 'pdf-card') return typeof p.name === 'string' ? String(p.name) : 'PDF';
  const fallback: Record<string, string> = {
    'doc-card': 'Doc', 'note-card': 'Note', 'table-card': 'Table', 'diagram-card': 'Diagram',
    'image-card': 'Image', 'link-card': 'Link', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section',
  };
  return fallback[shape.type] ?? 'Card';
}

export function useAsk() {
  const editor = useEditor();
  const [isAsking, setIsAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (
      prompt: string,
      sourceIds: TLShapeId[],
      opts?: { targetId?: TLShapeId | null; skipClarify?: boolean },
    ) => {
      const trimmed = prompt.trim();
      // A sourceless ask is allowed — a free-standing query from the prompt bar
      // drops its answer on the canvas. Only the selection-grounded paths require
      // sources, so we don't gate on sourceIds being non-empty here.
      // `activeRun` is the global one-run-at-a-time gate: `isAsking` is
      // per-hook-instance and a regen holds no draft, so without it two runs
      // could race and Cancel would target the wrong one.
      if (!trimmed || isAsking || activeRun || getDraft()) return;
      clearClarify(); // a fresh ask supersedes any pending question

      const sourceShapes = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s));
      const sources = sourceShapes.map((s) => toSource(editor, s)).filter((s): s is AskSource => Boolean(s));
      // If a selection was given but none of it is usable as a source, don't run
      // (a no-op selection). A deliberately sourceless ask (no ids) proceeds.
      if (sourceIds.length > 0 && sources.length === 0) return;

      // Human-readable labels for the "Based on:" header (show-your-work, 2.2).
      const sourceLabels = sourceShapes.map((s) => sourceLabel(s));

      const pdfSourceId = sourceShapes.find((s) => s.type === 'pdf-card')?.id ?? null;

      // In-place regeneration: when the prompt targets an existing answer card,
      // we tell the server its current shape so a same-type tweak keeps that
      // format, and we overwrite the card live instead of spawning a new one.
      const targetType = opts?.targetId ? editor.getShape(opts.targetId)?.type : undefined;
      const targetId = targetType && REFINABLE[targetType] ? opts!.targetId! : null;
      const currentShape: AskShape | undefined = targetType ? REFINABLE[targetType] : undefined;

      setIsAsking(true);
      const ac = new AbortController();
      abortRef.current = ac;
      activeRun = { controller: ac, kind: targetId ? 'regen' : 'ask', cardId: targetId ?? undefined };
      const { signal } = ac;

      let cardId: TLShapeId | null = null;
      let cols: string[] = [];
      let rows: string[][] = [];
      // Affinity diagrams aren't one card — they're a board of sticky notes laid
      // out in labelled columns. `createdIds` is every shape made (for framing),
      // `affinity` holds the per-cluster layout cursors.
      let createdIds: TLShapeId[] = [];
      let affinity: { laneX: number; laneY: number; cols: Map<number, { x: number; ynext: number }> } | null =
        null;
      let lastFollow = 0;
      // When regenerating in place, a single history mark wraps the clear +
      // every streamed delta so one Cmd+Z restores the card's previous content.
      let inPlaceMark: string | null = null;
      // Set when the run errors (server `error` event or a thrown fetch/stream
      // failure); the finally block bails an in-place regen back to its mark so
      // a failure can't commit a blanked card.
      let runFailed = false;
      const taskId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Errors must never be silent. A streaming draft shows them on its own
      // controls; a run with no draft — failed before `card.create`, or an
      // in-place regen (regen never creates a draft) — surfaces through the
      // agent-task layer, which renders an error pill with Retry.
      const surfaceError = (message: string) => {
        if (getDraft()) {
          updateDraft({ status: 'error', error: message });
          return;
        }
        setAgentTask({
          id: taskId,
          anchorId: cardId,
          status: 'error',
          label: targetId ? 'Regenerate' : 'Ask',
          error: message,
          onRetry: () => {
            clearAgentTask(taskId);
            void ask(trimmed, sourceIds, opts);
          },
        });
      };

      const framed = () => (affinity ? createdIds : cardId ? [cardId] : []);

      const follow = () => {
        const ids = framed();
        if (ids.length === 0) return;
        const now = Date.now();
        if (now - lastFollow < 280) return;
        lastFollow = now;
        followCard(editor, ids, sourceIds);
      };

      // Register an affinity sticky: the first one becomes the draft anchor (and
      // gets the provenance edges); the rest join its group.
      const registerAffinity = (id: TLShapeId) => {
        createdIds.push(id);
        const d = getDraft();
        if (!d) {
          const arrowIds = sourceIds
            .map((from) => createEdge(editor, from, id))
            .filter(Boolean) as TLShapeId[];
          setDraft({
            id,
            groupIds: [],
            arrowIds,
            status: 'streaming',
            prompt: trimmed,
            sourceIds,
            shape: 'affinity',
            pdfSourceId,
          });
          frameCard(editor, [id], sourceIds);
        } else {
          updateDraft({ groupIds: createdIds.filter((x) => x !== d.id) });
        }
      };

      const apply = (event: AskEvent) => {
        switch (event.type) {
          case 'clarify': {
            // Ambiguous request — surface the question instead of guessing. The
            // run ends here; ClarifyLayer re-asks with the answer folded in.
            setClarify({
              question: event.question,
              options: event.options,
              prompt: trimmed,
              sourceIds,
              targetId,
            });
            break;
          }
          case 'card.create': {
            // Refinement that keeps the card's format → regenerate in place:
            // mark history, clear the existing card, and stream the new version
            // into it. No new shape, no provenance edges, no Keep/Discard draft
            // (the change is instant and Cmd+Z restores the old content).
            if (targetId && isInPlace(targetType, event.shape) && editor.getShape(targetId)) {
              cardId = targetId;
              createdIds = [targetId];
              inPlaceMark = editor.markHistoryStoppingPoint('regenerate-card');
              const t = editor.getShape(targetId)!;
              if (t.type === 'diagram-card') {
                editor.updateShape<DiagramCardShape>({
                  id: targetId,
                  type: 'diagram-card',
                  props: { code: '' },
                });
              } else if (t.type === 'table-card') {
                cols = (event.columns ?? []).slice(0, 6);
                rows = Array.from({ length: event.rowCount ?? 0 }, () => cols.map(() => ''));
                editor.updateShape<TableCardShape>({
                  id: targetId,
                  type: 'table-card',
                  props: { columns: cols, rows },
                });
              } else {
                // Keep the existing title; a regenerated "# " line overwrites it
                // via card.title, but a plain tweak ("shorter") keeps it intact.
                editor.updateShape<DocCardShape>({ id: targetId, type: 'doc-card', props: { text: '' } });
              }
              startStreaming(targetId);
              setRegen({ id: targetId, status: 'streaming' });
              follow();
              break;
            }
            if (event.shape === 'affinity') {
              const at = placeInLane(editor, sourceIds, AFFINITY_NOTE_W * 3 + AFFINITY_CLUSTER_GAP * 2, 360);
              affinity = { laneX: at.x, laneY: at.y, cols: new Map() };
              createdIds = [];
              break;
            }
            const id = createShapeId();
            cardId = id;
            createdIds = [id];
            if (event.shape === 'diagram') {
              const at = placeInLane(editor, sourceIds, DIAGRAM_CARD_SIZE.w, DIAGRAM_CARD_SIZE.h);
              editor.createShape<DiagramCardShape>({
                id,
                type: 'diagram-card',
                x: at.x,
                y: at.y,
                props: { w: DIAGRAM_CARD_SIZE.w, h: DIAGRAM_CARD_SIZE.h, code: '', title: trimmed.slice(0, 70) },
              });
            } else if (event.shape === 'table') {
              const at = placeInLane(editor, sourceIds, TABLE_CARD_SIZE.w, TABLE_CARD_SIZE.h);
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
              const at = placeInLane(editor, sourceIds, DOC_CARD_SIZE.w, DOC_CARD_SIZE.h);
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
            // Record what this answer was built from (show-your-work, 2.2).
            setProvenance(id, sourceIds, sourceLabels);
            startStreaming(id);
            const arrowIds = sourceIds.map((from) => createEdge(editor, from, id)).filter(Boolean) as TLShapeId[];
            setDraft({ id, arrowIds, status: 'streaming', prompt: trimmed, sourceIds, shape: event.shape, pdfSourceId });
            frameCard(editor, [id], sourceIds);
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
            if (!s) break;
            if (s.type === 'diagram-card') {
              editor.updateShape<DiagramCardShape>({
                id: cardId,
                type: 'diagram-card',
                props: { code: (s.props as { code: string }).code + event.textDelta },
              });
            } else if ('text' in (s.props as object)) {
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
          case 'affinity.cluster': {
            if (!affinity) break;
            const colX = affinity.laneX + event.index * (AFFINITY_NOTE_W + AFFINITY_CLUSTER_GAP);
            const id = createShapeId();
            editor.createShape<NoteCardShape>({
              id,
              type: 'note-card',
              x: colX,
              y: affinity.laneY,
              props: { w: AFFINITY_NOTE_W, h: AFFINITY_LABEL_H, text: event.label, color: affinityColor(event.index) },
            });
            affinity.cols.set(event.index, { x: colX, ynext: affinity.laneY + AFFINITY_LABEL_H + AFFINITY_GAP });
            registerAffinity(id);
            follow();
            break;
          }
          case 'affinity.note': {
            if (!affinity) break;
            const col = affinity.cols.get(event.cluster);
            if (!col) break;
            const id = createShapeId();
            editor.createShape<NoteCardShape>({
              id,
              type: 'note-card',
              x: col.x,
              y: col.ynext,
              props: { w: AFFINITY_NOTE_W, h: AFFINITY_NOTE_H, text: event.text, color: affinityColor(event.cluster) },
            });
            col.ynext += AFFINITY_NOTE_H + AFFINITY_GAP;
            registerAffinity(id);
            follow();
            break;
          }
          case 'card.done':
            if (cardId) stopStreaming(cardId);
            break;
          case 'done':
            updateDraft({ status: 'done' });
            if (affinity && createdIds.length > 0) frameCard(editor, createdIds, sourceIds);
            break;
          case 'error':
            runFailed = true;
            surfaceError(event.message);
            break;
        }
      };

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, sources, currentShape, skipClarify: opts?.skipClarify }),
          signal,
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.error ?? `Ask failed (${res.status})`);
        }
        await readSSE<AskEvent>(res.body, apply);
        if (cardId) stopStreaming(cardId);
        // Don't let stream-end mark the draft done if a server `error` event
        // already flagged it — that would hide the failure from DraftControls.
        if (!runFailed) updateDraft({ status: 'done' });
      } catch (err) {
        if (cardId) stopStreaming(cardId);
        if (err instanceof Error && err.name !== 'AbortError') {
          runFailed = true;
          surfaceError(err.message);
        }
      } finally {
        if (inPlaceMark) {
          if (signal.aborted || runFailed) {
            // Cancelled or failed mid-regeneration → restore the card's
            // previous content (never commit the blanked/partial card).
            editor.bailToMark(inPlaceMark);
          } else {
            // Collapse the clear + all deltas into one undo step, so a single
            // Cmd+Z restores the card's content from before this refinement.
            editor.squashToMark(inPlaceMark);
          }
        }
        clearRegen();
        if (activeRun?.controller === ac) activeRun = null;
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

const ARTEFACT_LABEL: Record<string, string> = {
  table: 'Table',
  diagram: 'Diagram',
  affinity: 'Sticky notes',
  list: 'List',
  doc: 'Doc',
};

/** Keep the streamed draft — log it and drop the draft state (the card stays). */
export function finalizeDraft(editor: Editor): TLShapeId | null {
  const d = getDraft();
  if (!d || d.status === 'error') return null;
  stopStreaming(d.id);
  logEvent(editor, {
    kind: 'artefact',
    label: d.prompt,
    detail: ARTEFACT_LABEL[d.shape] ?? 'Doc',
    shapeIds: [d.id, ...(d.groupIds ?? []), ...d.sourceIds],
  });
  clearDraft();
  // Select the kept answer so its refinement affordance is immediately at hand —
  // typing a same-type tweak regenerates this card in place.
  editor.select(d.id, ...(d.groupIds ?? []));
  return d.id;
}

/** Throw the streamed draft away — abort the model call, then delete the
 *  card(s) and provenance edges. */
export function discardDraft(editor: Editor): void {
  const d = getDraft();
  if (!d) return;
  cancelActiveAsk(); // stop the model stream, not just hide the card
  stopStreaming(d.id);
  editor.deleteShapes([d.id, ...(d.groupIds ?? []), ...d.arrowIds]);
  clearDraft();
}

/* ── camera ──────────────────────────────────────────────────────────────── */

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Combined bounds of the response shape(s) and the source(s) they came from. */
function pairBounds(editor: Editor, responseIds: TLShapeId[], sourceIds: TLShapeId[]) {
  const boxes = [...responseIds, ...sourceIds]
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
}

/** Frame the source + response together, centred (used when the draft appears). */
function frameCard(editor: Editor, responseIds: TLShapeId[], sourceIds: TLShapeId[]): void {
  const u = pairBounds(editor, responseIds, sourceIds);
  if (u) editor.zoomToBounds(u, { animation: { duration: 420, easing: easeOutCubic }, inset: 130 });
}

/** Keep the source + response centred as the response grows — re-frame only
 *  when the pair has outgrown the viewport, so it doesn't jitter when it fits. */
function followCard(editor: Editor, responseIds: TLShapeId[], sourceIds: TLShapeId[]): void {
  const u = pairBounds(editor, responseIds, sourceIds);
  if (!u) return;
  if (editor.getViewportPageBounds().contains(u)) return;
  editor.zoomToBounds(u, { animation: { duration: 280, easing: easeOutCubic }, inset: 130 });
}

/* ── affinity layout ───────────────────────────────────────────────────────
 * Sticky notes laid out in labelled columns — a heading sticky per cluster,
 * its notes stacked beneath it. */
const AFFINITY_NOTE_W = 200;
const AFFINITY_LABEL_H = 40;
const AFFINITY_NOTE_H = 96;
const AFFINITY_GAP = 12;
const AFFINITY_CLUSTER_GAP = 28;

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
