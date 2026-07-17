/**
 * Combined read of the two stream signals for a card (see agents/streaming.ts):
 *
 *  - `isStreaming` — page-shaping stream (drives caret + placeholder AND the
 *    fit-height width-grow). Pass THIS to useFitHeight's `streaming`.
 *  - `isGenerating` — in EITHER the streaming or generating set: the card is
 *    being written into. Use this for the caret and the "writing…" placeholder,
 *    so compose/debrief cards (fixed width, generating-only) show the same live
 *    cue without triggering a width reflow.
 */
import { useSyncExternalStore } from 'react';
import type { TLShapeId } from 'tldraw';
import {
  getGeneratingSnapshot,
  getStreamingSnapshot,
  subscribeGenerating,
  subscribeStreaming,
} from '../agents/streaming';

export function useStreamState(id: TLShapeId): { isStreaming: boolean; isGenerating: boolean } {
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const generatingSet = useSyncExternalStore(subscribeGenerating, getGeneratingSnapshot, getGeneratingSnapshot);
  const isStreaming = streamingSet.has(id);
  return { isStreaming, isGenerating: isStreaming || generatingSet.has(id) };
}
