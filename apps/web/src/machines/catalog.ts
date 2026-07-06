/**
 * Thinking Machines — the client-side catalog: just enough to render the rail
 * submenu tile and the on-canvas block (name, blurb, icon, output shape). The
 * actual SKILL — the system prompt and its research/tool budget — lives
 * server-side (apps/server/src/machines.ts), keyed by the same id, so a machine
 * can research the live web and hold sensitive instructions the client never sees.
 */

import type { AskShape } from '@jarwiz/shared';

/** An optional output a machine can fan out on top of its core result — the
 *  user toggles these on the block before running. Defined here (mirrored on the
 *  server skill by id) so the block can render the checkboxes without a round
 *  trip; the enabled ids ride the run request and the skill honours them. */
export interface MachineOption {
  id: string;
  label: string;
  /** Checked by default? */
  default?: boolean;
}

export interface Machine {
  id: string;
  name: string;
  /** One line shown on the rail tile. */
  blurb: string;
  /** Two-line description shown on the on-canvas block. */
  description: string;
  /** lucide-react icon name, resolved in the palette. */
  icon: string;
  /** The output the machine produces — a single card shape, or 'board' to fan
   *  out into a framework of several cards (server drives both). */
  output: AskShape | 'board';
  /** Optional extra outputs the user can toggle on the block (board machines). */
  options?: MachineOption[];
}

/** The enabled optional-output ids for a block: the ids stored in its meta once
 *  the user has touched them, else the machine's default-on options. One source
 *  of truth for the block checkboxes and the runner. */
export function resolveMachineOptions(metaOptions: unknown, machine: Machine): string[] {
  if (Array.isArray(metaOptions)) return metaOptions.filter((x): x is string => typeof x === 'string');
  return (machine.options ?? []).filter((o) => o.default).map((o) => o.id);
}

export const MACHINES: Machine[] = [
  {
    id: 'swot',
    name: 'SWOT Analysis',
    blurb: 'Researched SWOT + TOWS, fanned into a board',
    description: 'Researches the subject across the live web, then fans out a full SWOT grid of strengths, weaknesses, opportunities and threats.',
    icon: 'Grid2x2',
    output: 'board',
    options: [
      { id: 'tows', label: 'TOWS strategy', default: true },
      { id: 'verdict', label: 'Strategic verdict', default: true },
    ],
  },
  {
    id: 'effortimpact',
    name: 'Effort–Impact Matrix',
    blurb: 'Sort ideas into a quick-wins 2×2',
    description: 'Scores each idea on effort and impact, then drops it into a Quick wins / Big bets / Fill-ins / Time sinks quadrant.',
    icon: 'LayoutGrid',
    output: 'board',
    options: [
      { id: 'verdict', label: 'Sequencing verdict', default: true },
      { id: 'scores', label: 'Score table', default: false },
    ],
  },
  {
    id: 'competitive',
    name: 'Competitive Analysis',
    blurb: 'Web-researched comparison vs real competitors',
    description: 'Finds the real competitors and benchmarks the subject against them on positioning, pricing, strengths and momentum.',
    icon: 'Swords',
    output: 'table',
  },
  {
    id: 'risk',
    name: 'Risk Assessment',
    blurb: 'Researched risks, likelihood, impact, mitigation',
    description: 'Surfaces the likely failure modes with a read on likelihood and impact, and a concrete mitigation for each.',
    icon: 'ShieldAlert',
    output: 'table',
  },
  {
    id: 'proscons',
    name: 'Pros & Cons',
    blurb: 'Weigh the case for and against',
    description: 'Researches the decision across the web, then weighs the strongest evidence-backed arguments for and against.',
    icon: 'Scale',
    output: 'table',
  },
  {
    id: 'fivewhys',
    name: '5 Whys',
    blurb: 'Trace a problem to its root cause',
    description: 'Researches the problem, then traces it down five levels of “why” to a grounded root cause and fix.',
    icon: 'CornerDownRight',
    output: 'list',
  },
  {
    id: 'persona',
    name: 'User Persona',
    blurb: 'Draft a representative user persona',
    description: 'Researches the real audience, then drafts a grounded persona — goals, frustrations and what would win them over.',
    icon: 'UserRound',
    output: 'doc',
  },
];
