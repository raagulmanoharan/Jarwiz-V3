/**
 * The Jarwiz agent registry — the single source of truth for the v1 cast.
 *
 * Each agent has a stable id (used in API routes and AgentEvent streams),
 * a display name, an identity color (used for cursors, suggestion chips,
 * card accents, and connection lines), and a one-line tagline.
 */

export type AgentId = 'researcher' | 'summarizer' | 'brainstormer' | 'writer';

export interface AgentMeta {
  readonly id: AgentId;
  readonly name: string;
  /** Identity hue — hex color used consistently across the whole product. */
  readonly color: string;
  readonly tagline: string;
}

export const AGENTS: readonly AgentMeta[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    color: '#2563eb',
    tagline: 'Searches the web and pulls relevant sources onto the board',
  },
  {
    id: 'summarizer',
    name: 'Summarizer',
    color: '#d97706',
    tagline: 'Turns videos, articles, and PDFs into the gist at a glance',
  },
  {
    id: 'brainstormer',
    name: 'Brainstormer',
    color: '#db2777',
    tagline: 'Riffs on any card — angles, hooks, counterpoints, names',
  },
  {
    id: 'writer',
    name: 'Writer',
    color: '#059669',
    tagline: 'Synthesizes selected cards into long-form drafts',
  },
] as const;

export const AGENT_IDS: readonly AgentId[] = AGENTS.map((agent) => agent.id);

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export function getAgent(id: AgentId): AgentMeta {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent id: ${id}`);
  return agent;
}
