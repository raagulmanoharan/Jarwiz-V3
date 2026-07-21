/**
 * The Jarwiz agent registry.
 *
 * Internally Jarwiz is a multi-agent system: the four specialists below route
 * server-side work (researcher / summarizer / brainstormer / writer). To the
 * user there is ONE collaborator — Jarwiz — surfaced everywhere as a single
 * Sparkle-in-circle identity. Internal AgentIds remain the wire-protocol
 * routing key; the public identity is the presentation.
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
