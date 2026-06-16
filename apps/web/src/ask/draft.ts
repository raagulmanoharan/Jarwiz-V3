/**
 * The in-flight answer being streamed onto the canvas. Unlike a side panel, the
 * draft is a real card that fills in live; its controls (Keep / Discard) float
 * on it. One draft at a time.
 */

import type { TLShapeId } from 'tldraw';

export interface Draft {
  id: TLShapeId;
  arrowIds: TLShapeId[];
  status: 'streaming' | 'done' | 'error';
  error?: string;
  prompt: string;
  sourceIds: TLShapeId[];
  shape: 'doc' | 'table' | 'list';
  pdfSourceId: TLShapeId | null;
}

let draft: Draft | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export function subscribeDraft(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getDraft(): Draft | null {
  return draft;
}
export function setDraft(next: Draft | null): void {
  draft = next;
  emit();
}
export function updateDraft(patch: Partial<Draft>): void {
  if (!draft) return;
  draft = { ...draft, ...patch };
  emit();
}
export function clearDraft(): void {
  if (draft === null) return;
  draft = null;
  emit();
}
