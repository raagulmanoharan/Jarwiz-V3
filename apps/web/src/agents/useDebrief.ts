/**
 * The meeting-debrief recipe, client side (review backlog G5). A transcript
 * contains three kinds of material — what was DECIDED, what must be DONE, and
 * what's still AT RISK or open — so the recipe builds three cards in a row
 * beside the transcript's source card, streamed over the compose transport
 * (slot events) with NO planning call: the recipe is the plan.
 *
 * Unlike a board fan-out, a debrief is one conceptual artifact: the three
 * cards register as ONE draft (anchor + groupIds), so the existing
 * Keep / Discard bar gates the whole cluster with a single decision, and
 * "Stop & discard" genuinely aborts the stream (claimActiveRun). Each card
 * records the transcript in meta.jzSources — the same lineage the hairlines,
 * auto-sync, and Regenerate gates already read.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type TLShapeId } from 'tldraw';
import type { ComposeEvent } from '@jarwiz/shared';
import { getAgent } from '@jarwiz/shared';
import { DOC_CARD_SIZE, type DocCardShape } from '../shapes';
import { setShapeTitle } from '../shapes/shapeTitle';
import { readSSE } from './sse';
import { startGenerating, stopGenerating } from './streaming';
import { makeCardFollower } from './followCamera';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { getDraft, setDraft, updateDraft } from '../ask/draft';
import { claimActiveRun, releaseActiveRun, discardDraft, PROMPT_META_KEY, PROV_META_KEY } from '../ask/useAsk';
import { logEvent } from '../log/eventLog';
import { clearAgentError, setAgentError } from './agentError';
import { agentErrorMessage } from '../lib/backend';

const PRESENCE = getAgent('writer');
const CARD_W = 440;
const GAP = 48;

export type DebriefPhase = 'idle' | 'building' | 'done' | 'error';

export function useDebrief() {
  const editor = useEditor();
  const [phase, setPhase] = useState<DebriefPhase>('idle');
  const abortRef = useRef<AbortController | null>(null);

  /** Run the recipe over the transcript card. Returns false (without side
   *  effects) when there's nothing transcript-like to read — the caller falls
   *  back to a plain ask. */
  const run = useCallback(
    async (intent: string, sourceIds: TLShapeId[]): Promise<boolean> => {
      // The transcript = the largest text-bearing source (prefer an explicit
      // pasted source card; any long text card qualifies).
      const candidates = sourceIds
        .map((id) => editor.getShape(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          id: s.id,
          text: String((s.props as { text?: string }).text ?? ''),
          title: String((s.props as { title?: string }).title ?? ''),
          isSource: s.meta?.jzSourceDoc === true,
        }))
        .filter((c) => c.text.trim().length >= 200)
        .sort((a, b) => Number(b.isSource) - Number(a.isSource) || b.text.length - a.text.length);
      const transcript = candidates[0];
      if (!transcript) return false;

      const ac = new AbortController();
      if (!claimActiveRun(ac)) return true; // busy — swallow like ask() does
      abortRef.current = ac;
      setPhase('building');

      // Presence first — the click is never met with silence (same rule as ask).
      startPresence(PRESENCE.id);
      setPresenceStatus(PRESENCE.id, 'reading the transcript…');
      const srcBounds = editor.getShapePageBounds(transcript.id);
      if (srcBounds) setPresenceCursor(PRESENCE.id, srcBounds.maxX - 14, srcBounds.maxY - 16);

      // Fixed row beside the transcript card — the cluster reads left to right.
      const originX = (srcBounds ? srcBounds.maxX : editor.getViewportPageBounds().minX) + 120;
      const originY = srcBounds ? srcBounds.minY : editor.getViewportPageBounds().minY + 80;

      const titles = new Map<number, string>();
      const slots = new Map<number, TLShapeId>();
      const created: TLShapeId[] = [];
      let framed = false;
      // Keeps the currently-writing card in view as the three fill in turn;
      // yields the instant the user pans/zooms/edits (followCamera.ts).
      const follower = makeCardFollower(editor);

      const frameCluster = () => {
        const boxes = [transcript.id, ...created]
          .map((id) => editor.getShapePageBounds(id))
          .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
        if (boxes.length === 0) return;
        const u = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
        editor.zoomToBounds(u, { animation: { duration: 320 }, inset: 130, targetZoom: 1 });
      };

      // Place one card of the cluster as a titled empty placeholder (marked
      // GENERATING so it shows the "writing…" cue + caret without width-grow).
      const precreate = (slotIdx: number) => {
        if (slots.has(slotIdx)) return;
        const id = createShapeId();
        created.push(id);
        const title = titles.get(slotIdx) ?? '';
        editor.createShape<DocCardShape>({
          id,
          type: 'doc-card',
          x: originX + slotIdx * (CARD_W + GAP),
          y: originY,
          props: { w: CARD_W, h: DOC_CARD_SIZE.h, title, text: '', sourcePdfId: '' },
          // The recipe KNOWS its lineage — every card is built from the
          // transcript. Recorded up front so hairlines, auto-sync, and the
          // Regenerate gate all see it immediately.
          meta: { [PROV_META_KEY]: [transcript.id], [PROMPT_META_KEY]: intent || 'Meeting debrief' },
        });
        slots.set(slotIdx, id);
        const shape = editor.getShape(id);
        if (shape && title) setShapeTitle(editor, shape, title);
        startGenerating(id);
        // ONE draft for the whole cluster: the first card anchors it, the rest
        // join its group — Keep/Discard decides the artifact whole.
        const d = getDraft();
        if (!d) {
          setDraft({
            id,
            groupIds: [],
            status: 'streaming',
            prompt: intent || 'Meeting debrief',
            logLabel: 'Meeting debrief',
            sourceIds: [transcript.id],
            shape: 'list',
            pdfSourceId: null,
            statusText: 'reading the transcript…',
          });
        } else {
          updateDraft({ groupIds: created.filter((x) => x !== d.id) });
        }
      };

      const applySlot = (slotIdx: number, ev: Extract<ComposeEvent, { type: 'slot' }>['event']) => {
        switch (ev.type) {
          case 'status':
            setPresenceStatus(PRESENCE.id, ev.message);
            if (getDraft()) updateDraft({ statusText: ev.message });
            break;
          case 'card.create': {
            // Card is already placed from the plan — just move the avatar to it
            // and keep it in view as it starts to fill.
            const id = slots.get(slotIdx) ?? (precreate(slotIdx), slots.get(slotIdx)!);
            const b = editor.getShapePageBounds(id);
            if (b) setPresenceCursor(PRESENCE.id, b.maxX - 14, b.maxY - 16);
            follower.follow(id);
            break;
          }
          case 'card.delta': {
            const cardId = slots.get(slotIdx);
            if (!cardId) break;
            const s = editor.getShape(cardId);
            if (!s || !('text' in (s.props as object))) break;
            editor.updateShape({
              id: cardId,
              type: s.type,
              props: { text: (s.props as { text: string }).text + ev.textDelta },
            } as Parameters<typeof editor.updateShape>[0]);
            follower.follow(cardId);
            break;
          }
          case 'card.done': {
            const cardId = slots.get(slotIdx);
            if (cardId) stopGenerating(cardId);
            break;
          }
          case 'card.title':
            // The recipe's slot titles are authoritative — ignore generated ones.
            break;
          default:
            // sources.used etc. — lineage is already recorded deterministically.
            break;
        }
      };

      try {
        const res = await fetch('/api/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            board: [],
            intent,
            recipe: 'debrief',
            transcript: { title: transcript.title || undefined, text: transcript.text },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Debrief failed (${res.status})`);
        await readSSE<ComposeEvent>(res.body, (e) => {
          if (e.type === 'plan') {
            for (const c of e.cards) titles.set(c.slot, c.title);
            // Place all three cards at once as titled placeholders — the whole
            // shape of the debrief is visible immediately, then each fills in turn.
            for (const c of [...e.cards].sort((a, b) => a.slot - b.slot)) precreate(c.slot);
            if (!framed) {
              framed = true;
              frameCluster();
            }
          } else if (e.type === 'slot') {
            applySlot(e.slot, e.event);
          } else if (e.type === 'error') {
            throw new Error(e.message);
          }
        });
        if (created.length === 0) throw new Error('The debrief produced no cards.');
        for (const id of created) stopGenerating(id); // all settled — carets off
        frameCluster();
        updateDraft({ status: 'done', statusText: undefined });
        logEvent(editor, { kind: 'artefact', label: 'Meeting debrief', detail: `${created.length} cards`, shapeIds: created });
        setPhase('done');
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // "Stop & discard" already deleted the cards via discardDraft.
          setPhase('idle');
        } else {
          // Failure surfaces in the one banner above the composer, never on a
          // card off in the cluster. Throw away the half-built draft (a failed
          // debrief leaves nothing keepable) so the reason waits where the
          // person will type next, with a Retry.
          if (getDraft()) discardDraft(editor);
          setAgentError({ message: agentErrorMessage((err as Error).message), onRetry: () => { clearAgentError(); void run(intent, sourceIds); } });
          setPhase('error');
        }
      } finally {
        // Abort/error can skip card.done — clear any lingering carets and detach
        // the follow listeners.
        for (const id of created) stopGenerating(id);
        follower.dispose();
        releaseActiveRun(ac);
        abortRef.current = null;
        endPresence(PRESENCE.id);
      }
      return true;
    },
    [editor],
  );

  return { run, phase };
}
