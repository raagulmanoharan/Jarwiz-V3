/**
 * The Ask pipeline, client side. The answer streams straight onto the canvas as
 * a live "draft" card in its source's lane — doc text grows, a table builds
 * column header then fills cell by cell — while the camera gently follows. When
 * the run settles, the draft is kept automatically (DraftAutoKeep) and the card
 * just stays — delete it to throw one away. The same path serves a typed
 * question and a predefined seed pill.
 *
 * One run at a time: a single module-level record tracks the live Ask/regen and
 * its AbortController, so Cancel always targets the run that's actually
 * streaming and a second run can't start (and race the first) underneath it.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createShapeId,
  renderPlaintextFromRichText,
  useEditor,
  type Box,
  type Editor,
  type TLRichText,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw';
import type { AskEvent, AskShape, AskSource } from '@jarwiz/shared';
import {
  DIAGRAM_CARD_SIZE,
  DOC_CARD_SIZE,
  TABLE_CARD_SIZE,
  PROTOTYPE_CARD_SIZE,
  DASHBOARD_CARD_SIZE,
  MAP_CARD_SIZE,
  affinityColor,
  type DiagramCardShape,
  type DocCardShape,
  type NoteCardShape,
  type TableCardShape,
  type PrototypeCardShape,
  type DashboardCardShape,
  type MapCardShape,
} from '../shapes';
import { readSSE } from '../agents/sse';
import { agentErrorMessage, getBackendSnapshot, reprobeBackend } from '../lib/backend';
import { startStreaming, stopStreaming } from '../agents/streaming';
import { clearDraft, getDraft, setDraft, updateDraft } from './draft';
import { clearRegen, setRegen } from './regen';
import { clearClarify, setClarify } from './clarify';
import { logEvent } from '../log/eventLog';
import { clearAgentError, setAgentError } from '../agents/agentError';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from '../agents/presence';
import { frameBounds } from '../ui/bringIntoView';
import { getShapeTitle } from '../shapes/shapeTitle';
import { getAgent } from '@jarwiz/shared';

/** The single Jarwiz presence identity (routing id 'writer'). Parked on the
 *  source the moment an ask starts, so a click is never met with silence. */
const PRESENCE = getAgent('writer');

/** The single AI run currently in flight — an Ask or an in-place regen — so a
 *  floating control (RegenControls) can truly cancel the model call from afar.
 *  Exactly one run may be live at a time (`ask` refuses to start another), so
 *  this abort can never hit the wrong run. */
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

/** Let an external multi-card run (the debrief recipe) occupy the same
 *  one-run-at-a-time slot as an Ask — so `ask` refuses while it streams, the
 *  auto-sync engine queues behind it, and a cancel (RegenControls) genuinely
 *  aborts it. Returns false when a run is already live. */
export function claimActiveRun(controller: AbortController): boolean {
  if (activeRun || getDraft()) return false;
  activeRun = { controller, kind: 'ask' };
  return true;
}
export function releaseActiveRun(controller: AbortController): void {
  if (activeRun?.controller === controller) activeRun = null;
}

/** Is a run in flight or a draft awaiting Keep/Discard? The auto-sync engine
 *  (sync.ts) waits on this before dispatching a queued update — the same
 *  condition `ask` itself refuses on, so auto-work queues behind the user. */
export function isAskBusy(): boolean {
  return Boolean(activeRun) || Boolean(getDraft());
}

/** The answer card kinds that can be refined in place, and the AskShape we send
 *  to the server as the "keep this format" hint for each. */
export const REFINABLE: Record<string, AskShape> = {
  'doc-card': 'doc',
  'table-card': 'table',
  'diagram-card': 'diagram',
  'prototype-card': 'prototype',
  'dashboard-card': 'dashboard',
  'map-card': 'map',
};

/** Does a server-chosen shape land on the SAME card kind we're refining? A
 *  doc-card hosts both prose ('doc') and bullets/checklists ('list'), so either
 *  updates it in place; a format change (e.g. 'table') falls through to a new
 *  card. Returns true only when the existing card should be regenerated. */
function isInPlace(cardType: string | undefined, shape: AskShape): boolean {
  if (cardType === 'doc-card') return shape === 'doc' || shape === 'list';
  if (cardType === 'table-card') return shape === 'table';
  if (cardType === 'diagram-card') return shape === 'diagram';
  if (cardType === 'prototype-card') return shape === 'prototype';
  if (cardType === 'dashboard-card') return shape === 'dashboard';
  if (cardType === 'map-card') return shape === 'map';
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
 *  native primitive (canvas pivot P1: a selected sketch/box/label is askable).
 *  A shape with no actual CONTENT returns null: grounding an ask on an empty
 *  card gives the model nothing, and it fills the vacuum with confident
 *  invention (dogfood 2026-07-04 finding #1 — an empty card produced thirty
 *  sticky notes riffing on the system prompt). */
function toSource(editor: Editor, shape: TLShape): AskSource | null {
  const p = shape.props as Record<string, unknown>;
  switch (shape.type) {
    case 'pdf-card': {
      const assetId = String(p.assetId ?? '');
      return assetId ? { kind: 'pdf', assetId, title: String(p.name ?? '') } : null;
    }
    case 'sheet-card': {
      // A spreadsheet grounds on its cells — the server extracts them from the
      // stored file by assetId (kind 'sheet' routes to the sheet parser).
      const assetId = String(p.assetId ?? '');
      return assetId && p.status === 'ready' ? { kind: 'sheet', assetId, title: String(p.name ?? '') } : null;
    }
    case 'doc-card': {
      const text = String(p.text ?? '');
      // A title alone is not groundable content — it's usually just a name.
      return text.trim() ? { kind: 'doc', title: getShapeTitle(shape), text } : null;
    }
    case 'note-card': {
      const text = String(p.text ?? '');
      return text.trim() ? { kind: 'note', text } : null;
    }
    case 'table-card': {
      const cols = (p.columns as string[]) ?? [];
      const rows = (p.rows as string[][]) ?? [];
      if (![...cols, ...rows.flat()].some((c) => c?.trim())) return null;
      const text = [cols, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      // Tables keep their primitive title in shape.meta (no title prop).
      return { kind: 'table', title: getShapeTitle(shape), text };
    }
    case 'diagram-card': {
      // The diagram's own Mermaid source is the context a refinement builds on
      // ("add a node" works off the existing graph). Sent as a doc source.
      const code = String(p.code ?? '');
      return code.trim() ? { kind: 'doc', title: getShapeTitle(shape), text: code } : null;
    }
    case 'image-card': {
      // An image is a vision input — sent as its data URL (the model sees it on
      // the API path; the dev sidecar notes it but can't).
      const src = String(p.src ?? '');
      if (!src.startsWith('data:image/')) return null;
      return { kind: 'image', title: String(p.name ?? ''), dataUrl: src };
    }
    case 'dashboard-card': {
      // The dashboard's own OpenUI Lang spec is the context — asking about it
      // reads the KPIs/charts/table it already holds, and a refinement ("add a
      // margin chart") builds on the existing spec. Sent as a doc source.
      const spec = String((p as { spec?: unknown }).spec ?? '');
      return spec.trim() ? { kind: 'doc', title: getShapeTitle(shape), text: `Current dashboard (OpenUI Lang spec):\n${spec}` } : null;
    }
    case 'map-card': {
      // The map grounds on its stops as text — a refine ("add a lunch stop")
      // builds on the existing plan, and any ask can read the trip.
      const stops = Array.isArray(p.stops) ? (p.stops as Array<Record<string, unknown>>) : [];
      if (stops.length === 0) return null;
      const lines = stops.map((s, i) => {
        const when = [s.day, s.time].filter(Boolean).join(' ');
        return `${i + 1}. ${String(s.name ?? '')}${when ? ` (${when})` : ''}${s.note ? ` — ${String(s.note)}` : ''} [${String(s.query ?? '')}]`;
      });
      const intro = typeof p.intro === 'string' && p.intro.trim() ? `${p.intro.trim()}\n` : '';
      return { kind: 'doc', title: getShapeTitle(shape), text: `Current map (stops in order):\n${intro}${lines.join('\n')}` };
    }
    case 'machine-card': {
      // A machine block grounds its answer on the subject typed into it; the
      // block becomes the answer's provenance source and its placement anchor.
      const subject = String((p as { subject?: unknown }).subject ?? '').trim();
      return subject ? { kind: 'note', text: `Analysis subject: ${subject}` } : null;
    }
    case 'link-card': {
      // Preview + extracted page text — the model answers from the page's
      // actual content, not just its meta tags.
      const url = String(p.url ?? '');
      if (!url.trim()) return null;
      const bits = [String(p.title ?? ''), String(p.description ?? ''), url].filter((s) => s.trim());
      const pageText = String(p.text ?? '').trim();
      const body = `Link: ${bits.join('\n')}${pageText ? `\n\nPage content:\n${pageText}` : ''}`;
      // `url` rides along so the server can direct link citations at it.
      return { kind: 'doc', title: getShapeTitle(shape), text: body, url };
    }
    case 'youtube-card': {
      // A video grounds on its caption transcript (fetched at paste time).
      // With no captions the source stays honest: title only, clearly said.
      const url = String(p.url ?? '');
      if (!url.trim()) return null;
      const title = getShapeTitle(shape);
      const stored = String(p.text ?? '').trim();
      const text =
        stored ||
        `This is the YouTube video "${title || url}". Its captions have not been read — only the title is known; never guess what is said in it.`;
      // Watched frames ride along as asset ids → the server loads them as
      // vision inputs; `url` lets answers cite the video like any web page.
      const frames = Array.isArray(p.frames) ? (p.frames as string[]).slice(0, 12) : undefined;
      return { kind: 'youtube', title, text, url, frameAssetIds: frames?.length ? frames : undefined };
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
    case 'group': {
      // A generated flowchart is a group — asking about the group means
      // asking about everything inside it (node labels, connector labels).
      const parts: string[] = [];
      for (const cid of editor.getSortedChildIdsForParent(shape.id)) {
        const child = editor.getShape(cid);
        if (!child) continue;
        const cs = toSource(editor, child);
        if (cs && 'text' in cs && cs.text?.trim()) parts.push(cs.text.trim());
      }
      return parts.length ? { kind: 'note', text: `Diagram contents:\n${parts.join('\n')}` } : null;
    }
    default:
      return null;
  }
}

/** A short label for an Ask source — its primitive title, else a friendly kind
 *  name. Used by the auto-sync pill ("Updated to match …"). */
export function sourceLabel(shape: TLShape): string {
  const title = getShapeTitle(shape).trim();
  if (title) return title.length > 28 ? `${title.slice(0, 27)}…` : title;
  const fallback: Record<string, string> = {
    'pdf-card': 'PDF', 'doc-card': 'Text', 'note-card': 'Note', 'table-card': 'Table', 'diagram-card': 'Diagram',
    'prototype-card': 'Prototype', 'map-card': 'Map',
    'image-card': 'Image', 'link-card': 'Link', 'youtube-card': 'Video', 'sheet-card': 'Sheet', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section',
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
      opts?: {
        targetId?: TLShapeId | null;
        skipClarify?: boolean;
        logLabel?: string;
        /** Explicit response shape from the "/" mode selector. */
        forceShape?: AskShape;
        /** Deep research pass — big live-web budget, cited dossier answer. */
        deep?: boolean;
        /** Run a Thinking Machine skill server-side (prompt = the subject). */
        machineId?: string;
      },
    ) => {
      const trimmed = prompt.trim();
      // A sourceless ask is allowed — a free-standing query from the prompt bar
      // drops its answer on the canvas. Only the selection-grounded paths require
      // sources, so we don't gate on sourceIds being non-empty here.
      // `activeRun` is the global one-run-at-a-time gate: `isAsking` is
      // per-hook-instance and a regen holds no draft, so without it two runs
      // could race and Cancel would target the wrong one.
      if (!trimmed || isAsking || activeRun || getDraft()) {
        // One run at a time is deliberate — but a refused ask should never be
        // a silent mystery in the console when something gets stuck.
        console.warn('[jarwiz] ask refused:', {
          empty: !trimmed, isAsking, activeRun: Boolean(activeRun), draft: Boolean(getDraft()),
        });
        return;
      }
      clearClarify(); // a fresh ask supersedes any pending question

      // Presence FIRST, before any network: the avatar parks on the source
      // (or where the answer will land) with a status the instant the user
      // acts — the 5-20s before the first token should never read as silence.
      startPresence(PRESENCE.id);
      setPresenceStatus(PRESENCE.id, 'reading…');
      {
        const anchorId = opts?.targetId ?? sourceIds[0];
        const b = anchorId ? editor.getShapePageBounds(anchorId) : null;
        if (b) setPresenceCursor(PRESENCE.id, b.maxX - 14, b.maxY - 16);
        else {
          const vp = editor.getViewportPageBounds();
          setPresenceCursor(PRESENCE.id, vp.midX, vp.midY);
        }
      }

      const sourceShapes = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s));
      // Shapes with no content simply don't count as context (toSource returned
      // null for them). If the whole selection was empty, the ask proceeds as a
      // free-standing question — same as asking with nothing selected. What
      // must NEVER happen is sending an empty-text "source": given a blank
      // source to ground on, the model fills the vacuum with confident
      // invention (dogfood 2026-07-04 finding #1).
      const sources = sourceShapes.map((s) => toSource(editor, s)).filter((s): s is AskSource => Boolean(s));

      // Provenance tracks the shapes that actually CONTRIBUTED content — an
      // empty card earns no lineage.
      const contributingShapes = sourceShapes.filter((s) => toSource(editor, s) !== null);
      const contributingIds = contributingShapes.map((s) => s.id);

      const pdfSourceId = sourceShapes.find((s) => s.type === 'pdf-card')?.id ?? null;

      // In-place regeneration: when the prompt targets an existing answer card,
      // we tell the server its current shape so a same-type tweak keeps that
      // format, and we overwrite the card live instead of spawning a new one.
      const targetType = opts?.targetId ? editor.getShape(opts.targetId)?.type : undefined;
      const targetId = targetType && REFINABLE[targetType] ? opts!.targetId! : null;
      const currentShape: AskShape | undefined = targetType ? REFINABLE[targetType] : undefined;

      setIsAsking(true);

      // Camera hand-off: the instant the person pans or zooms the board
      // themselves (wheel or a canvas gesture), we stop moving the camera for
      // the rest of this run. The reveal + follow must never fight the hand
      // that's driving (owner ask 2026-07-20). Listeners attach now, so only
      // gestures DURING the run count; disposed in the finally block.
      let cameraYielded = false;
      const yieldCamera = () => { cameraYielded = true; };
      const cameraContainer = editor.getContainer();
      cameraContainer.addEventListener('wheel', yieldCamera, { passive: true });
      cameraContainer.addEventListener('pointerdown', yieldCamera, { passive: true });

      const ac = new AbortController();
      abortRef.current = ac;
      activeRun = { controller: ac, kind: targetId ? 'regen' : 'ask', cardId: targetId ?? undefined };
      const { signal } = ac;

      let cardId: TLShapeId | null = null;
      // A doc card dropped the instant you press enter (see the pre-place block
      // below). Non-null means a skeleton is already streaming on the board, and
      // card.create should ADOPT it rather than spawn a second card.
      let placeholderId: TLShapeId | null = null;
      let cols: string[] = [];
      let rows: string[][] = [];
      // Affinity diagrams aren't one card — they're a board of sticky notes laid
      // out in labelled columns. `createdIds` is every shape made (for framing),
      // `affinity` holds the per-cluster layout cursors.
      let createdIds: TLShapeId[] = [];
      let affinity: { laneX: number; laneY: number; cols: Map<number, { x: number; ynext: number }> } | null =
        null;
      let lastFollow = 0;
      // The latest server stage ("drafting the answer…"). Stage events fire
      // BEFORE card.create, but the draft chip only exists after — carry the
      // stage across so the chip narrates the first-token wait (G3.1).
      let lastStatus: string | null = null;
      // When regenerating in place, a single history mark wraps the clear +
      // every streamed delta so one Cmd+Z restores the card's previous content.
      let inPlaceMark: string | null = null;
      // Set when the run errors (server `error` event or a thrown fetch/stream
      // failure); the finally block bails an in-place regen back to its mark so
      // a failure can't commit a blanked card.
      let runFailed = false;
      const taskId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Errors must never be silent — and they have ONE home: the banner above
      // the composer (agentError.ts), never a popup at a random canvas spot. A
      // failed draft is thrown away (a failure leaves nothing keepable) so the
      // person isn't left hunting for a Discard button on a card off to the
      // side; the reason and its Retry wait right where they'll type next.
      const surfaceError = (message: string) => {
        if (getDraft()) discardDraft(editor);
        setAgentError({
          message,
          onRetry: () => {
            clearAgentError();
            void ask(trimmed, sourceIds, opts);
          },
        });
      };

      const framed = () => (affinity ? createdIds : cardId ? [cardId] : []);

      // Bring the fresh answer into view — unless the person has taken the
      // camera (see cameraYielded) or is editing a card, in which case leave
      // their view alone.
      const frame = (ids: TLShapeId[]) => {
        if (cameraYielded || editor.getEditingShapeId()) return;
        frameCard(editor, ids, sourceIds);
      };

      const follow = () => {
        if (cameraYielded || editor.getEditingShapeId()) return;
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
          recordSources(editor, id, contributingIds, trimmed);
          setDraft({
            id,
            groupIds: [],
            status: 'streaming',
            prompt: trimmed,
            sourceIds,
            shape: 'affinity',
            pdfSourceId,
            statusText: lastStatus ?? undefined,
          });
          frame([id]);
        } else {
          updateDraft({ groupIds: createdIds.filter((x) => x !== d.id) });
        }
      };

      const apply = (event: AskEvent) => {
        switch (event.type) {
          case 'status': {
            // Live server-side phase ("searching the web…") on the avatar —
            // a search can hold the stream for 10s+; never let it read as stall.
            setPresenceStatus(PRESENCE.id, event.message);
            // The Generating chip narrates the same stage (G3.1). One run at
            // a time is enforced at ask() entry, so a live draft is always
            // this run's own.
            lastStatus = event.message;
            if (getDraft()) updateDraft({ statusText: event.message });
            break;
          }
          case 'clarify': {
            // Ambiguous request — surface the question instead of guessing. The
            // run ends here; ClarifyLayer re-asks with the answer folded in. Any
            // placeholder we pre-placed on enter must go — there's no answer to
            // stream into it yet.
            if (placeholderId) {
              stopStreaming(placeholderId);
              if (getDraft()?.id === placeholderId) clearDraft();
              editor.deleteShape(placeholderId);
              placeholderId = null;
              cardId = null;
              createdIds = [];
            }
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
            setPresenceStatus(PRESENCE.id, 'writing…');
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
              } else if (t.type === 'prototype-card') {
                editor.updateShape<PrototypeCardShape>({
                  id: targetId,
                  type: 'prototype-card',
                  props: { html: '' },
                });
              } else if (t.type === 'dashboard-card') {
                editor.updateShape<DashboardCardShape>({
                  id: targetId,
                  type: 'dashboard-card',
                  props: { spec: '', status: 'running' },
                });
              } else if (t.type === 'map-card') {
                editor.updateShape<MapCardShape>({
                  id: targetId,
                  type: 'map-card',
                  props: {
                    stops: [],
                    status: 'running',
                    title: event.title ?? (t.props as { title: string }).title,
                    intro: event.intro ?? '',
                    ordered: event.ordered ?? true,
                  },
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
            // A placeholder doc card is already on the board, streaming (a plain
            // doc ask pre-placed it on enter). Adopt it — no second card, no
            // re-frame; the deltas are already flowing into it.
            if (placeholderId) {
              if (event.shape === 'doc' || event.shape === 'list') {
                cardId = placeholderId;
                createdIds = [placeholderId];
                break;
              }
              // Defensive only — the server routed to a non-doc shape we didn't
              // anticipate. Retire the placeholder and build the real artefact.
              stopStreaming(placeholderId);
              if (getDraft()?.id === placeholderId) clearDraft();
              editor.deleteShape(placeholderId);
              placeholderId = null;
              cardId = null;
              createdIds = [];
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
            } else if (event.shape === 'prototype') {
              const at = placeInLane(editor, sourceIds, PROTOTYPE_CARD_SIZE.w, PROTOTYPE_CARD_SIZE.h);
              editor.createShape<PrototypeCardShape>({
                id,
                type: 'prototype-card',
                x: at.x,
                y: at.y,
                props: { w: PROTOTYPE_CARD_SIZE.w, h: PROTOTYPE_CARD_SIZE.h, html: '', title: trimmed.slice(0, 70) },
              });
            } else if (event.shape === 'dashboard') {
              const at = placeInLane(editor, sourceIds, DASHBOARD_CARD_SIZE.w, DASHBOARD_CARD_SIZE.h);
              editor.createShape<DashboardCardShape>({
                id,
                type: 'dashboard-card',
                x: at.x,
                y: at.y,
                props: { w: DASHBOARD_CARD_SIZE.w, h: DASHBOARD_CARD_SIZE.h, spec: '', title: trimmed.slice(0, 70), status: 'running' },
              });
            } else if (event.shape === 'map') {
              const at = placeInLane(editor, sourceIds, MAP_CARD_SIZE.w, MAP_CARD_SIZE.h);
              editor.createShape<MapCardShape>({
                id,
                type: 'map-card',
                x: at.x,
                y: at.y,
                props: {
                  w: MAP_CARD_SIZE.w,
                  h: MAP_CARD_SIZE.h,
                  title: event.title ?? trimmed.slice(0, 70),
                  intro: event.intro ?? '',
                  stops: [],
                  ordered: event.ordered ?? true,
                  status: 'running',
                },
              });
            } else if (event.shape === 'table') {
              cols = (event.columns ?? []).slice(0, 6);
              // Width scales with the column count so generated comparisons
              // aren't cramped — ~190px per column, clamped to sane bounds.
              const tableW = Math.min(940, Math.max(TABLE_CARD_SIZE.w, cols.length * 190));
              const at = placeInLane(editor, sourceIds, tableW, TABLE_CARD_SIZE.h);
              rows = Array.from({ length: event.rowCount ?? 0 }, () => cols.map(() => ''));
              editor.createShape<TableCardShape>({
                id,
                type: 'table-card',
                x: at.x,
                y: at.y,
                props: { w: tableW, h: TABLE_CARD_SIZE.h, columns: cols, rows },
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
            // Record what this answer was built from (show-your-work, 2.2):
            // card meta feeds the on-click lineage overlay (ProvenanceLayer)
            // and the auto-sync engine (sync.ts) that refreshes this card when
            // a source it was built from changes.
            recordSources(editor, id, contributingIds, trimmed);
            startStreaming(id);
            setDraft({ id, status: 'streaming', prompt: trimmed, logLabel: opts?.logLabel, sourceIds, shape: event.shape, pdfSourceId, statusText: lastStatus ?? undefined });
            frame([id]);
            // Any card built FROM other cards shows its lineage the moment it
            // lands — select it so the provenance hairline to its source(s)
            // is drawn immediately (ProvenanceLayer reveals on selection),
            // instead of waiting for a click. (Was prototype/dashboard-only;
            // generalized to every sourced card — owner call, 2026-07-11.)
            if (contributingIds.length > 0) {
              editor.setSelectedShapes([id]);
            }
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
            } else if (s.type === 'prototype-card') {
              editor.updateShape<PrototypeCardShape>({
                id: cardId,
                type: 'prototype-card',
                props: { html: (s.props as { html: string }).html + event.textDelta },
              });
            } else if (s.type === 'dashboard-card') {
              editor.updateShape<DashboardCardShape>({
                id: cardId,
                type: 'dashboard-card',
                props: { spec: (s.props as { spec: string }).spec + event.textDelta },
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
          case 'map.pin': {
            // A verified stop lands on the map — pins assemble one by one, the
            // way a table fills cell by cell (the pin wears the spring in CSS).
            if (!cardId) break;
            const m = editor.getShape(cardId);
            if (m?.type !== 'map-card') break;
            const prev = (m.props as { stops: MapCardShape['props']['stops'] }).stops;
            editor.updateShape<MapCardShape>({
              id: cardId,
              type: 'map-card',
              props: { stops: [...prev, event.stop] },
            });
            setPresenceStatus(PRESENCE.id, `placing ${event.stop.name}…`);
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
          case 'sources.used': {
            // The model's own declaration of which numbered sources it drew
            // on. Attached ≠ used (owner call, 2026-07-11): overwrite the
            // record-all default from card.create with only the real lineage.
            // In-place regens keep their existing lineage untouched.
            if (!cardId || inPlaceMark) break;
            const used = event.indices
              .map((i) => contributingIds[i - 1])
              .filter((id): id is TLShapeId => Boolean(id));
            recordSources(editor, cardId, used, trimmed, true);
            break;
          }
          case 'card.done':
            if (cardId) {
              // A dashboard streams its spec into `spec`; flip it out of the
              // running state so its renderer goes live (interactions enabled).
              const dc = editor.getShape(cardId);
              if (dc?.type === 'dashboard-card') {
                editor.updateShape<DashboardCardShape>({ id: cardId, type: 'dashboard-card', props: { status: 'done' } });
              } else if (dc?.type === 'map-card') {
                // All pins landed — flip out of the running state (header chip
                // clears; the card reads as settled).
                editor.updateShape<MapCardShape>({ id: cardId, type: 'map-card', props: { status: 'done' } });
              }
              stopStreaming(cardId);
              // One final settle: mid-stream follows are throttled and their
              // animations interrupt each other, so the finished artifact can
              // end a run partly out of view (G3.2). Same contains() gate as
              // followCard — a card already in view doesn't move the camera —
              // and it defers to the camera hand-off like every other follow.
              if (!cameraYielded && !editor.getEditingShapeId()) {
                followCard(editor, createdIds.length ? createdIds : [cardId], sourceIds);
              }
            }
            break;
          case 'done':
            updateDraft({ status: 'done' });
            if (affinity && createdIds.length > 0) frame(createdIds);
            break;
          case 'error':
            runFailed = true;
            surfaceError(event.message);
            break;
        }
      };

      // Show the answer card the INSTANT you press enter. pickShape (server
      // ask.ts) always routes a new, non-"/"-mode ask to a doc, so a doc card at
      // the spot it'll land IS the real card — card.create adopts it (above),
      // never swaps it. This turns the first-token wait (5–20s) from a dead
      // pause into a visible "your answer is forming here" (owner ask
      // 2026-07-20). Explicit "/" table/diagram/map/etc. modes, machine runs,
      // and in-place refines are unchanged — they still land at card.create.
      const willBeDoc =
        !targetId && !opts?.machineId &&
        (!opts?.forceShape || opts.forceShape === 'doc' || opts.forceShape === 'list');
      if (willBeDoc) {
        const at = placeInLane(editor, sourceIds, DOC_CARD_SIZE.w, DOC_CARD_SIZE.h);
        const id = createShapeId();
        editor.createShape<DocCardShape>({
          id,
          type: 'doc-card',
          x: at.x,
          y: at.y,
          props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, title: '', text: '', sourcePdfId: pdfSourceId ?? '' },
        });
        recordSources(editor, id, contributingIds, trimmed);
        startStreaming(id); // flips the card into its "writing…" placeholder state
        setDraft({ id, status: 'streaming', prompt: trimmed, logLabel: opts?.logLabel, sourceIds, shape: 'doc', pdfSourceId, statusText: lastStatus ?? undefined });
        frame([id]);
        if (contributingIds.length > 0) editor.setSelectedShapes([id]);
        cardId = id;
        createdIds = [id];
        placeholderId = id;
      }

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, sources, currentShape, skipClarify: opts?.skipClarify, shape: opts?.forceShape, deep: opts?.deep, machineId: opts?.machineId }),
          signal,
        });
        if (!res.ok || !res.body) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.error ?? `Ask failed (${res.status})`);
        }
        await readSSE<AskEvent>(res.body, apply);
        if (cardId) stopStreaming(cardId);
        // Don't let stream-end mark the draft done if a server `error` event
        // already flagged it — auto-keep would otherwise commit a failed card
        // instead of leaving the failure to the composer's error banner.
        if (!runFailed) updateDraft({ status: 'done' });
      } catch (err) {
        if (cardId) stopStreaming(cardId);
        if (err instanceof Error && err.name !== 'AbortError') {
          runFailed = true;
          // On the hosted playground the raw failure is a meaningless 404 —
          // tell the person what's actually going on instead.
          surfaceError(agentErrorMessage(err.message));
        } else if (placeholderId && cardId === placeholderId) {
          // Aborted during the first-token wait, before any content reached the
          // pre-placed card — don't leave an empty skeleton behind. (A partial
          // card that already took content is kept, as before, for Keep/Discard.)
          const s = editor.getShape(placeholderId);
          const empty = !s || !(((s.props as { text?: string }).text ?? '').trim());
          if (empty) {
            if (getDraft()?.id === placeholderId) clearDraft();
            editor.deleteShape(placeholderId);
          }
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
        endPresence(PRESENCE.id);
        cameraContainer.removeEventListener('wheel', yieldCamera);
        cameraContainer.removeEventListener('pointerdown', yieldCamera);
        if (activeRun?.controller === ac) activeRun = null;
        setIsAsking(false);
        // Pilot budgets spend one action per ask — refresh the topbar counter.
        if (getBackendSnapshot().pilot) reprobeBackend();
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
  doc: 'Text',
  map: 'Map',
};

/** Keep the streamed draft — log it and drop the draft state (the card stays). */
export function finalizeDraft(editor: Editor): TLShapeId | null {
  const d = getDraft();
  if (!d || d.status === 'error') return null;
  stopStreaming(d.id);
  logEvent(editor, {
    kind: 'artefact',
    label: d.logLabel ?? d.prompt,
    detail: ARTEFACT_LABEL[d.shape] ?? 'Text',
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
  editor.deleteShapes([d.id, ...(d.groupIds ?? [])]);
  clearDraft();
}

/* ── camera ──────────────────────────────────────────────────────────────── */

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Union of a set of shapes' page bounds (null if none resolve). */
function boundsOf(editor: Editor, ids: TLShapeId[]): Box | null {
  const boxes = ids
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
}

/** Frame the fresh ANSWER and keep it in view — never the source+answer pair,
 *  which zoomed the new card out to make room for its source (owner call
 *  2026-07-20 — "keep the new card in view"). `frameBounds` keeps the user's
 *  zoom when the card already fits, zooms in a small card up to readable, and
 *  zooms out only enough to fit the card itself. `sourceIds` is unused now, kept
 *  for a stable signature across the ask flow. */
function frameCard(editor: Editor, responseIds: TLShapeId[], _sourceIds: TLShapeId[]): void {
  const answer = boundsOf(editor, responseIds);
  if (answer) frameBounds(editor, answer, { margin: 96, animation: { duration: 420, easing: easeOutCubic } });
}

/** Keep the answer in view as it grows — re-frame only once it has actually
 *  scrolled out of view, so a settled view doesn't jitter as tokens land. */
function followCard(editor: Editor, responseIds: TLShapeId[], _sourceIds: TLShapeId[]): void {
  const answer = boundsOf(editor, responseIds);
  if (!answer) return;
  if (editor.getViewportPageBounds().contains(answer)) return;
  frameBounds(editor, answer, { margin: 96, animation: { duration: 280, easing: easeOutCubic } });
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
  const laneTop = srcBounds.length
    ? Math.min(...srcBounds.map((b) => b.minY))
    : Math.min(...all.map((b) => b.minY));
  // Clear everything the new card's vertical band would touch — not just
  // shapes whose TOP is near the lane. A tall card from a neighbouring lane
  // still collides (dogfood 2026-07-04 finding #9: the profile card landed
  // on the starter doc).
  const sameLane = all.filter((b) => b.minY < laneTop + h && b.maxY > laneTop);
  const anchor = sameLane.length ? sameLane : srcBounds;
  const x = (anchor.length ? Math.max(...anchor.map((b) => b.maxX)) : Math.max(...all.map((b) => b.maxX))) + GAP;
  return { x, y: laneTop };
}

/** Record an answer's lineage on the card itself (durable, survives reload):
 *  `meta.jzSources` holds the ids of the cards it was built from, and
 *  `meta.jzPrompt` the ask that produced it — so the auto-sync engine can
 *  faithfully re-run the same ask when a source changes. The canvas carries no
 *  persistent arrow shapes — ProvenanceLayer draws a subtle hairline only for
 *  the card you click (owner call, 2026-07-05). */
export const PROV_META_KEY = 'jzSources';
export const PROMPT_META_KEY = 'jzPrompt';
function recordSources(
  editor: Editor,
  cardId: TLShapeId,
  sourceIds: TLShapeId[],
  prompt: string,
  /** A `sources.used` prune may legitimately clear lineage (the model drew on
   *  none of the attached sources); the initial record-all never writes empty. */
  allowEmpty = false,
): void {
  const card = editor.getShape(cardId);
  if (!card) return;
  const ids = sourceIds.filter((id) => id !== cardId && editor.getShape(id));
  if (ids.length === 0 && !allowEmpty) return;
  // Cross-type partial (meta only) — the cast defeats the per-type union,
  // same as shapeTitle.ts.
  editor.updateShape({
    id: cardId,
    type: card.type,
    meta: { ...card.meta, [PROV_META_KEY]: ids, [PROMPT_META_KEY]: prompt },
  } as TLShapePartial);
}
