/**
 * Thinking Machines — premade analysis blocks. Each machine takes the input
 * card(s) you point it at and outputs a structured analysis card: a SWOT, a
 * competitive matrix, a risk table, and so on. A machine is just a curated
 * prompt + a forced output shape, run through the normal Ask engine — so its
 * output is a real, grounded, refinable card like any other answer.
 *
 * Adding a machine is one entry here: give it a name, a one-line blurb, an icon,
 * the shape it produces, and the instruction it runs. No server change needed.
 */

import type { AskShape } from '@jarwiz/shared';

export interface Machine {
  id: string;
  name: string;
  /** One line shown on the palette tile. */
  blurb: string;
  /** lucide-react icon name, resolved in the palette. */
  icon: string;
  /** The card shape the analysis lands in. */
  output: AskShape;
  /** The instruction Jarwiz runs, grounded on the selected input card(s). */
  prompt: string;
}

/** Shared preamble — every machine works from the subject the user typed in. */
const ON_INPUT = 'Work from the subject given below. Use what you know about it plus sensible reasoning; if a specific detail is genuinely unknowable, say so briefly rather than inventing facts.';

export const MACHINES: Machine[] = [
  {
    id: 'swot',
    name: 'SWOT Analysis',
    blurb: 'Strengths, weaknesses, opportunities, threats',
    icon: 'Grid2x2',
    output: 'doc',
    prompt: `Run a sharp SWOT analysis of the given subject. ${ON_INPUT}
Start with a heading "# SWOT Analysis". Then four sections — ## Strengths, ## Weaknesses, ## Opportunities, ## Threats — each a short bulleted list of 3–4 concrete, specific points (not generic filler). Strengths/weaknesses are internal; opportunities/threats are external.`,
  },
  {
    id: 'competitive',
    name: 'Competitive Analysis',
    blurb: 'Compare against key competitors',
    icon: 'Swords',
    output: 'table',
    prompt: `Build a competitive analysis for the given subject. ${ON_INPUT}
Output a table: the first column is "Dimension" (rows like Positioning, Pricing, Key strengths, Weaknesses, Target user, Differentiator), and one column per key competitor (name the real, most relevant competitors), plus a column for the subject itself. Fill every cell with a specific, honest comparison — no "N/A" where a judgement can be made.`,
  },
  {
    id: 'proscons',
    name: 'Pros & Cons',
    blurb: 'Weigh the case for and against',
    icon: 'Scale',
    output: 'table',
    prompt: `Weigh the given subject/decision as a pros-and-cons table. ${ON_INPUT}
Two columns: "Pros" and "Cons". Give 4–6 rows, each row a genuinely weighty point (one crisp phrase per cell) — the strongest arguments on each side, not trivia. Be balanced and honest.`,
  },
  {
    id: 'risk',
    name: 'Risk Assessment',
    blurb: 'Risks, likelihood, impact, mitigation',
    icon: 'ShieldAlert',
    output: 'table',
    prompt: `Assess the risks in the given subject/plan. ${ON_INPUT}
Output a table with columns: "Risk", "Likelihood" (Low/Med/High), "Impact" (Low/Med/High), "Mitigation". 5–7 rows, each a concrete, specific risk, ordered most serious first. The mitigation must be actionable.`,
  },
  {
    id: 'fivewhys',
    name: '5 Whys',
    blurb: 'Trace a problem to its root cause',
    icon: 'CornerDownRight',
    output: 'list',
    prompt: `Run a 5 Whys root-cause analysis on the given problem. ${ON_INPUT}
Start from the problem, then ask "why?" five times, each answer becoming the next question's subject — a numbered chain of 5 steps. End with a one-line "Root cause:" and a one-line "So we should:" recommendation. If the subject isn't a problem, say so.`,
  },
  {
    id: 'persona',
    name: 'User Persona',
    blurb: 'Draft a representative user persona',
    icon: 'UserRound',
    output: 'doc',
    prompt: `Draft one representative user persona for the given product/idea. ${ON_INPUT}
Start with a heading "# Persona: <a realistic name>, <role/age>". Then short sections — ## Snapshot (a 2–3 sentence bio), ## Goals, ## Frustrations, ## How they'd use this, ## What would win them over — each a couple of specific bullets.`,
  },
];
