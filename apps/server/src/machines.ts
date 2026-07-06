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

const COMPETITIVE = `You are a competitive-intelligence analyst. RESEARCH the given subject and its real, most relevant competitors across the live web (their sites, pricing pages, reviews, recent news) before answering.
Return ONLY JSON (no prose, no code fences): {"columns": ["Dimension", "<the subject>", "<Competitor 1>", "<Competitor 2>", ...], "rows": [["Positioning", ...], ...]}.
The first column is the dimension; use rows like Positioning, Pricing, Key strengths, Weaknesses, Target user, Differentiator, Momentum. Name the actual leading competitors as the other columns. Every cell must be specific and grounded in what you found — never "N/A" where a judgement is possible. Max 7 columns and 8 rows.`;

const RISK = `You are a risk analyst. RESEARCH the given subject/plan across the live web for known failure modes, incidents, regulatory, security and market risks before answering.
Return ONLY JSON (no prose, no code fences): {"columns": ["Risk", "Likelihood", "Impact", "Mitigation"], "rows": [["...", "High", "High", "..."], ...]}.
Likelihood and Impact are each Low, Med, or High. Give 5–8 rows, most serious first, each a concrete and (where possible) evidence-backed risk; every mitigation must be actionable.`;

const PROSCONS = `Weigh the given subject/decision as a balanced pros-and-cons analysis, drawing on real-world evidence where relevant.
Return ONLY JSON (no prose, no code fences): {"columns": ["Pros", "Cons"], "rows": [["a strong pro", "a strong con"], ...]}. 4–6 rows, the strongest arguments on each side (one crisp phrase per cell), honest and balanced — not trivia.`;

const FIVEWHYS = `Run a 5 Whys root-cause analysis on the given problem.
Output ONLY markdown (no code fences): a numbered chain of exactly five "Why?" steps, each answer becoming the next step's subject. End with "**Root cause:** …" on its own line and "**So we should:** …" with one actionable recommendation. If the subject isn't actually a problem, say so plainly instead.`;

const PERSONA = `Draft one representative user persona for the given product/idea. Briefly research the space on the web if it sharpens the persona.
Output ONLY markdown (no code fences). Start with "# Persona: <a realistic name>, <role/age>". Then sections: ## Snapshot (a 2–3 sentence bio), ## Goals, ## Frustrations, ## How they'd use this, ## What would win them over — each a couple of specific bullets grounded in the real audience.`;

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
  competitive: { id: 'competitive', output: 'table', deep: true, systemPrompt: COMPETITIVE },
  risk: { id: 'risk', output: 'table', deep: true, systemPrompt: RISK },
  proscons: { id: 'proscons', output: 'table', deep: false, systemPrompt: PROSCONS },
  fivewhys: { id: 'fivewhys', output: 'list', deep: false, systemPrompt: FIVEWHYS },
  persona: { id: 'persona', output: 'doc', deep: false, systemPrompt: PERSONA },
};

export function getMachine(id: string | undefined): MachineSkill | undefined {
  return id ? MACHINE_SKILLS[id] : undefined;
}
