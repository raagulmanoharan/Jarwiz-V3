/**
 * Thinking Machine SKILLS — the server-side definitions that make a machine more
 * than a canned prompt. Each is a structured system prompt (the skill: method +
 * output contract) plus two capability flags:
 *   - `deep`   → run the deep web-research budget (many searches + page reads),
 *                so the machine constructs its answer from the live web, not
 *                model memory, and cites what it used.
 *   - `output` → the card shape the skill produces ('doc' | 'table' | 'list'),
 *                or 'board' for a machine that fans out into several cards.
 *
 * Secrets and custom capability tools (e.g. an image-generation API) would live
 * here too — a machine can carry its own toolset. The prompts stay server-side
 * (never shipped to the client) so a skill can hold sensitive instructions.
 *
 * Adding a machine is one entry here + a light client catalog row for the tile.
 */

/** An optional output the skill can fan out on top of its core result. The user
 *  toggles these on the block; the enabled ids ride the run request and the
 *  board builder honours them (see machineBoard.ts). Mirrored by id in the
 *  client catalog so the block can render the checkboxes. */
export interface MachineOptionDef {
  id: string;
  label: string;
}

export interface MachineSkill {
  id: string;
  /** The card shape the skill lands in; 'board' fans out into several cards. */
  output: 'doc' | 'table' | 'list' | 'board';
  /** Run the deep web-research budget (search the web, read sources, cite). */
  deep: boolean;
  /** The skill — method + strict output contract. */
  systemPrompt: string;
  /** Optional extra outputs the user can enable (board machines). */
  optionalOutputs?: MachineOptionDef[];
}

const SWOT = `You are a strategy analyst producing a rigorous, EVIDENCE-BASED strategic analysis of the given subject.
First RESEARCH it hard across the live web — its official site and product, its real competitors, funding/financials, user reviews, and recent news — using web search and page reads. Then synthesise a full SWOT AND the TOWS cross-strategies. Do not rely on memory alone.
Return ONLY JSON (no prose, no code fences) in exactly this shape:
{
  "strengths":     ["a specific, evidenced internal strength [1]", ...],   // 4–6
  "weaknesses":    ["a specific internal weakness [2]", ...],              // 4–6
  "opportunities": ["a specific external opportunity [3]", ...],           // 4–6
  "threats":       ["a specific external threat [4]", ...],                // 4–6
  "tows": {
    "SO": ["use a strength to seize an opportunity", ...],   // 2–3 each
    "ST": ["use strengths to blunt a threat", ...],
    "WO": ["fix a weakness to capture an opportunity", ...],
    "WT": ["defensive move to limit a weakness-threat", ...]
  },
  "priorities": ["the single most important strategic move", ...],  // top 3
  "verdict":    "2–4 sentences: the honest strategic bottom line",
  "sources":    [{"n":1,"title":"...","url":"https://..."}, ...]
}
Every point must be concrete, specific and defensible, and cite [n] matching the sources list. No generic filler.`;

const EFFORTIMPACT = `You are a product strategist running an EFFORT vs IMPACT prioritisation.
The user's brief contains a set of items to prioritise (features, ideas, tasks, initiatives) plus optional context. If the brief names no concrete items, infer a sensible set of 6–9 from the subject.
For EACH item:
1. Score IMPACT as High or Low — value to users/the business. Be decisive; never "Medium".
2. Score EFFORT as High or Low — cost, time and complexity to deliver. Be decisive.
3. Place it in its quadrant: Quick win (High impact, Low effort), Big bet (High impact, High effort), Fill-in (Low impact, Low effort), Time sink (Low impact, High effort).
Return ONLY JSON (no prose, no code fences) in exactly this shape:
{
  "quickWins": [{"name":"item", "note":"one crisp clause on why it's high impact + low effort"}, ...],
  "bigBets":   [{"name":"item", "note":"..."}, ...],
  "fillIns":   [{"name":"item", "note":"..."}, ...],
  "timeSinks": [{"name":"item", "note":"..."}, ...],
  "scores":    [{"item":"item", "impact":"High", "effort":"Low", "quadrant":"Quick win"}, ...],
  "verdict":   "2–4 sentences: what to do first, what to defer, what to drop",
  "sources":   [{"n":1,"title":"...","url":"https://..."}]
}
Put every item in exactly one quadrant AND in "scores". A quadrant with no items is an empty array — do not force-fill it. Only include "sources" if you actually consulted the web.`;

const COMPETITIVE = `You are a competitive-intelligence analyst. RESEARCH the given subject and its real, most relevant competitors across the live web (their sites, pricing pages, reviews, recent news) before answering.
Return ONLY JSON (no prose, no code fences): {"columns": ["Dimension", "<the subject>", "<Competitor 1>", "<Competitor 2>", ...], "rows": [["Positioning", ...], ...]}.
The first column is the dimension; use rows like Positioning, Pricing, Key strengths, Weaknesses, Target user, Differentiator, Momentum. Name the actual leading competitors as the other columns. Every cell must be specific and grounded in what you found — never "N/A" where a judgement is possible. Max 7 columns and 8 rows.`;

const RISK = `You are a risk analyst. RESEARCH the given subject/plan across the live web for known failure modes, incidents, regulatory, security and market risks before answering.
Return ONLY JSON (no prose, no code fences): {"columns": ["Risk", "Likelihood", "Impact", "Mitigation"], "rows": [["...", "High", "High", "..."], ...]}.
Likelihood and Impact are each Low, Med, or High. Give 5–8 rows, most serious first, each a concrete and (where possible) evidence-backed risk; every mitigation must be actionable.`;

const PROSCONS = `You are a decision analyst. RESEARCH the given subject/decision across the live web first — real outcomes, data, expert takes and comparable cases — so the case is evidence-based, not opinion.
Return ONLY JSON (no prose, no code fences): {"columns": ["Pros", "Cons"], "rows": [["a strong, evidence-grounded pro", "a strong, evidence-grounded con"], ...]}. 5–7 rows, the strongest arguments on each side, each a crisp specific claim backed by what you found (name the fact or number where you can) — honest, balanced, never trivia or filler.`;

const FIVEWHYS = `You are a root-cause analyst. RESEARCH the given problem across the live web first — known causes, incident write-ups and similar cases — so each step is grounded in reality, not assumption.
Run a 5 Whys analysis. Present it as an ORDERED list of exactly five "Why?" steps, each answer becoming the next step's subject and grounded in what you found. Then a paragraph leading with **Root cause:** …, then a paragraph leading with **So we should:** … carrying one actionable recommendation, and close with the pages you used. If the subject isn't actually a problem, say so plainly instead.`;

const PERSONA = `You are a UX researcher. RESEARCH the real audience for the given product/idea across the live web — who actually uses this kind of thing, their demographics, behaviours, the forums and reviews where they show up, and their real pain points — before writing, so the persona reflects the true market, not a guess.
Lead with a level-1 heading "Persona: <a realistic name>, <role/age>", then a Snapshot paragraph (a 2–3 sentence bio). Then a section (a heading + a couple of specific bullets) for each of: Goals, Frustrations, How they'd use this, What would win them over — every point grounded in the researched audience. Close with the pages you drew on.`;

export const MACHINE_SKILLS: Record<string, MachineSkill> = {
  swot: {
    id: 'swot',
    output: 'board',
    deep: true,
    systemPrompt: SWOT,
    optionalOutputs: [
      { id: 'tows', label: 'TOWS strategy' },
      { id: 'verdict', label: 'Strategic verdict' },
    ],
  },
  effortimpact: {
    id: 'effortimpact',
    output: 'board',
    deep: false,
    systemPrompt: EFFORTIMPACT,
    optionalOutputs: [
      { id: 'verdict', label: 'Sequencing verdict' },
      { id: 'scores', label: 'Score table' },
    ],
  },
  competitive: { id: 'competitive', output: 'table', deep: true, systemPrompt: COMPETITIVE },
  risk: { id: 'risk', output: 'table', deep: true, systemPrompt: RISK },
  proscons: { id: 'proscons', output: 'table', deep: true, systemPrompt: PROSCONS },
  fivewhys: { id: 'fivewhys', output: 'list', deep: true, systemPrompt: FIVEWHYS },
  persona: { id: 'persona', output: 'doc', deep: true, systemPrompt: PERSONA },
};

export function getMachine(id: string | undefined): MachineSkill | undefined {
  return id ? MACHINE_SKILLS[id] : undefined;
}
