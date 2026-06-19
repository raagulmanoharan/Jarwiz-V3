/**
 * The in-flight answer being streamed onto the canvas. Unlike a side panel, the
 * draft is a real card that fills in live; its controls (Keep / Discard) float
 * on it. One draft at a time.
 */

import type { TLShapeId } from 'tldraw';
import { createUiStore } from './uiStore';

export interface Draft {
  /** The anchor shape — a single answer card, or the first sticky of an
   *  affinity board. Controls float under it. */
  id: TLShapeId;
  /** Other shapes that belong to this artefact (affinity stickies/labels);
   *  kept and discarded together with `id`. */
  groupIds?: TLShapeId[];
  arrowIds: TLShapeId[];
  status: 'streaming' | 'done' | 'error';
  error?: string;
  prompt: string;
  sourceIds: TLShapeId[];
  shape: 'doc' | 'table' | 'list' | 'diagram' | 'affinity';
  pdfSourceId: TLShapeId | null;
}

const store = createUiStore<Draft>();
export const subscribeDraft = store.subscribe;
export const getDraft = store.get;
export const setDraft = store.set;
export const updateDraft = store.update;
export const clearDraft = store.clear;
