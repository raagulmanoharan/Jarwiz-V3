/**
 * Combined read of the two stream signals for a card (see agents/streaming.ts):
 *
 *  - `isStreaming` — page-shaping stream (drives caret + placeholder AND the
 *    fit-height width-grow). Pass THIS to useFitHeight's `streaming`.
 *  - `isGenerating` — in EITHER the streaming or generating set: the card is
 *    being written into (or placed and awaiting content). Use this for the
 *    caret and the "writing…" placeholder, so compose/debrief cards (fixed
 *    width, generating-only) show the same live cue without a width reflow.
 *  - `isFocused` — the card being written RIGHT NOW: the streaming set (single-
 *    card paths) or the focus set (the fan-out slot currently filling). This is
 *    the ONLY thing that should wear the glow, so pending placeholders stay
 *    quiet with just their border.
 */
import { useSyncExternalStore } from 'react';
import type { TLShapeId } from 'tldraw';
import {
  getFocusSnapshot,
  getGeneratingSnapshot,
  getStreamingSnapshot,
  subscribeFocus,
  subscribeGenerating,
  subscribeStreaming,
} from '../agents/streaming';

export function useStreamState(id: TLShapeId): { isStreaming: boolean; isGenerating: boolean; isFocused: boolean } {
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const generatingSet = useSyncExternalStore(subscribeGenerating, getGeneratingSnapshot, getGeneratingSnapshot);
  const focusSet = useSyncExternalStore(subscribeFocus, getFocusSnapshot, getFocusSnapshot);
  const isStreaming = streamingSet.has(id);
  return {
    isStreaming,
    isGenerating: isStreaming || generatingSet.has(id),
    isFocused: isStreaming || focusSet.has(id),
  };
}
