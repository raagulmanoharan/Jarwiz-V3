/**
 * Auto-sync — cards stay true to their sources. Every AI answer records the
 * cards it was built from (meta.jzSources) and the ask that produced it
 * (meta.jzPrompt). When the user later edits a source — say, changes a table a
 * flow was generated from — this engine notices, waits for the edit to settle,
 * and re-runs the original ask in place on each dependent card, then walks on
 * down the chain (an updated card is itself a source for cards built from it).
 * Each refreshed card gets an on-card pill (SyncLayer) with Undo; the
 * pre-update content is snapshotted here so one click restores it.
 *
 * Deliberate guardrails:
 *  - Only CONTENT edits count (per-type prop whitelist) — moving or resizing a
 *    card never triggers a refresh.
 *  - One update at a time, queued behind the user's own asks (isAskBusy) —
 *    auto-work never races a human ask, the human always wins.
 *  - A visited set per wave stops cycles (A→B→A) from ping-ponging forever.
 *  - Writes the engine itself streams into a card are never mistaken for user
 *    edits — the streaming set and a suppress list filter them out.
 */

import type { Editor, TLShape, TLShapeId } from 'tldraw';
import type { AskShape } from '@jarwiz/shared';
import { createExternalStore } from '../lib/externalStore';
import { getStreamingSnapshot } from '../agents/streaming';
import { isAskBusy, sourceLabel, PROV_META_KEY, PROMPT_META_KEY, REFINABLE } from './useAsk';

/** A completed auto-update, badged on the card until dismissed or undone. */
export interface SyncBadge {
  cardId: TLShapeId;
  /** Short label of the source that changed ("Pricing table"). */
  sourceLabel: string;
  /** The card's full props from before the FIRST auto-update in this run of
   *  updates — Undo restores the last content the user actually authored. */
  prevProps: Record<string, unknown>;
}

const badges = createExternalStore<ReadonlyMap<TLShapeId, SyncBadge>>(new Map());
export const subscribeSyncBadges = badges.subscribe;
export const getSyncBadges = badges.get;

export function clearSyncBadge(cardId: TLShapeId): void {
  badges.update((m) => {
    if (!m.has(cardId)) return m;
    const next = new Map(m);
    next.delete(cardId);
    return next;
  });
}

function setBadge(cardId: TLShapeId, label: string, prevProps: Record<string, unknown>): void {
  badges.update((m) => {
    const next = new Map(m);
    const existing = next.get(cardId);
    // Chained updates keep the OLDEST snapshot: Undo always returns the card
    // to the last state the user saw and approved, not a mid-chain version.
    next.set(cardId, { cardId, sourceLabel: label, prevProps: existing?.prevProps ?? prevProps });
    return next;
  });
}

/** Undo an auto-update: restore the card's pre-update content (one history
 *  stop, so board Cmd+Z still behaves) and drop the badge. */
export function undoSync(editor: Editor, cardId: TLShapeId): void {
  const badge = badges.get().get(cardId);
  if (!badge) return;
  const card = editor.getShape(cardId);
  if (card) {
    // The restore is a store write like any other — suppress it so the engine
    // doesn't read it as a fresh edit and re-sync the cards built from this one.
    suppressed.add(cardId);
    editor.markHistoryStoppingPoint('undo-auto-update');
    editor.updateShape({ id: cardId, type: card.type, props: badge.prevProps } as Parameters<
      typeof editor.updateShape
    >[0]);
    setTimeout(() => suppressed.delete(cardId), 800);
  }
  clearSyncBadge(cardId);
}

/* ── change detection ────────────────────────────────────────────────────── */

/** The props that ARE a card's content, per type. Anything else (position,
 *  size, collapsed state…) changing must not trigger a dependent refresh.
 *  Ingested cards (pdf/sheet/link/youtube/image) are absent on purpose — their
 *  content is fixed at drop time, users don't edit it. */
const CONTENT_PROPS: Record<string, string[]> = {
  'doc-card': ['text', 'title'],
  'note-card': ['text'],
  'table-card': ['columns', 'rows'],
  'diagram-card': ['code'],
  'dashboard-card': ['spec'],
  'prototype-card': ['html'],
  'map-card': ['stops', 'title'],
  geo: ['richText'],
  text: ['richText'],
  note: ['richText'],
  arrow: ['richText'],
};

function fingerprint(shape: TLShape): string {
  const keys = CONTENT_PROPS[shape.type] ?? [];
  const p = shape.props as Record<string, unknown>;
  return JSON.stringify(keys.map((k) => p[k]));
}

/** Cards whose recorded lineage includes `sourceId` and that can be
 *  regenerated in place (REFINABLE kinds only — affinity stickies can't). */
function dependentsOf(editor: Editor, sourceId: TLShapeId): TLShape[] {
  return editor.getCurrentPageShapes().filter((s) => {
    if (!REFINABLE[s.type]) return false;
    const srcs = s.meta?.[PROV_META_KEY] as TLShapeId[] | undefined;
    return Array.isArray(srcs) && srcs.includes(sourceId);
  });
}

/* ── the engine ──────────────────────────────────────────────────────────── */

/** For pre-jzPrompt cards (or a blank prompt): a faithful "bring it up to
 *  date" instruction. forceShape pins the format either way. */
const FALLBACK_PROMPT =
  'A source this card was built from has changed. Regenerate the card from the ' +
  'updated source content, keeping the same format, structure, language and ' +
  'intent — change only what the source update implies.';

/** How long a source must sit quiet after an edit before dependents refresh —
 *  long enough to span typing pauses, short enough to still feel proactive. */
const IDLE_MS = 2600;
/** Breather between queued updates, letting React state (isAsking) settle. */
const PUMP_DELAY_MS = 350;
/** Poll interval while waiting for the user's own ask/draft to clear. */
const BUSY_RETRY_MS = 1500;

interface SyncJob {
  cardId: TLShapeId;
  sourceId: TLShapeId;
  /** Every card already updated (or queued) in this wave — cycle guard. */
  visited: Set<string>;
}

type AskFn = (
  prompt: string,
  sourceIds: TLShapeId[],
  opts?: {
    targetId?: TLShapeId | null;
    skipClarify?: boolean;
    logLabel?: string;
    forceShape?: AskShape;
  },
) => Promise<void>;

/** Card ids whose next store change is the engine's (or Undo's) own write. */
const suppressed = new Set<TLShapeId>();

/** Wire the engine to an editor. Returns a disposer. One instance per board —
 *  SyncLayer mounts it. */
export function registerSyncEngine(editor: Editor, askRef: { current: AskFn }): () => void {
  const timers = new Map<TLShapeId, ReturnType<typeof setTimeout>>();
  const queue: SyncJob[] = [];
  let running = false;
  let syncingId: TLShapeId | null = null;
  let disposed = false;

  const enqueue = (job: SyncJob) => {
    if (job.cardId === syncingId) return;
    if (queue.some((j) => j.cardId === job.cardId)) return;
    queue.push(job);
  };

  const runJob = async (job: SyncJob) => {
    const card = editor.getShape(job.cardId);
    if (!card) return;
    // The user is inside this card right now — never rewrite under their
    // cursor. Requeue; the pump comes back around.
    if (editor.getEditingShapeId() === job.cardId) {
      enqueue(job);
      return;
    }
    const src = editor.getShape(job.sourceId);
    const label = src ? sourceLabel(src) : 'its source';
    const prevProps = JSON.parse(JSON.stringify(card.props)) as Record<string, unknown>;
    const sources = ((card.meta?.[PROV_META_KEY] as TLShapeId[] | undefined) ?? []).filter((id) =>
      editor.getShape(id),
    );
    if (sources.length === 0) return;
    const stored = card.meta?.[PROMPT_META_KEY];
    const prompt = typeof stored === 'string' && stored.trim() ? stored : FALLBACK_PROMPT;

    syncingId = job.cardId;
    try {
      // In-place regen of the dependent, grounded on its (now updated)
      // sources. forceShape keeps the card's own format so the rewrite always
      // lands in place — never as a stray new card.
      await askRef.current(prompt, sources, {
        targetId: job.cardId,
        skipClarify: true,
        forceShape: REFINABLE[card.type],
        logLabel: 'Auto-update',
      });
    } finally {
      syncingId = null;
    }

    // A cancelled/failed regen bails back to its history mark — the card is
    // unchanged and earns no badge (and the chain stops here).
    const after = editor.getShape(job.cardId);
    if (!after || JSON.stringify(after.props) === JSON.stringify(prevProps)) return;
    setBadge(job.cardId, label, prevProps);

    // Crawl on down: this card just changed, so cards built FROM it are now
    // stale too. The wave's visited set keeps cycles from looping.
    for (const dep of dependentsOf(editor, job.cardId)) {
      if (job.visited.has(dep.id)) continue;
      job.visited.add(dep.id);
      enqueue({ cardId: dep.id, sourceId: job.cardId, visited: job.visited });
    }
  };

  const pump = () => {
    if (disposed || running) return;
    const job = queue.shift();
    if (!job) return;
    running = true;
    void (async () => {
      try {
        // The human always wins: hold auto-work while their ask/draft is live.
        while (!disposed && isAskBusy()) {
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
        }
        if (!disposed) await runJob(job);
      } catch {
        // A failed auto-update surfaces through the ask error pill; the queue
        // must keep draining regardless.
      } finally {
        running = false;
        if (queue.length > 0) setTimeout(pump, PUMP_DELAY_MS);
      }
    })();
  };

  const fire = (sourceId: TLShapeId) => {
    timers.delete(sourceId);
    // Still mid-edit (cursor in the card) — wait for another quiet spell.
    if (editor.getEditingShapeId() === sourceId) {
      markDirty(sourceId);
      return;
    }
    const deps = dependentsOf(editor, sourceId).filter((d) => !getStreamingSnapshot().has(d.id));
    if (deps.length === 0) return;
    const visited = new Set<string>([sourceId, ...deps.map((d) => d.id)]);
    for (const dep of deps) enqueue({ cardId: dep.id, sourceId, visited });
    pump();
  };

  const markDirty = (sourceId: TLShapeId) => {
    const t = timers.get(sourceId);
    if (t) clearTimeout(t);
    timers.set(
      sourceId,
      setTimeout(() => fire(sourceId), IDLE_MS),
    );
  };

  const unlisten = editor.store.listen(
    (entry) => {
      for (const [from, to] of Object.values(entry.changes.updated)) {
        if (to.typeName !== 'shape') continue;
        const shape = to as TLShape;
        if (!CONTENT_PROPS[shape.type]) continue;
        if (fingerprint(from as TLShape) === fingerprint(shape)) continue;
        // Not a user edit: our own regen stream (streaming set), an Undo
        // restore (suppress list), or the card we're actively rewriting.
        if (suppressed.has(shape.id) || getStreamingSnapshot().has(shape.id) || syncingId === shape.id) continue;
        // A manual edit to a card we auto-updated means the user took over —
        // the badge's snapshot would now undo THEIR work, so retire it.
        clearSyncBadge(shape.id);
        markDirty(shape.id);
      }
    },
    { scope: 'document', source: 'user' },
  );

  return () => {
    disposed = true;
    unlisten();
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    queue.length = 0;
  };
}
