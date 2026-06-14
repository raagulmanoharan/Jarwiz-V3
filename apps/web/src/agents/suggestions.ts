/**
 * What the board offers to do with a freshly-dropped artifact. Recognising the
 * artifact's kind (a video, an article, a document) is enough to propose the
 * handful of agent actions that obviously fit — each a one-tap kick-off.
 *
 * Type-based for now (fast, no tokens); a future pass can tailor these to the
 * actual parsed content (e.g. a compliance doc → "Make a compliance checklist").
 */

import type { Suggestion } from './offers';

type DropKind = 'youtube' | 'link' | 'pdf';

const CATALOG: Record<DropKind, Suggestion[]> = {
  youtube: [
    { id: 'yt-sum', label: 'Summarize', agentId: 'summarizer' },
    {
      id: 'yt-takeaways',
      label: 'Key takeaways',
      agentId: 'summarizer',
      brief: 'Give the key takeaways as a tight bulleted list.',
    },
    {
      id: 'yt-ideas',
      label: 'Brainstorm ideas',
      agentId: 'brainstormer',
      brief: 'Brainstorm content ideas and angles sparked by this video.',
    },
  ],
  link: [
    { id: 'ln-sum', label: 'Summarize', agentId: 'summarizer' },
    { id: 'ln-related', label: 'Find related', agentId: 'researcher' },
    {
      id: 'ln-post',
      label: 'Draft a post',
      agentId: 'writer',
      brief: 'Write a short, shareable post based on this source.',
    },
    {
      id: 'ln-angles',
      label: 'Brainstorm angles',
      agentId: 'brainstormer',
      brief: 'Riff on angles, hooks, and counterpoints from this.',
    },
  ],
  pdf: [
    { id: 'pdf-sum', label: 'Summarize', agentId: 'summarizer' },
    {
      id: 'pdf-table',
      label: 'Comparison table',
      agentId: 'writer',
      brief: 'Make a comparison table of the key options or points in this document.',
    },
    {
      id: 'pdf-deck',
      label: 'Outline a deck',
      agentId: 'writer',
      brief: 'Outline a slide-by-slide deck of this document — one short section per slide.',
    },
    {
      id: 'pdf-ideas',
      label: 'Brainstorm',
      agentId: 'brainstormer',
      brief: 'Brainstorm what to do with this — angles, audiences, next steps.',
    },
  ],
};

export function suggestionsForDrop(kind: DropKind): Suggestion[] {
  return CATALOG[kind] ?? [];
}
