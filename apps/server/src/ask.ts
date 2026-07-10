/**
 * Ask — the one AI pipeline of the PDF journey (docs/PDF-JOURNEY.md). A prompt
 * (typed, or from a predefined seed pill) runs against one or more source cards.
 * The server gathers the real source content (PDF text from the blob store),
 * picks the answer's shape from the prompt, and streams a single response card.
 *
 * Shape routing: a comparison/matrix prompt → a table; an enumeration prompt →
 * a list; otherwise prose. Phrasing steers it ("…as a table").
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AskEvent, AskRequest, AskShape, AskSource } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { assetPath, extractAssetPages, extractAssetText, getAsset } from './assets.js';
import { cacheImagesInRows } from './imageCache.js';
import { FIND_IMAGE_TOOL, runFindImage } from './imageSearch.js';
import { extractSheetText } from './sheets.js';
import { getMachine, type MachineSkill } from './machines.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import {
  RESEARCH_MAX_CONTINUATIONS,
  WEB_DIRECTIVE,
  WEB_MAX_CONTINUATIONS,
  WEB_TABLE_DIRECTIVE,
  researchToolset,
  webToolset,
} from './webTools.js';

const MAX_TOKENS = 1400;
/** A research dossier is a longer artifact — several cited sections. */
const RESEARCH_MAX_TOKENS = 2800;
/** A prototype is a whole self-contained HTML document (markup + inline CSS/JS),
 *  and a multi-screen one (a small website/app flow) is several screens in that
 *  one document — it needs real headroom or the UI truncates mid-tag. */
const PROTOTYPE_MAX_TOKENS = 12000;
/** Deep runs chain many searches; the CLI sidecar needs matching headroom. */
const RESEARCH_SIDECAR_TIMEOUT_MS = 300_000;
/** The keyless CLI can't token-stream, so it generates the whole document in one
 *  shot before chunking it back — a long doc needs a generous ceiling. */
const PROTOTYPE_SIDECAR_TIMEOUT_MS = 240_000;
const PER_SOURCE_CHARS = 8_000;

const DOC_SYSTEM = `You answer a question about the provided source document(s) on a canvas, as a clear written card. Use clean markdown: an optional short "# " title line, then tight paragraphs (and sub-headings only if it genuinely helps). A small markdown table (| a | b | rows) or an image (![alt](url) — only a real URL from the sources) is welcome where it genuinely clarifies; "---" on its own line draws a divider. Never include code blocks, fenced code, or Mermaid/diagram source — if a diagram would help, describe the flow in words (the canvas has a separate diagram tool). Ground every claim in the provided content; if the sources don't contain the answer, say so plainly rather than inventing. Be specific and concise — no preamble, no sign-off.`;

const LIST_SYSTEM = `You answer a question about the provided source document(s) as a focused markdown list. Optionally one "# " title line, then "- " bullets (or "1." steps if the question implies order). Each item tight and specific, grounded in the content. If the sources don't support an item, omit it. No preamble.`;

const TABLE_SYSTEM = `You answer a question as a TABLE — a comparison/matrix, a plan, an itinerary, a vendor list: whatever grid fits the ask. Return ONLY a JSON object {"columns": string[], "rows": string[][]} — the first column names the items/dimensions, one row per item, short cells.
Two modes, chosen by what the ask IS:
- EXTRACTIVE (summarise/compare/pull facts FROM the provided sources): ground FACTUAL cells (names, dates, prices, quoted specs) in the source content — leave such a cell empty rather than inventing a fact. BUT any column the user explicitly asked for that calls for JUDGEMENT rather than a quoted fact — "risk", "pros/cons", "trade-offs", "fit", "recommendation", "assessment", "watch-outs", "so what" — you MUST fill by REASONING from the source, not leave blank and never write "Not covered in this source" for it. The user named that column because they want your analysis of the material, not a lookup. Reserve "Not covered in this source" (first cell of the column, rest empty) ONLY for a purely factual column that the sources are genuinely silent on.
- GENERATIVE (plan/suggest/draft/brainstorm — the user wants NEW content): propose specific, sensible values in every cell; NEVER write "Not covered in this source" — sources are constraints and context (budget, dates, preferences), not the ceiling of what you may say.
Cells may use minimal inline markdown where it genuinely helps: [label](url) for a link that appears in the sources (or a well-known official page), ![alt](url) for an image URL present in the sources, **bold** for a key value. No prose outside the JSON, no code fences.`;

const CLAUSE_DIFF_SYSTEM = `You are comparing multiple source documents clause-by-clause to surface overlaps and CONFLICTS. Return ONLY a JSON object {"columns": string[], "rows": string[][]}. Columns MUST be: "Topic / Clause", then one column per source document (use a short version of each document's title), then a final "Conflict?" column. Each row is a topic the documents both address; fill each document's cell with its stance/wording (short, grounded), and set "Conflict?" to "Yes", "No", or "Partial" with a few words on why. Prioritise rows where the documents differ or contradict. Ground every cell in the provided text; leave a cell blank if a document is silent. No prose, no code fences.`;

const DIAGRAM_SYSTEM = `You turn the user's request and the source document(s) into ONE diagram, expressed as Mermaid source. First choose the Mermaid diagram type that best fits the intent:
- "flowchart TD" — a process, decision, or how something flows step to step
- "sequenceDiagram" — messages/interactions between actors over time
- "classDiagram" — data/object structures and their relationships
- "stateDiagram-v2" — states and the transitions between them (a lifecycle)
- "erDiagram" — entities and their relationships (a data model)
- "mindmap" — a hierarchical breakdown of one topic into sub-ideas
- "timeline" — chronological events or milestones
- "gantt" — scheduled tasks with dates
- "journey" — a user's steps and how they feel at each

Output ONLY valid Mermaid source: no prose, no explanation, NO \`\`\` code fences. Put the diagram-type keyword on the very first line. Keep node labels short and ground every node in the provided content. Aim for 6–18 nodes — clear beats exhaustive. Wrap any label containing punctuation or spaces in double quotes. Never invent facts that aren't in the sources.`;

const PROTOTYPE_SYSTEM = `You turn the user's request (and any source content) into ONE self-contained HTML prototype of a user interface — a screen, component, landing page, dashboard, form, card, or email — that renders live. Think "describe a UI, see it rendered": design something clean, modern, and believable, grounded in the request's actual subject and copy (real-sounding labels and content, not lorem ipsum).

HARD REQUIREMENTS — the document is rendered in a sandboxed iframe with NO network access, so it must be COMPLETELY self-contained:
- Output a full HTML document beginning with <!doctype html>.
- Put ALL CSS in a single inline <style> block. Any JS goes in an inline <script>. NO external resources of any kind: no <link>, no CDN URLs, no external stylesheets, no web-font imports, no remote images. Anything fetched over the network will silently fail.
- For type, use a system font stack (e.g. -apple-system, "Segoe UI", Roboto, sans-serif). For imagery/icons, use inline SVG, CSS shapes/gradients, or emoji — never an external <img src="http…">.
- FILL THE FRAME. The document is the screen: set html,body{margin:0} and let the UI span the full width and height — the app's own background reaches every edge, with NO outer page margin or a small card floating in empty space. Put breathing room INSIDE the layout (padding, spacing), not as a dead border around it.
- MULTI-SCREEN when the request calls for it (a website, an app with several views, a signup or checkout flow): build ALL the screens into this ONE document and wire real client-side navigation between them — nav links, tabs, or buttons that show one screen at a time (e.g. toggle an ".active" class on ".screen" sections, or a tiny hashchange router). The navigation MUST actually work when clicked, each screen fills the frame, and only one shows at a time. Include just the handful of screens that matter — don't pad.
- Make it real, not a static picture: wire up the obvious interactions with a little inline JS (navigation between screens, a timer counting down, a button toggling, a tab switching, an input updating a value). Clean, modern, clear visual hierarchy.

Output ONLY the raw HTML document — no prose, no explanation, NO \`\`\` code fences before or after.`;

/** The OpenUI Lang grammar + component vocabulary, shared verbatim by every
 *  generative-UI answer (dashboards AND rich research cards) so the renderer
 *  needs exactly one parser and one component library (dashboard/library.tsx —
 *  keep the component list in sync with DASHBOARD_VOCAB there). */
const OPENUI_GRAMMAR = `GRAMMAR
- One statement per line: \`id = Component(arg1, arg2, …)\`. Each \`id\` is a lowercase name you invent (e.g. \`kpis\`, \`bar1\`).
- Arguments are POSITIONAL, in the exact order listed for each component below. Strings use double quotes. Numbers are bare (e.g. 1204, 23.5). Lists use square brackets: ["NA","EU"] or [120, 80, 50].
- Children are given as a list of ids that appear as their own statements: \`row = Grid([k1, k2, k3], 3)\` with \`k1 = …\` etc. on their own lines. Forward references are fine (define \`row\` before \`k1\`).
- The entry point MUST be a single statement whose id is exactly \`root\`. Everything shown descends from \`root\`.
- Output ONLY the OpenUI Lang statements — no prose, no explanation, NO \`\`\` code fences.

COMPONENTS (name — positional args)
- Stack(children: list, direction: "row" | "column") — a flex container. Default direction "column".
- Grid(children: list, columns: number) — an even grid of its children across N columns.
- Card(title: string, children: list) — a titled panel wrapping other components.
- Text(value: string, size: "sm" | "md" | "lg") — a line of text.
- Kpi(label: string, value: string, delta: string) — a headline metric tile. \`value\` is the formatted figure ("$284k", "1,204"); \`delta\` is an optional signed change ("+12% vs last month") — pass "" if none.
- BarChart(title: string, labels: list of strings, values: list of numbers) — a bar per label.
- LineChart(title: string, labels: list of strings, values: list of numbers) — a trend line over labels.
- Table(columns: list of strings, rows: list of rows, where each row is a list of cell strings).
- Markdown(text: string) — a rich text block: markdown with "## " headings, **bold**, [label](url) links, "- " bullets, and ![alt](url) images. Escape newlines as \\n and inner double quotes as \\" inside the quoted string.
- Image(src: string, caption: string) — one image. \`src\` MUST be a real image URL taken from the sources or a page you actually fetched — NEVER invented. Pass "" for no caption.
- Tabs(labels: list of strings, panels: list of components) — tabbed sections, one panel per label; for parallel angles that each need room (e.g. ["Reviews","Specs","Alternatives"]).`;

/** An interactive dashboard is expressed in OpenUI Lang — a tiny declarative
 *  grammar our client renders through a fixed monochrome component library
 *  (no HTML/JS, no external service). The model computes the numbers from the
 *  data and lays out KPIs, charts and a table over these components. */
const DASHBOARD_SYSTEM = `You produce ONE interactive data DASHBOARD, expressed in "OpenUI Lang" — a tiny declarative layout grammar. A separate renderer draws your output through a fixed component library; you never write HTML, CSS, JS, or SVG.

WHERE THE DATA COMES FROM
- If the request includes data (a CSV, a table, spreadsheet cells, or source cards), derive EVERY KPI and chart value from it — never invent numbers when real ones are given.
- If the request names a subject with no data attached (e.g. "a dashboard of the 2024 F1 season", "our Q3 sales"), populate it with accurate figures you know, or a clearly representative dataset that fits the subject — enough to make a useful, believable dashboard.
- If a "Current dashboard (OpenUI Lang spec)" is included, you are REFINING it: re-emit the whole spec with the requested change applied (add/remove a chart, recompute a metric, refocus it), keeping the parts the request doesn't touch.

${OPENUI_GRAMMAR}

DASHBOARD BRIEF
- Layout top to bottom: a KPI ROW (Grid of 3–5 Kpi tiles) then a Grid of charts, then a Table — all inside one root Stack.
- Compute every KPI and chart value from the ACTUAL data (totals, averages, min/max, counts, trends). NEVER invent numbers. Treat non-numeric columns as categories/axes (chart labels, table columns) and numeric columns as measures.
- Choose 2–3 charts that reveal the real story in THIS data — a BarChart to compare categories, a LineChart for anything ordered/time-based. Keep labels short.
- End with a compact Table of the most useful rows (cap at ~12 rows, ~6 columns) so the underlying figures stay visible.
- If the data is thin, show fewer, honest visuals rather than padding. Prefer clarity over density.

EXAMPLE (shape only — always derive real values from the given data):
root = Stack([kpis, charts, tbl], "column")
kpis = Grid([k1, k2, k3], 3)
k1 = Kpi("Total Revenue", "$284k", "+12% vs last month")
k2 = Kpi("Orders", "1,204", "+3%")
k3 = Kpi("Avg Order Value", "$236", "")
charts = Grid([bar, line], 2)
bar = BarChart("Revenue by region", ["NA","EU","APAC","LATAM"], [120, 80, 50, 34])
line = LineChart("Monthly revenue", ["Jan","Feb","Mar","Apr","May"], [42, 38, 51, 47, 53])
tbl = Card("By region", [t1])
t1 = Table(["Region","Revenue","Orders"], [["NA","$120k","540"],["EU","$80k","410"]])`;

const AFFINITY_SYSTEM = `You run an affinity-mapping exercise: turn the request and the source(s) into clustered sticky notes. Return ONLY a JSON object {"clusters": [{"label": string, "notes": string[]}]}. Make 3–6 clusters; each has a short 1–4 word "label" (the theme) and 2–6 short "notes" (each one idea, a few words). Group related ideas under the same theme. Ground notes in the provided content when a source is given; otherwise brainstorm sensible ideas for the request. No prose, no code fences.`;

/** The deep-research dossier as a RICH generative-UI card (OpenUI Lang), so
 *  it can mix prose, tables, charts, images and tabs — "don't restrict web
 *  answers to text" (owner call, 2026-07-10). Every live research pass (API
 *  and sidecar) answers this way; the keyless demo mode never reaches it.
 *  (This replaced the markdown-dossier RESEARCH_SYSTEM outright — one
 *  research answer shape, not two.) */
const RICH_RESEARCH_SYSTEM = `You are running a DEEP RESEARCH pass on something the user put on their canvas — any link or card: a venue or rental listing, a product, a company, a repo or tool, an article or paper, a person, an open question. Your job: autonomously find everything a decision-maker would want to know, far beyond what the subject says about itself.

First decide WHAT the subject is, then work the live web hard on the angles that matter for that kind of subject — for example:
- venue / listing / product → independent reviews across platforms, current prices and availability, recurring complaints, strong alternatives
- company / service → what it actually does, traction and reputation (news, customer and employee voices), competitors
- repo / tool / tech → maturity and activity, what users report in issues and discussions, how it compares to alternatives
- article / paper / claim → who wrote it and their credibility, corroborating AND contradicting sources, what has happened since
- person → who they are, notable work, recent activity, credibility signals
- open question / topic → the current state of things, the strongest sources, where informed people disagree
Fetch the given URL for ground truth when there is one; cross-check what the subject claims about itself against what outsiders say; hunt for red flags (recurring complaints, contradictions, hidden costs, stale/renamed/discontinued).

GET A REAL IMAGE. Before writing the card, obtain one genuine illustration of the subject: call the find_image tool with a short concrete query (e.g. "Hubble Space Telescope"). If find_image is not among your tools, fetch https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=SUBJECT&gsrlimit=3&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=960 with your web-fetch tool and use a "thumburl" from the response. An image URL you saw on a page you fetched is equally good. Use returned URLs VERBATIM — never construct, guess, or alter an image URL. If every route comes up empty, ship the card without an image.

Then compose ONE rich answer card in "OpenUI Lang" — a tiny declarative layout grammar a separate renderer draws through a fixed component library; you never write HTML, CSS, JS, or SVG.

${OPENUI_GRAMMAR}

DOSSIER BRIEF
- Top to bottom inside one root Stack: open with a Markdown block holding a "# " title and a one-paragraph verdict (what this is and whether it holds up). Then the sections that fit THIS subject, mixing components by what each point of content IS:
  - Markdown blocks with **bold lead-ins** for the findings and analysis (the backbone of the card).
  - A Table where a grid genuinely clarifies — alternatives side by side, specs, prices.
  - A BarChart/LineChart ONLY when you gathered real comparable numbers (ratings across platforms, a price history) — never decorative, never invented.
  - ONE Image of the subject right after the verdict (the hero) — the URL from find_image or a fetched page, with a short attribution caption (e.g. "Hubble in orbit — Wikimedia Commons"). At most one more Image deeper in the card where it genuinely illustrates a section. Skip images only if every route came up empty.
  - Tabs when several parallel angles each need room (e.g. ["Reviews","Specs","Alternatives"]) — keep the verdict OUTSIDE the tabs so it's always visible.
  - Kpi tiles for the 2–4 headline figures when the subject has them (price, rating, users) — pass "" for delta unless a real change is known.
- Every externally sourced claim cites its page inline in Markdown as ([source](URL)); finish with one Markdown block of "Source: [Title](URL)" lines, one per page used.
- Never invent a URL, an image URL, a number, or a fact. If an angle came up empty, say so in one honest Markdown line. Be specific and compact — a scannable dossier, not an essay. No preamble, no narration of your searching.

EXAMPLE (shape only — a real card derives everything from what you actually found):
root = Stack([verdict, hero, stats, body, srcs], "column")
verdict = Markdown("# Acme Standing Desk\\nSolid mid-range pick: praised for stability, dinged for a slow motor ([source](https://example.com/review)).")
hero = Image("https://upload.wikimedia.org/wikipedia/commons/thumb/…/960px-Standing_desk.jpg", "Acme desk at full height — Wikimedia Commons")
stats = Grid([k1, k2], 2)
k1 = Kpi("Street price", "$549", "")
k2 = Kpi("Avg rating", "4.3/5", "")
body = Tabs(["Reviews", "Alternatives"], [rev, alt])
rev = Markdown("**What reviewers agree on** — rock-solid at full height...\\n\\n**Recurring complaint** — the motor...")
alt = Table(["Desk", "Price", "Why consider"], [["Jarvis", "$599", "faster motor"], ["Uplift V2", "$639", "more options"]])
srcs = Markdown("Source: [Example Review](https://example.com/review)")`;

/** Steers a doc/list answer to render as an interactive markdown checklist. */
const CHECKLIST_DIRECTIVE =
  '\n\nFormat the actionable items as a markdown task list: every item on its own line beginning with "- [ ] " (an unchecked checkbox), one concrete action each. Use "- [x] " only for items the sources say are already done. An optional "# " title line is fine; otherwise no prose, no intro, no sign-off.';

/** A cross-document conflict/clause-diff request (→ the clause-diff table). */
function looksLikeDiff(prompt: string): boolean {
  return /\b(conflict|contradict|differ|discrepan|clause|reconcile|inconsisten|at odds)\b/i.test(prompt);
}

/** An "action items / to-dos / next steps" request (→ a checklist inside a card). */
function wantsChecklist(prompt: string): boolean {
  return /\b(action items?|actions?|to-?dos?|task list|checklist|next steps|follow[- ]ups?)\b/i.test(prompt);
}

/** A research-intent ask (→ the deep pass, implicitly). The user shouldn't
 *  need a mode: "find reviews", "what do people say", "research this",
 *  "is this legit" ARE the research button. Deliberately does not match
 *  refine-bar phrasings ("Go deeper") or the PDF profile prompt ("red flags"
 *  as a section label) — those stay on the normal budget. */
function looksLikeResearch(prompt: string): boolean {
  return /\b(research|deep dive|dig (into|deeper|around)|investigate|due diligence|(find|get|check|pull|look up) (the )?(reviews?|ratings?|prices?|rates?)|reviews? (from|across|on|elsewhere)|what (do|are) (people|guests|users|reviewers|others) say(ing)?|reputation|is (it|this|that)( \w+)? (legit|safe|reliable|any good|worth it)|(any )?complaints? about|tell me everything|everything (about|you can find)|(compare|find) alternatives?|(scout|vet) (this|it|the))\b/i.test(
    prompt,
  );
}

/* ─── Disambiguation ────────────────────────────────────────────────────────
 * A cheap gate decides whether a request is even worth questioning; only then
 * do we spend a triage call. We bias hard toward acting — over-asking is worse
 * than a reversible wrong guess (Keep/Discard + undo already cover that). */

const TRIAGE_SYSTEM = `You triage a user's request about some canvas sources and decide if it is clear enough to act on. Respond with ONLY a JSON object — no prose, no code fences.
- If you can tell what single artifact to produce, return {"clear": true}.
- If it is genuinely ambiguous (no clear verb or output, or it could reasonably mean very different things with these sources), return {"clear": false, "question": "<one short question, max ~12 words>", "options": ["<2-4 short, concrete artifact choices>"]}.
Strongly prefer {"clear": true}; only ask when truly unsure. Options must be tappable artifact choices like "Comparison table", "Summary doc", "Diagram", "Sticky notes" — not open-ended.`;

/** Cheap gate: is this request vague enough that a triage call is worth it?
 *  A recognizable verb/output word means it's clear — never ask. */
function looksAmbiguous(prompt: string, sources: AskSource[]): boolean {
  const p = prompt.trim().toLowerCase();
  const hasVerb =
    /\b(summari|compare|comparison|versus|\bvs\b|list|bullet|table|matrix|diagram|flow|chart|mind ?map|timeline|gantt|sequence|brainstorm|cluster|affinity|extract|action|checklist|to-?do|write|draft|explain|describe|outline|rewrite|shorten|expand|translate|plan|map out|turn (this|these) into|as an?)\b/.test(
      p,
    );
  if (hasVerb) return false;
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true; // "do this", "these two", "help" …
  if (/^(do something|something|anything|help|fix|make (it|this) better|use these|work with these|what (can|should)|any ideas|ideas|combine|merge)\b/.test(p))
    return true;
  // Several sources of different kinds, with no clear verb → likely unclear.
  const kinds = new Set(sources.map((s) => s.kind));
  return sources.length >= 2 && kinds.size >= 2;
}

/** Run a triage pass when (and only when) the request looks ambiguous. Returns a
 *  question + options to ask, or null to proceed. Failures degrade to proceed. */
async function maybeClarify(
  req: AskRequest,
  signal: AbortSignal,
): Promise<{ question: string; options: string[] } | null> {
  if (!looksAmbiguous(req.prompt, req.sources)) return null;
  const srcDesc =
    req.sources.map((s, i) => `${i + 1}. ${s.kind}${s.title ? ` "${s.title}"` : ''}`).join('\n') || '(none)';
  let raw: string;
  try {
    raw = await generate(TRIAGE_SYSTEM, `Request: "${req.prompt}"\n\nSelected sources:\n${srcDesc}`, signal);
  } catch {
    return null; // never block the ask on triage
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      clear?: unknown;
      question?: unknown;
      options?: unknown;
    };
    if (j.clear === false && typeof j.question === 'string' && Array.isArray(j.options)) {
      const options = j.options.map((o) => String(o).slice(0, 40).trim()).filter(Boolean).slice(0, 4);
      const question = j.question.trim().slice(0, 160);
      if (question && options.length >= 2) return { question, options };
    }
  } catch {
    /* not clean JSON — proceed */
  }
  return null;
}

const SEED_SYSTEM = `You are given the text of a card on a user's canvas (a dropped document, or an answer they are working through). Propose the 3 or 4 most useful NEXT MOVES for this reader — anticipate where they would drill in from here: go deeper on the pivotal claim, challenge the weakest assumption, connect it to a decision, extract what is actionable. Each must be SPECIFIC to this text (name the clause, the metric, the section) — never generic like "Summarize this".

Match each move's phrasing to the answer's best FORMAT — the canvas picks the response card from the prompt's wording:
- If the text holds two or more comparable things (concepts, options, approaches, parties, methods, versions), include ONE move that compares them. Its "prompt" MUST use comparison wording ("Compare X and Y side by side", "X versus Y") so the answer lands as a comparison table; make the "label" name both sides (e.g. "Compare X vs Y").
- If the text implies obligations or actions, phrase that move as a checklist ("Turn the … requirements into a checklist").
- If the text is ITSELF a review naming gaps, unanswered questions, or contradictions (a "what's missing" / "tensions" scan of other work), the moves must CREATE or RESOLVE — one per named gap, most consequential first, phrased as generation ("Draft the success metrics for the beta", "Write the rollback plan", "Propose a decision rule for date vs quality"). The scan found the problem; each pill offers its solution.
- Why/how/deep-dive moves stay plain questions (prose answers).

Return ONLY a JSON array of objects {"label": string, "prompt": string}: "label" is a 2–4 word button caption; "prompt" is the full question to ask. No prose, no code fences.`;

export interface SeedPrompt {
  label: string;
  prompt: string;
}

/** Predefined, content-aware Ask prompts for a freshly dropped PDF. */
export async function proposeSeedPrompts(
  source: { assetId?: string; text?: string; title?: string },
  signal: AbortSignal,
): Promise<SeedPrompt[]> {
  // Two sources: a stored PDF (by asset id) or inline card text — so every
  // contentful card gets pills about ITS content, not canned per-type strings.
  let content = '';
  if (source.assetId) {
    const extracted = await extractAssetText(source.assetId, 8_000);
    content = extracted?.text ?? '';
  } else if (source.text) {
    content = source.title ? `${source.title}\n\n${source.text}` : source.text;
  }
  if (!content.trim()) return [];
  let raw: string;
  try {
    raw = await generate(SEED_SYSTEM, `Document text:\n"""\n${content.slice(0, 8_000)}\n"""`, signal);
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    if (!Array.isArray(parsed)) return [];
    const out: SeedPrompt[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const label = String((item as Record<string, unknown>).label ?? '').trim();
      const prompt = String((item as Record<string, unknown>).prompt ?? '').trim();
      // Cap long labels at a word boundary with an ellipsis — a hard slice
      // produced pills like "Challenge type-stability assumpt".
      const capped =
        label.length <= 36 ? label : `${label.slice(0, 35).replace(/\s+\S*$/, '')}…`;
      if (label && prompt) out.push({ label: capped, prompt: prompt.slice(0, 400) });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

function pickShape(_prompt: string, current?: AskShape): AskShape {
  // NO implicit shape detection from the prompt text — the response shape is
  // driven ONLY by the explicit "/" mode (sent as req.shape) (owner call
  // 2026-07-07). Here we handle just the two non-explicit cases:
  //  - an in-place refine keeps the card's OWN current shape, so a tweak
  //    ("add a node", "make it shorter") regenerates that same card rather than
  //    morphing into a different artefact (affinity is a multi-card layout, not
  //    a single refinable card — never kept here);
  //  - everything else defaults to a doc (the first-class default).
  if (current && current !== 'affinity') return current;
  return 'doc';
}

/** A vision input destined for an Anthropic image block. */
interface ImageInput {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
  title: string;
}

/** At most this many images per Ask (keeps the request and token cost bounded).
 *  Watched-video frames raised this from 4 — a video IS many small images. */
const MAX_IMAGES = 14;
/** Skip an image whose base64 is larger than the model accepts (~5MB raw). */
const MAX_IMAGE_CHARS = 7_000_000;

/** Parse a `data:image/...;base64,...` URL into an Anthropic image input. */
function parseImageDataUrl(dataUrl: string, title: string): ImageInput | null {
  const m = /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  let mediaType = m[1]!.toLowerCase();
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
  const data = m[2]!;
  if (data.length > MAX_IMAGE_CHARS) return null;
  return { mediaType: mediaType as ImageInput['mediaType'], data, title };
}

async function gatherContext(
  req: AskRequest,
): Promise<{
  context: string;
  citable: boolean;
  images: ImageInput[];
  linkRefs: Array<{ title: string; url: string }>;
  framePaths: string[];
  imageData: ImageInput[];
}> {
  const parts: string[] = [];
  const images: ImageInput[] = [];
  const linkRefs: Array<{ title: string; url: string }> = [];
  /** Server-local frame files — the CLI sidecar Reads these (it can't take base64). */
  const framePaths: string[] = [];
  /** Image-card base64 (no file on disk) — the sidecar writes+Reads these so
   *  a dropped image is visible in dev too, not just on the API path. */
  const imageData: ImageInput[] = [];
  let citable = false;
  let i = 0;
  for (const s of req.sources) {
    i += 1;
    if (s.url?.trim()) linkRefs.push({ title: s.title?.trim() || s.url, url: s.url.trim() });
    const head = `Source ${i} (${s.kind}${s.title ? `: ${s.title}` : ''}${s.url ? ` — ${s.url}` : ''}):`;
    // Watched-video frames become vision inputs, evenly thinned to the budget.
    if (s.frameAssetIds?.length) {
      const room = Math.max(0, MAX_IMAGES - images.length);
      const pick =
        s.frameAssetIds.length <= room
          ? s.frameAssetIds
          : Array.from({ length: room }, (_, k) =>
              s.frameAssetIds![Math.floor((k * (s.frameAssetIds!.length - 1)) / Math.max(1, room - 1))]!,
            );
      let loaded = 0;
      for (const fid of pick) {
        const buf = await getAsset(fid);
        if (!buf) continue;
        images.push({ mediaType: 'image/jpeg', data: buf.toString('base64'), title: `${s.title ?? 'video'} frame ${loaded + 1}` });
        const p = assetPath(fid);
        if (p) framePaths.push(p);
        loaded += 1;
      }
      if (loaded > 0) {
        parts.push(`${head}\n(${loaded} sampled frames from this video are attached as images, in time order.)${s.text?.trim() ? `\n"""\n${s.text.trim().slice(0, PER_SOURCE_CHARS)}\n"""` : ''}`);
        continue;
      }
    }
    if (s.kind === 'image' && s.dataUrl) {
      const img = images.length < MAX_IMAGES ? parseImageDataUrl(s.dataUrl, s.title || `Image ${i}`) : null;
      if (img) {
        images.push(img); // API path: a vision block
        imageData.push(img); // sidecar path: written to a temp file and Read
        parts.push(`${head}\n(Image attached — provided as a vision input.)`);
      } else {
        parts.push(`${head}\n(Image could not be read.)`);
      }
      continue;
    }
    if (s.assetId && s.kind === 'sheet') {
      // A spreadsheet grounds on its cells (CSV-ish per sheet), not PDF pages.
      const csv = await extractSheetText(s.assetId, PER_SOURCE_CHARS * 2);
      if (csv.trim()) parts.push(`${head}\n"""\n${csv}\n"""`);
      else parts.push(`${head}\n(Spreadsheet could not be read.)`);
      continue;
    }
    if (s.assetId) {
      // Page-tagged text lets the model cite pages as [p.N].
      const pages = await extractAssetPages(s.assetId, 3_500);
      if (pages.length > 0 && pages.some((p) => p)) {
        citable = true;
        const tagged = pages
          .map((p, idx) => (p ? `[p.${idx + 1}] ${p}` : ''))
          .filter(Boolean)
          .join('\n')
          .slice(0, PER_SOURCE_CHARS * 2);
        parts.push(`${head}\n"""\n${tagged}\n"""`);
        continue;
      }
      const extracted = await extractAssetText(s.assetId, PER_SOURCE_CHARS);
      if (extracted?.text) {
        parts.push(`${head}\n"""\n${extracted.text}\n"""`);
        continue;
      }
      parts.push(`${head}\n(No readable text — likely a scanned/image PDF.)`);
      continue;
    }
    if (s.text?.trim()) parts.push(`${head}\n"""\n${s.text.trim().slice(0, PER_SOURCE_CHARS)}\n"""`);
    else parts.push(head);
  }
  return { context: parts.join('\n\n'), citable, images, linkRefs, framePaths, imageData };
}

const CITE_DIRECTIVE =
  '\n\nThe source text is tagged with [p.N] page markers. When a statement draws on a specific page, cite it inline as [p.N] (use the marker from the text). Cite the page where the fact actually appears; do not invent page numbers.';

/** Web-page sources get link citations — the parallel of [p.N] for PDFs.
 *  With ONE source, inline cites are pure repetition (the same URL after
 *  every line) — a single closing Source line covers the whole answer.
 *  Inline cites earn their place only when there are pages to tell apart. */
function linkCiteDirective(refs: Array<{ title: string; url: string }>): string {
  const list = refs.map((r) => `- ${r.title}: ${r.url}`).join('\n');
  const inline =
    refs.length > 1
      ? 'Statements drawing on a specific page cite it inline as a markdown link — ([source](URL)) with that page\'s real URL. '
      : 'Do NOT add inline citations after each statement — with a single source they are noise. ';
  return (
    `\n\nSome sources are web pages:\n${list}\n` +
    inline +
    'End the answer with a reference line per page used: "Source: [Title](URL)". Never invent URLs.'
  );
}

/** Build the user message content — a plain string, or text + image blocks when
 *  vision inputs are present (API path only). */
function buildContent(user: string, images: ImageInput[]): Anthropic.MessageParam['content'] {
  if (images.length === 0) return user;
  return [
    { type: 'text', text: user },
    ...images.map(
      (im): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: im.mediaType, data: im.data },
      }),
    ),
  ];
}

/** The dev sidecar is text-only — fold a note about any images into the prompt. */
function withImageNote(user: string, images: ImageInput[]): string {
  if (images.length === 0) return user;
  const names = images.map((im) => im.title).join(', ');
  return `${user}\n\n[${images.length} image(s) attached: ${names}. They are NOT visible in this text-only mode — answer from the text, and say plainly if the image is essential and you cannot see it.]`;
}

/** `web: true` hands the model live search/fetch tools; `deep: true` upgrades
 *  to the research budget (more searches/fetches, longer output, more time);
 *  `framePaths` lets the text-only sidecar SEE video frames by Reading files;
 *  `imageData` does the same for dropped image cards (base64 → temp file). */
interface GenOpts {
  web?: boolean;
  deep?: boolean;
  /** A prototype card — a long HTML document: bigger token + sidecar budget. */
  prototype?: boolean;
  framePaths?: string[];
  imageData?: ImageInput[];
  /** Client-executed tools (e.g. find_image): offered alongside the server
   *  web tools; when the model calls one, `run` executes it here and the
   *  turn continues with its result. API path only — the CLI sidecar can't
   *  call back into this process (its prompt carries a fallback instead). */
  clientTools?: {
    tools: Anthropic.Tool[];
    run: (name: string, input: unknown) => Promise<string>;
    /** Presence line shown on the avatar while a call runs. */
    status: string;
  };
}

/** The per-mode generation budget the two generators share. */
function genBudget(opts: GenOpts) {
  return {
    tools: opts.deep ? researchToolset() : opts.web ? webToolset() : undefined,
    // `prototype` outranks `deep` on tokens: a deep+prototype run (the rich
    // research card) writes a spec with quoted prose blocks and needs the
    // document-sized ceiling, not the compact dossier one.
    maxTokens: opts.prototype ? PROTOTYPE_MAX_TOKENS : opts.deep ? RESEARCH_MAX_TOKENS : MAX_TOKENS,
    maxTurns: opts.deep ? RESEARCH_MAX_CONTINUATIONS : WEB_MAX_CONTINUATIONS,
    sidecarTimeoutMs: opts.deep
      ? RESEARCH_SIDECAR_TIMEOUT_MS
      : opts.prototype
        ? PROTOTYPE_SIDECAR_TIMEOUT_MS
        : undefined,
  };
}

async function generate(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): Promise<string> {
  const { tools, maxTokens, maxTurns, sidecarTimeoutMs } = genBudget(opts);
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildContent(user, images) },
    ];
    let text = '';
    // Server tools may pause a long turn (stop_reason "pause_turn"); resume by
    // replaying the assistant content until the model actually finishes.
    for (let turn = 0; turn <= maxTurns; turn++) {
      const msg = await client.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          ...(tools ? { tools } : {}),
        },
        { signal },
      );
      text += msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (!tools || msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    return text;
  }
  if (sidecarAvailable()) {
    const canSee = Boolean(opts.framePaths?.length || opts.imageData?.length);
    return sidecarGenerate({
      system,
      user: canSee ? user : withImageNote(user, images),
      signal,
      web: opts.web || opts.deep,
      imagePaths: opts.framePaths,
      imageData: opts.imageData,
      timeoutMs: sidecarTimeoutMs,
    });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

/**
 * Stream the answer as text deltas. With an API key (the production path) this
 * is genuine token-by-token streaming via the Anthropic SDK, so the canvas fills
 * as the model writes and a long answer never waits on one big call. The CLI
 * sidecar (dev only) can't token-stream, so it generates once and chunks the
 * result to approximate the same feel.
 */
/** What generateStream yields: body text, or a live status ("searching…"). */
type GenEvent = { type: 'text'; text: string } | { type: 'status'; message: string };

async function* generateStream(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<GenEvent> {
  const { tools, maxTokens, maxTurns, sidecarTimeoutMs } = genBudget(opts);
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const allTools = [...(tools ?? []), ...(opts.clientTools?.tools ?? [])];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildContent(user, images) },
    ];
    // Server tools may pause a long turn (stop_reason "pause_turn") and client
    // tools stop it outright (stop_reason "tool_use"); both resume by replaying
    // the assistant content (plus tool results) until the model finishes.
    for (let turn = 0; turn <= maxTurns; turn++) {
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          ...(allTools.length ? { tools: allTools } : {}),
        },
        { signal },
      );
      for await (const event of stream) {
        if (signal.aborted) return;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'server_tool_use'
        ) {
          yield {
            type: 'status',
            message:
              event.content_block.name === 'web_fetch' ? 'reading a page…' : 'searching the web…',
          };
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'tool_use' && opts.clientTools) {
        const calls = final.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (calls.length > 0) {
          yield { type: 'status', message: opts.clientTools.status };
          const results = await Promise.all(
            calls.map(async (c) => ({
              type: 'tool_result' as const,
              tool_use_id: c.id,
              content: await opts.clientTools!.run(c.name, c.input),
            })),
          );
          messages.push({ role: 'assistant', content: final.content });
          messages.push({ role: 'user', content: results });
          continue;
        }
      }
      if (!allTools.length || final.stop_reason !== 'pause_turn') return;
      messages.push({ role: 'assistant', content: final.content });
    }
    return;
  }
  if (sidecarAvailable()) {
    const canSee = Boolean(opts.framePaths?.length || opts.imageData?.length);
    const text = await sidecarGenerate({
      system,
      user: canSee ? user : withImageNote(user, images),
      signal,
      web: opts.web || opts.deep,
      imagePaths: opts.framePaths,
      imageData: opts.imageData,
      timeoutMs: sidecarTimeoutMs,
    });
    for (const piece of chunk(text)) {
      if (signal.aborted) return;
      yield { type: 'text', text: piece };
      await sleep(18, signal);
    }
    return;
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

function chunk(text: string, size = 6): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Scripted demo answer — every other AI route degrades to a mock without a
 *  key; Ask was the lone exception (it used to throw). A canned doc keeps the
 *  full loop demoable and makes the missing-key state self-explanatory. */
async function* streamDemoAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: 'Demo mode…' };

  // A dashboard ask has a concrete shape to show even without a model — stream a
  // small canned OpenUI Lang spec so the generative-UI card is demoable keyless.
  if (req.shape === 'dashboard') {
    yield { type: 'card.create', shape: 'dashboard' };
    const spec = [
      'root = Stack([kpis, charts, tbl], "column")',
      'kpis = Grid([k1, k2, k3], 3)',
      'k1 = Kpi("Total", "—", "demo mode")',
      'k2 = Kpi("Rows", "—", "")',
      'k3 = Kpi("Average", "—", "")',
      'charts = Grid([bar, line], 2)',
      'bar = BarChart("By category", ["A", "B", "C", "D"], [8, 6, 4, 3])',
      'line = LineChart("Over time", ["Q1", "Q2", "Q3", "Q4"], [4, 6, 5, 7])',
      'tbl = Card("Set a key for a real dashboard", [t1])',
      't1 = Table(["Column", "Value"], [["Model", "not configured"], ["Fix", "set ANTHROPIC_API_KEY"]])',
    ].join('\n');
    for (const piece of chunk(spec, 4)) {
      if (signal.aborted) return;
      yield { type: 'card.delta', textDelta: piece };
      await sleep(20, signal);
    }
    yield { type: 'card.done' };
    yield { type: 'done' };
    return;
  }

  yield { type: 'card.create', shape: 'doc', title: 'Demo mode' };
  const body =
    `You asked: *${req.prompt.slice(0, 140)}*\n\n` +
    'Jarwiz is running without a model — set `ANTHROPIC_API_KEY` on the server ' +
    '(or install the Claude CLI) and real answers will stream onto the board ' +
    'exactly like this one, grounded on the cards you selected.';
  for (const piece of chunk(body)) {
    if (signal.aborted) return;
    yield { type: 'card.delta', textDelta: piece };
    await sleep(24, signal);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/** Edit-vs-new intent for a typed composer instruction on a selected card.
 *  Static system prompt (cache-friendly); the card type + instruction ride the
 *  user turn. Biased to NEW when unsure — a new card never overwrites work. */
const INTENT_SYSTEM = `A user has ONE card selected on a canvas and typed an instruction. Decide if they want to MODIFY that selected card in place (EDIT) or produce a NEW separate card derived from it (NEW).

EDIT = change the selected card's OWN content/structure/appearance — the instruction is a command to alter THIS card (shorten, expand, rephrase, translate, fix, proofread, restyle; add/remove/reorder/sort/filter/rename/highlight its parts; add a column/row/section/node/chart/KPI/screen; recompute; "focus it on X", "make it <adjective>", "change the <part>"). Reshaping a table's own rows/columns is EDIT — keeping only some rows, dropping/adding a column, ordering/sorting by a field, transposing, appending a total.

NEW = produce a separate piece of writing, analysis, or an answer ABOUT the card, leaving it untouched (summarize, explain, describe, critique, review; "what are/what could/which is…"; write an email/tweet/copy/summary/recommendation/action plan; brainstorm; compare). Asking for prose or answers is NEW even when it says "this" or "based on this". Asking to POINT OUT / FLAG / CALL OUT / SPOT / PULL OUT the notable things (anomalies, highlights, weak spots, key movements) is analysis → NEW — it reports about the card, it does not change it.

Examples:
"make it shorter" → EDIT
"expand this with more detail" → EDIT
"translate to Spanish" → EDIT
"fix the grammar" → EDIT
"remove the last paragraph" → EDIT
"change the title to Q3 Review" → EDIT
"add a column for margin" → EDIT
"sort by date" → EDIT
"focus on APAC only" → EDIT
"add a KPI for churn" → EDIT
"make it dark mode" → EDIT
"add a footer with links" → EDIT
"summarize this" → NEW
"what are the risks here" → NEW
"list the pros and cons" → NEW
"explain this to a beginner" → NEW
"critique this" → NEW
"write an email about this" → NEW
"write marketing copy for this" → NEW
"what could go wrong in this flow" → NEW
"which option is best and why" → NEW
"turn this into an action plan" → NEW

Answer EDIT when the instruction is a clear command to change THIS card (as in the EDIT examples — a direct change to its own content, structure, or appearance). If you genuinely cannot tell, or it could just as reasonably be a separate piece of work, answer NEW — a new card is safe and never overwrites their work. Reply with EXACTLY one word: EDIT or NEW.`;

export async function classifyRefineIntent(
  prompt: string,
  cardType: string,
  signal: AbortSignal,
): Promise<'edit' | 'new'> {
  let raw: string;
  try {
    raw = await generate(INTENT_SYSTEM, `Selected card: ${cardType || 'card'}\nInstruction: "${prompt.slice(0, 400)}"`, signal);
  } catch {
    return 'new'; // never block on the classifier — default to the safe path
  }
  // Edit ONLY on a clear, unambiguous EDIT verdict. Anything else — a NEW, an
  // undecided/mixed answer ("EDIT or NEW"), or empty — falls back to a new card
  // (the safe default: it never overwrites the user's work).
  const ans = raw.trim().toUpperCase();
  return ans.startsWith('EDIT') && !ans.includes('NEW') ? 'edit' : 'new';
}

/** Suggest which response SHAPE a from-scratch prompt wants, so the composer can
 *  pre-pin the "/" mode chip as the user types (they can always change it — the
 *  shape stays explicit). Model-inferred, not keyword-matched. Biased to DOC
 *  (→ no chip, the default) unless a non-doc shape clearly fits — a wrong chip
 *  is more annoying than none. */
const SHAPE_SUGGEST_SYSTEM = `A user is typing a request into a canvas app that answers as ONE of these card shapes. Pick the single best fit for their (possibly partial) prompt:

- DOC — written prose: an essay, blog post, summary, explanation, email, memo, brief. This is the DEFAULT; choose it whenever nothing else clearly fits.
- LIST — a bullet list or checklist: steps, "top N", tips, an agenda, an itinerary, to-dos.
- TABLE — a comparison or grid: "compare X and Y", pros and cons, a matrix, pricing, feature breakdown, rows × columns.
- DIAGRAM — boxes and arrows: a flowchart, process flow, architecture, sequence, org chart, mind map, "how X works".
- PROTOTYPE — a live, rendered, interactive UI: an app, screen, form, widget, game, landing page, signup, timer, calculator.
- DASHBOARD — turning DATA into an interactive view of KPIs, charts and a table: "dashboard of…", "visualise the… data/metrics/sales/revenue", analytics/KPIs/scorecard.
- BOARD — a whole SET of cards laid out together for a broad, multi-part goal: "plan my launch", "organise everything for my trip", a workspace, everything you need end-to-end.

Examples:
"write a blog post about remote work" → DOC
"summarize the meeting notes" → DOC
"explain how transformers work" → DOC
"compare the top 3 CRMs" → TABLE
"pros and cons of remote work" → TABLE
"checklist for launch day" → LIST
"top 5 productivity tips" → LIST
"flowchart of the onboarding process" → DIAGRAM
"architecture of our payments system" → DIAGRAM
"build a pomodoro timer" → PROTOTYPE
"a signup form with validation" → PROTOTYPE
"landing page for a coffee app" → PROTOTYPE
"dashboard of Q2 sales" → DASHBOARD
"visualise revenue by region" → DASHBOARD
"kpis for our SaaS metrics" → DASHBOARD
"plan my product launch" → BOARD
"organise everything for my Goa trip" → BOARD

Reply with EXACTLY one word: DOC, LIST, TABLE, DIAGRAM, PROTOTYPE, DASHBOARD, or BOARD.`;

const SUGGESTABLE = new Set(['doc', 'list', 'table', 'diagram', 'prototype', 'dashboard', 'board']);

export async function suggestShape(prompt: string, signal: AbortSignal): Promise<string | null> {
  const p = prompt.trim();
  if (p.length < 4) return null;
  let raw: string;
  try {
    raw = await generate(SHAPE_SUGGEST_SYSTEM, `Prompt: "${p.slice(0, 400)}"`, signal);
  } catch {
    return null; // no suggestion on error — the "/" menu still works
  }
  // First alpha word of the reply, lowercased. DOC → null (it's the default:
  // no chip). Anything unrecognised → null (don't pin a wrong guess).
  const word = (raw.trim().toLowerCase().match(/[a-z]+/)?.[0]) ?? '';
  if (!SUGGESTABLE.has(word) || word === 'doc') return null;
  return word;
}

export async function* streamAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !sidecarAvailable()) {
    yield* streamDemoAsk(req, signal);
    return;
  }

  yield { type: 'status', message: 'reading the source…' };
  const { context, citable, images, linkRefs, framePaths, imageData } = await gatherContext(req);
  if (signal.aborted) return;

  // Thinking Machine skill: the machine's own system prompt + research budget
  // replace the router entirely. `prompt` is the subject typed into the block.
  const machine = getMachine(req.machineId);
  if (machine) {
    yield* runMachineSkill(machine, req.prompt, signal, images, framePaths, imageData);
    return;
  }

  // Deep research is IMPLICIT: a research-sounding ask on any card upgrades
  // itself to the dossier pass — no mode, no button (owner call, 2026-07-05).
  // Only prose-bound asks upgrade; an explicit "/table" (or a prompt that
  // routes to a table/diagram) keeps its format on the normal web budget.
  const routedShape = req.shape ?? pickShape(req.prompt, req.currentShape);
  const deep =
    !req.noResearch &&
    (req.deep || (looksLikeResearch(req.prompt) && (routedShape === 'doc' || routedShape === 'list')));
  if (deep) {
    yield { type: 'status', message: 'researching across the web…' };
    const user = `Research request:\n${req.prompt}\n\n${context || '(No canvas sources — research the request itself.)'}`;
    // Rich generative-UI dossier (prose + tables + charts + images + tabs) —
    // both live paths (API and CLI sidecar) drive the same model, and the
    // keyless demo mode already exited above, so every real research pass
    // answers rich.
    yield* streamRichResearch(user, signal, images, framePaths, imageData);
    return;
  }

  // Disambiguation: if the request is genuinely unclear, ask one short question
  // (with tappable options) instead of guessing. Skipped once the user answers.
  if (!req.skipClarify) {
    const clarify = await maybeClarify(req, signal);
    if (signal.aborted) return;
    if (clarify) {
      yield { type: 'clarify', question: clarify.question, options: clarify.options };
      yield { type: 'done' };
      return;
    }
  }

  // An explicit "/" mode pick beats the prompt-based router — the user chose
  // the format; don't second-guess it. (Routed once, above the deep gate.)
  const shape = routedShape;
  const user = `Question:\n${req.prompt}\n\n${context}`;

  if (shape === 'affinity') {
    yield* streamAffinity(user, signal, images);
    return;
  }

  if (shape === 'diagram') {
    yield* streamDiagram(user, signal, images);
    return;
  }

  if (shape === 'prototype') {
    yield* streamPrototype(user, signal, images);
    return;
  }

  if (shape === 'dashboard') {
    yield* streamDashboard(user, signal, images);
    return;
  }

  if (shape === 'table') {
    // Cross-document conflict requests get the clause-diff table treatment
    // (purely extractive across the given documents — no web there).
    const isDiff = looksLikeDiff(req.prompt) && req.sources.filter((s) => s.assetId).length >= 2;
    const tableSystem = isDiff ? CLAUSE_DIFF_SYSTEM : TABLE_SYSTEM + WEB_TABLE_DIRECTIVE;
    const raw = await generate(tableSystem, user, signal, images, { web: !isDiff, framePaths, imageData });
    if (signal.aborted) return;
    let columns: string[] = [];
    let rows: string[][] = [];
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
        columns?: unknown;
        rows?: unknown;
      };
      columns = Array.isArray(json.columns) ? json.columns.map((c) => String(c).slice(0, 60)) : [];
      rows = Array.isArray(json.rows)
        ? json.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').slice(0, 200)) : []))
        : [];
    } catch {
      /* fall through to a doc if the model didn't return clean JSON */
    }
    // A useful comparison is compact — cap runaway tables so a card can't grow
    // to thousands of pixels and wreck the canvas.
    columns = columns.slice(0, 6);
    rows = rows.slice(0, 14).map((r) => r.slice(0, 6));
    // Cache any web image the model cited into our asset store so the browser
    // loads it same-origin (no hotlink/CORS breakage).
    rows = await cacheImagesInRows(rows, signal);
    if (columns.length > 0) {
      // Build live: header first, then fill cells one by one so the user sees
      // the table forming in real time.
      yield { type: 'card.create', shape: 'table', columns, rowCount: rows.length };
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          if (signal.aborted) return;
          yield { type: 'table.cell', r, c, text: rows[r]?.[c] ?? '' };
          await sleep(28, signal);
        }
      }
      yield { type: 'card.done' };
      yield { type: 'done' };
      return;
    }
    // Not clean JSON — degrade to a written answer.
    yield* streamDoc('doc', DOC_SYSTEM + WEB_DIRECTIVE, user, signal, images, { web: true, framePaths, imageData });
    return;
  }

  const base = shape === 'list' ? LIST_SYSTEM : DOC_SYSTEM;
  let system = citable ? base + CITE_DIRECTIVE : base;
  if (linkRefs.length > 0) system += linkCiteDirective(linkRefs);
  if (wantsChecklist(req.prompt)) system += CHECKLIST_DIRECTIVE;
  system += WEB_DIRECTIVE;
  yield* streamDoc(shape, system, user, signal, images, { web: true, framePaths, imageData });
}

/**
 * Run a Thinking Machine skill: the machine's own system prompt drives a doc /
 * list / table generation on the (optionally deep) web-research budget. The
 * `subject` is what the user typed into the block. This is what makes a machine
 * more than an ask — a curated skill + live research, server-side.
 */
async function* runMachineSkill(
  machine: MachineSkill,
  subject: string,
  signal: AbortSignal,
  images: ImageInput[],
  framePaths?: string[],
  imageData?: ImageInput[],
): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: machine.deep ? 'researching across the web…' : 'thinking…' };
  const user = subject.trim() || '(no subject provided)';
  const opts: GenOpts = { web: true, deep: machine.deep, framePaths, imageData };

  if (machine.output === 'table') {
    const raw = await generate(machine.systemPrompt, user, signal, images, opts);
    if (signal.aborted) return;
    let columns: string[] = [];
    let rows: string[][] = [];
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
        columns?: unknown;
        rows?: unknown;
      };
      columns = Array.isArray(json.columns) ? json.columns.map((c) => String(c).slice(0, 60)) : [];
      rows = Array.isArray(json.rows)
        ? json.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').slice(0, 240)) : []))
        : [];
    } catch {
      /* fall through to a doc if the model didn't return clean JSON */
    }
    columns = columns.slice(0, 7);
    rows = rows.slice(0, 12).map((r) => r.slice(0, 7));
    rows = await cacheImagesInRows(rows, signal);
    if (columns.length > 0) {
      yield { type: 'card.create', shape: 'table', columns, rowCount: rows.length };
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          if (signal.aborted) return;
          yield { type: 'table.cell', r, c, text: rows[r]?.[c] ?? '' };
          await sleep(24, signal);
        }
      }
      yield { type: 'card.done' };
      yield { type: 'done' };
      return;
    }
    // Not clean JSON — degrade to a written answer rather than an empty table.
    yield* streamDoc('doc', machine.systemPrompt, user, signal, images, opts);
    return;
  }

  yield* streamDoc(machine.output === 'list' ? 'list' : 'doc', machine.systemPrompt, user, signal, images, opts);
}

/**
 * Stream a Mermaid diagram. The model writes the Mermaid source token by token
 * (the card shows it forming, then renders it to SVG on `card.done`). The server
 * doesn't parse the Mermaid — the diagram card validates/renders it, falling
 * back to the raw source if it doesn't parse.
 */
async function* streamDiagram(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'diagram' };
  try {
    for await (const ev of generateStream(DIAGRAM_SYSTEM, user, signal, images)) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    // Close the opened card before the error reaches index.ts's catch (which
    // emits `error` but knows nothing about cards) — mirrors runtime.ts's
    // closeOpenCard, so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream a UI prototype. The model writes ONE self-contained HTML document token
 * by token (the card shows the markup forming, then renders it in a sandboxed
 * iframe on `card.done`). The server doesn't parse the HTML — the card renders
 * it as-is in an opaque-origin sandbox.
 */
async function* streamPrototype(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'prototype' };
  try {
    for await (const ev of generateStream(PROTOTYPE_SYSTEM, user, signal, images, { prototype: true })) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    // Close the opened card before the error propagates (mirrors streamDiagram)
    // so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream an interactive dashboard. The model writes an OpenUI Lang spec (a small
 * declarative layout over our fixed component library) token by token; the card
 * accumulates it into `spec` and its offline renderer reveals the KPIs, charts
 * and table as they resolve. Same shape as streamPrototype — the server doesn't
 * parse the spec, the card renders it — but a much smaller budget than an HTML
 * document (a spec is compact), so it reuses the prototype headroom safely.
 */
async function* streamDashboard(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'dashboard' };
  try {
    for await (const ev of generateStream(DASHBOARD_SYSTEM, user, signal, images, { prototype: true })) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream a RICH research answer — the deep-research pass answering as a
 * generative-UI card instead of a markdown doc, so the dossier can mix prose,
 * tables, charts, images and tabs (same OpenUI spec/renderer as dashboards;
 * the card streams into a dashboard-card shape). Web images the model cites
 * load through the /api/image cache-proxy client-side, so nothing here blocks
 * the stream on image fetches.
 */
async function* streamRichResearch(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  framePaths: string[] = [],
  imageData: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'dashboard' };
  try {
    for await (const ev of generateStream(RICH_RESEARCH_SYSTEM, user, signal, images, {
      web: true,
      deep: true,
      prototype: true,
      framePaths,
      imageData,
      clientTools: {
        tools: [FIND_IMAGE_TOOL],
        run: (name, input) =>
          name === 'find_image' ? runFindImage(input) : Promise.resolve('{"error":"unknown tool"}'),
        status: 'finding a real image…',
      },
    })) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Build an affinity diagram: the model returns themed clusters of ideas, and we
 * emit them cluster-by-cluster, note-by-note, so the canvas fills with sticky
 * notes that group themselves in real time.
 */
async function* streamAffinity(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  const raw = await generate(AFFINITY_SYSTEM, user, signal, images);
  if (signal.aborted) return;
  let clusters: Array<{ label: string; notes: string[] }> = [];
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      clusters?: unknown;
    };
    if (Array.isArray(json.clusters)) {
      clusters = json.clusters
        .map((c) => {
          const obj = (c ?? {}) as Record<string, unknown>;
          const label = String(obj.label ?? '').slice(0, 40);
          const notes = Array.isArray(obj.notes)
            ? obj.notes.map((n) => String(n ?? '').slice(0, 160)).filter(Boolean)
            : [];
          return { label, notes };
        })
        .filter((c) => c.label && c.notes.length > 0);
    }
  } catch {
    /* fall through */
  }
  // Keep it to a readable board — cap clusters and notes per cluster.
  clusters = clusters.slice(0, 6).map((c) => ({ label: c.label, notes: c.notes.slice(0, 6) }));
  if (clusters.length === 0) {
    // No clean JSON — degrade to a written answer so the ask isn't lost.
    yield* streamDoc('doc', DOC_SYSTEM, user, signal, images);
    return;
  }
  yield { type: 'card.create', shape: 'affinity' };
  for (let i = 0; i < clusters.length; i++) {
    if (signal.aborted) return;
    yield { type: 'affinity.cluster', index: i, label: clusters[i]!.label };
    await sleep(60, signal);
    for (const note of clusters[i]!.notes) {
      if (signal.aborted) return;
      yield { type: 'affinity.note', cluster: i, text: note };
      await sleep(80, signal);
    }
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Create the doc card up front (the shape is known from the prompt), then
 * generate and stream the body in — so the card appears immediately and fills
 * live rather than popping in complete after a blank wait.
 */
async function* streamDoc(
  shape: AskShape,
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape };
  // Buffer only until the first line resolves (a "# Title" goes to the card's
  // title); everything after streams straight into the body as it arrives.
  // `bodyStarted` swallows the blank line(s) between a stripped title and the
  // body — otherwise the doc card renders an empty band above its content.
  let buf = '';
  let titleResolved = false;
  let bodyStarted = false;
  function* bodyDelta(text: string): Generator<AskEvent> {
    const t = bodyStarted ? text : text.replace(/^\n+/, '');
    if (!t) return;
    bodyStarted = true;
    yield { type: 'card.delta', textDelta: t };
  }
  let searching = false;
  try {
    for await (const ev of generateStream(system, user, signal, images, opts)) {
      if (signal.aborted) return;
      if (ev.type === 'status') {
        searching = true;
        yield { type: 'status', message: ev.message };
        continue;
      }
      if (searching) {
        // Text resumed after a web hop — flip the avatar back to writing.
        searching = false;
        yield { type: 'status', message: 'writing…' };
      }
      const delta = ev.text;
      if (titleResolved) {
        yield* bodyDelta(delta);
        continue;
      }
      buf += delta;
      const nl = buf.indexOf('\n');
      if (nl === -1) continue;
      titleResolved = true;
      const firstLine = buf.slice(0, nl);
      const rest = buf.slice(nl + 1);
      if (firstLine.startsWith('# ')) {
        yield { type: 'card.title', title: firstLine.replace(/^#\s+/, '').slice(0, 80) };
        yield* bodyDelta(rest);
      } else {
        yield* bodyDelta(buf);
      }
      buf = '';
    }
  } catch (error) {
    // Close the opened card before the error reaches index.ts's catch (which
    // emits `error` but knows nothing about cards) — mirrors runtime.ts's
    // closeOpenCard, so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  if (!titleResolved && buf) {
    if (buf.startsWith('# ')) yield { type: 'card.title', title: buf.replace(/^#\s+/, '').slice(0, 80) };
    else yield* bodyDelta(buf);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}
