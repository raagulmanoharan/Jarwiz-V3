/**
 * Smart response-shape inference for the prompt bar — a *spike*.
 *
 * As the user types "create a pomodoro timer" or "visualise the Q2 earnings
 * report", we guess which shape the answer wants to take and auto-pin the "/"
 * mode chip for them (the delight: they never have to reach for the menu; the
 * chip just appears, and can be dismissed to hand the choice back to Jarwiz).
 *
 * This is a lightweight keyword heuristic, deliberately conservative: it fires
 * only on a recognisable signal and returns `null` (→ the model decides, today's
 * behaviour) otherwise. It is NOT the server-side router — it's a client-side
 * hint that runs on every keystroke, so it must be cheap and never surprising.
 *
 * NOTE on "dashboard": the product has no first-class dashboard node. A
 * "dashboard / visualise / analytics" ask is realised as a BOARD (a laid-out set
 * of cards), so that's what we infer for it. A rendered single-screen UI (an
 * app, a timer, a form) is a PROTOTYPE. The two stay visibly distinct.
 */

import type { AskShape } from '@jarwiz/shared';

/** Response shapes the "/" menu (and this inferrer) can pin. Mirrors PromptBar's
 *  `ModeShape` — 'board' fans out into a set of cards, the rest are single. */
export type ModeShape = AskShape | 'board';

/** A weighted rule: the first pattern to match (in list order) wins, so more
 *  specific intents sit above broader ones. */
interface Rule {
  shape: ModeShape;
  /** Human-readable why, handy for the tooltip / future debugging. */
  cue: string;
  test: RegExp;
}

// Order matters: a "sales dashboard app" is interactive first (prototype),
// while a bare "sales dashboard" is a board. Specific nouns beat generic verbs.
const RULES: Rule[] = [
  // ── Prototype — a live, rendered UI/screen/app ──────────────────────────
  {
    shape: 'prototype',
    cue: 'a live interface',
    test: /\b(pomodoro|stop ?watch|count ?down|timer|calculator|kanban|to-?do app|todo app|chat ?bot|sign[- ]?up|log[- ]?in|checkout|landing page|web ?page|website|mock-?up|wire ?frame|prototype|(?:a|the|my|this|new)\s+(?:app|ui|interface|screen|form|widget|component|game|dashboard app|player|slider|modal))\b/i,
  },
  {
    // "design/build/prototype a <interface-ish thing>"
    shape: 'prototype',
    cue: 'a live interface',
    test: /\b(design|build|prototype|make|create)\b[^.]*\b(app|ui|interface|screen|form|landing|website|web ?page|component|widget|button|modal|game)\b/i,
  },

  // ── Table — tabular / comparison ────────────────────────────────────────
  {
    shape: 'table',
    cue: 'rows × columns',
    test: /\b(table|spread ?sheet|matrix|compare|comparison|\bvs\.?\b|versus|pros and cons|price ?list|pricing|rows? and columns|feature comparison|breakdown by)\b/i,
  },

  // ── Diagram — relationships / flow ──────────────────────────────────────
  {
    shape: 'diagram',
    cue: 'boxes and arrows',
    test: /\b(diagram|flow ?chart|flow|architecture|system design|sequence|org ?chart|mind ?map|hierarchy|tree|pipeline|work ?flow|process(?: map)?|how\b[^.]*\bworks|er ?diagram|uml|state machine|relationship map)\b/i,
  },

  // ── Board — a dashboard / analytics / laid-out set of cards ─────────────
  {
    shape: 'board',
    cue: 'a set of cards',
    test: /\b(dashboard|visuali[sz]e|analytics|metrics|kpis?|report|scorecard|overview of|plan(?:ning)?\b|organi[sz]e|workspace|road ?map|game ?plan|starter pack|everything (?:i|we|you) need|end[- ]to[- ]end)\b/i,
  },

  // ── List — enumerations / checklists ────────────────────────────────────
  {
    shape: 'list',
    cue: 'bullets or a checklist',
    test: /\b(check ?list|to-?do list|todo list|bullet(?: points)?|outline|agenda|itinerary|\btop \d+\b|\d+ (?:ways|reasons|tips|ideas|steps)|step[- ]by[- ]step|a list of|list out)\b/i,
  },

  // ── Doc — written prose (kept last; broadest writing intent) ────────────
  {
    shape: 'doc',
    cue: 'a written card',
    test: /\b(write|draft|summari[sz]e|explain|essay|article|blog(?: post)?|memo|brief|email|cover letter|paragraph|write-?up|documentation)\b/i,
  },
];

export interface InferredMode {
  shape: ModeShape;
  cue: string;
}

/**
 * Infer the response shape from a partial prompt. Returns `null` when nothing
 * matches (→ let the model / router decide, today's default). Ignores "/"
 * command input (that's the explicit menu) and too-short fragments.
 */
export function inferMode(prompt: string): InferredMode | null {
  const p = prompt.trim();
  // Too little to go on, or the user is driving the "/" menu directly.
  if (p.length < 4 || p.startsWith('/')) return null;
  for (const rule of RULES) {
    if (rule.test.test(p)) return { shape: rule.shape, cue: rule.cue };
  }
  return null;
}
