/**
 * Ask preview store. A generated answer streams into here first — a floating
 * preview, not a canvas card — so the user can judge it and only commit it with
 * "Add to canvas". One preview at a time; a new Ask replaces it.
 */

import type { TLShapeId } from 'tldraw';
import type { AskShape } from '@jarwiz/shared';

export interface AskPreview {
  shape: AskShape;
  title?: string;
  text: string;
  columns?: string[];
  rows?: string[][];
  status: 'streaming' | 'done' | 'error';
  error?: string;
  /** Where the card would land, and what it connects back to. */
  placeX: number;
  placeY: number;
  sourceIds: TLShapeId[];
  pdfSourceId: TLShapeId | null;
}

let preview: AskPreview | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribePreview(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPreview(): AskPreview | null {
  return preview;
}

export function setPreview(next: AskPreview | null): void {
  preview = next;
  emit();
}

/** Immutable partial update — replaces the object so subscribers re-render. */
export function updatePreview(patch: Partial<AskPreview>): void {
  if (!preview) return;
  preview = { ...preview, ...patch };
  emit();
}

export function appendPreviewText(delta: string): void {
  if (!preview) return;
  preview = { ...preview, text: preview.text + delta };
  emit();
}

export function clearPreview(): void {
  if (preview === null) return;
  preview = null;
  emit();
}
