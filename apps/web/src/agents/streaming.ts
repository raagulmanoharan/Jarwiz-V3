/**
 * Which cards currently have a live streaming caret. Doc/note/table shapes
 * subscribe; useAsk/autopilot flip ids on card create/done.
 */
import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

const store = createExternalStore<ReadonlySet<TLShapeId>>(new Set());

export function startStreaming(id: TLShapeId): void {
  store.update((s) => new Set(s).add(id));
}

export function stopStreaming(id: TLShapeId): void {
  store.update((s) => {
    if (!s.has(id)) return s;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
}

export const subscribeStreaming = store.subscribe;
export const getStreamingSnapshot = store.get;
