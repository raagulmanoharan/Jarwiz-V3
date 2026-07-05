/**
 * Thinking Machines — the client-side catalog: just enough to render the rail
 * submenu tile and the on-canvas block (name, blurb, icon, output shape). The
 * actual SKILL — the system prompt and its research/tool budget — lives
 * server-side (apps/server/src/machines.ts), keyed by the same id, so a machine
 * can research the live web and hold sensitive instructions the client never sees.
 */

import type { AskShape } from '@jarwiz/shared';

export interface Machine {
  id: string;
  name: string;
  /** One line shown on the tile. */
  blurb: string;
  /** lucide-react icon name, resolved in the palette. */
  icon: string;
  /** The card shape the analysis lands in (server forces the same). */
  output: AskShape;
}

export const MACHINES: Machine[] = [
  { id: 'swot', name: 'SWOT Analysis', blurb: 'Researched, cited strengths/weaknesses/opportunities/threats', icon: 'Grid2x2', output: 'doc' },
  { id: 'competitive', name: 'Competitive Analysis', blurb: 'Web-researched comparison vs real competitors', icon: 'Swords', output: 'table' },
  { id: 'risk', name: 'Risk Assessment', blurb: 'Researched risks, likelihood, impact, mitigation', icon: 'ShieldAlert', output: 'table' },
  { id: 'proscons', name: 'Pros & Cons', blurb: 'Weigh the case for and against', icon: 'Scale', output: 'table' },
  { id: 'fivewhys', name: '5 Whys', blurb: 'Trace a problem to its root cause', icon: 'CornerDownRight', output: 'list' },
  { id: 'persona', name: 'User Persona', blurb: 'Draft a representative user persona', icon: 'UserRound', output: 'doc' },
];
