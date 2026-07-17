/**
 * Which cards currently have a live stream, split into two signals:
 *
 *  - STREAMING — a card being written the "page-shaping" way (single-card Ask,
 *    Analyze, Autopilot). Drives the caret + the empty-card placeholder AND the
 *    fit-height width-grow (a long answer widens into a page shape). Doc/note/
 *    table/diagram shapes subscribe; useAsk/analyze/autopilot flip ids here.
 *
 *  - GENERATING — a card that's been PLACED and is awaiting/receiving generated
 *    content, but whose width is fixed by a layout engine (compose fan-out,
 *    debrief recipe). Drives the caret + placeholder ONLY — never the width-grow,
 *    so pre-placed cards in a grid never bump their neighbours mid-stream.
 *
 * A card is "generating" (shows caret + "writing…" placeholder) if it's in
 * EITHER set; it only page-shapes if it's in the streaming set. See
 * useStreamState for the combined read.
 */
import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

const streamingStore = createExternalStore<ReadonlySet<TLShapeId>>(new Set());
const generatingStore = createExternalStore<ReadonlySet<TLShapeId>>(new Set());

const add = (store: typeof streamingStore, id: TLShapeId) =>
  store.update((s) => (s.has(id) ? s : new Set(s).add(id)));
const remove = (store: typeof streamingStore, id: TLShapeId) =>
  store.update((s) => {
    if (!s.has(id)) return s;
    const next = new Set(s);
    next.delete(id);
    return next;
  });

/** Page-shaping stream (caret + placeholder + width-grow). */
export function startStreaming(id: TLShapeId): void {
  add(streamingStore, id);
}
export function stopStreaming(id: TLShapeId): void {
  remove(streamingStore, id);
}

/** Fixed-width stream (caret + placeholder only, no width-grow) — for cards a
 *  layout engine owns (compose / debrief). */
export function startGenerating(id: TLShapeId): void {
  add(generatingStore, id);
}
export function stopGenerating(id: TLShapeId): void {
  remove(generatingStore, id);
}

export const subscribeStreaming = streamingStore.subscribe;
export const getStreamingSnapshot = streamingStore.get;
export const subscribeGenerating = generatingStore.subscribe;
export const getGeneratingSnapshot = generatingStore.get;
