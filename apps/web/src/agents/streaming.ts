import type { TLShapeId } from 'tldraw';

let streamingSet = new Set<TLShapeId>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function startStreaming(id: TLShapeId): void {
  streamingSet = new Set(streamingSet);
  streamingSet.add(id);
  notify();
}

export function stopStreaming(id: TLShapeId): void {
  if (!streamingSet.has(id)) return;
  streamingSet = new Set(streamingSet);
  streamingSet.delete(id);
  notify();
}

export function subscribeStreaming(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getStreamingSnapshot(): ReadonlySet<TLShapeId> {
  return streamingSet;
}
