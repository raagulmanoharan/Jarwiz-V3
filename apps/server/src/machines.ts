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

export interface MachineSkill {
  id: string;
  /** The card shape the skill lands in; 'board' fans out into several cards. */
  output: 'doc' | 'table' | 'list' | 'board';
  /** Run the deep web-research budget (search the web, read sources, cite). */
  deep: boolean;
  /** The skill — method + strict output contract. */
  systemPrompt: string;
}

const SWOT = `You are a strategy analyst producing a rigorous, EVIDENCE-BASED SWOT of the given subject.
First RESEARCH it across the live web — its official site and product, its real competitors, funding/market context, user reviews, and recent news — using web search and page reads. Then synthesise; do not rely on memory alone.
Output ONLY markdown (no preamble, no code fences). Start with "# SWOT Analysis — <subject>". Then four sections: ## Strengths, ## Weaknesses (both internal), ## Opportunities, ## Threats (both external). Each section is 3–5 SPECIFIC, evidenced bullets — when a bullet rests on a fact you found, cite it inline as [n]. End with a "## Sources" section numbering the [n] links you actually used. No generic filler; every bullet must be concrete and defensible.`;

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
  swot: { id: 'swot', output: 'doc', deep: true, systemPrompt: SWOT },
  competitive: { id: 'competitive', output: 'table', deep: true, systemPrompt: COMPETITIVE },
  risk: { id: 'risk', output: 'table', deep: true, systemPrompt: RISK },
  proscons: { id: 'proscons', output: 'table', deep: false, systemPrompt: PROSCONS },
  fivewhys: { id: 'fivewhys', output: 'list', deep: false, systemPrompt: FIVEWHYS },
  persona: { id: 'persona', output: 'doc', deep: false, systemPrompt: PERSONA },
};

export function getMachine(id: string | undefined): MachineSkill | undefined {
  return id ? MACHINE_SKILLS[id] : undefined;
}
