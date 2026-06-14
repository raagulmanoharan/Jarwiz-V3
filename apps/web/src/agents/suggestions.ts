/**
 * What the board offers to do with a freshly-dropped artifact. Recognising the
 * artifact's kind (a video, an article, a document) is enough to propose the
 * handful of agent actions that obviously fit — each a one-tap kick-off.
 *
 * Type-based for now (fast, no tokens); a future pass can tailor these to the
 * actual parsed content (e.g. a compliance doc → "Make a compliance checklist").
 */

import type { AgentSuggestion, ClusterSuggestRequest, SuggestRequest } from '@jarwiz/shared';
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

/** Fast type-based actions for a cluster of related artifacts (the fallback). */
export function clusterSuggestions(): Suggestion[] {
  return [
    { id: 'cl-sum', label: 'Summarize all', agentId: 'summarizer', brief: 'Summarize all of these sources together into one gist.' },
    { id: 'cl-table', label: 'Compare in a table', agentId: 'writer', brief: 'Compare these sources side by side in a single comparison table.' },
    { id: 'cl-brief', label: 'Synthesize a brief', agentId: 'writer', brief: 'Synthesize these into one short brief with a clear through-line.' },
    { id: 'cl-thread', label: 'Find the through-line', agentId: 'brainstormer', brief: 'Identify the common thread across these and what to explore next.' },
  ];
}

const toSuggestions = (list: AgentSuggestion[], prefix: string): Suggestion[] =>
  list.map((s, i) => ({ id: `${prefix}-${i}`, label: s.label, agentId: s.agentId, brief: s.brief }));

/** Content-aware cross-cutting actions for a cluster (over titles — fast). */
export async function fetchClusterSuggestions(req: ClusterSuggestRequest): Promise<Suggestion[]> {
  try {
    const res = await fetch('/api/cluster-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: AgentSuggestion[] };
    return toSuggestions(data.suggestions ?? [], 'clai');
  } catch {
    return [];
  }
}

/**
 * Ask the server to read the artifact and propose tailored pills. Resolves to a
 * (possibly empty) Suggestion list — empty means "keep the type-based ones".
 */
export async function fetchTailoredSuggestions(req: SuggestRequest): Promise<Suggestion[]> {
  try {
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: AgentSuggestion[] };
    return (data.suggestions ?? []).map((s, i) => ({
      id: `ai-${i}`,
      label: s.label,
      agentId: s.agentId,
      brief: s.brief,
    }));
  } catch {
    return [];
  }
}
