/**
 * Current text selection inside a PDF reader — what the user highlighted, on
 * which page, in which card. Drives the "Ask about this passage" affordance so
 * a question can be grounded in an exact span ("explain THIS clause").
 */

import type { TLShapeId } from 'tldraw';

export interface PdfSelection {
  shapeId: TLShapeId;
  assetId: string;
  name: string;
  page: number;
  text: string;
  /** Viewport-space anchor for the affordance (bottom-center of the selection). */
  x: number;
  y: number;
}

let selection: PdfSelection | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribePdfSelection(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPdfSelection(): PdfSelection | null {
  return selection;
}

export function setPdfSelection(next: PdfSelection | null): void {
  // Avoid churn when nothing meaningful changed.
  if (next === null && selection === null) return;
  selection = next;
  emit();
}
