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
import { extractSheetText } from './sheets.js';
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
/** Deep runs chain many searches; the CLI sidecar needs matching headroom. */
const RESEARCH_SIDECAR_TIMEOUT_MS = 300_000;
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

const AFFINITY_SYSTEM = `You run an affinity-mapping exercise: turn the request and the source(s) into clustered sticky notes. Return ONLY a JSON object {"clusters": [{"label": string, "notes": string[]}]}. Make 3–6 clusters; each has a short 1–4 word "label" (the theme) and 2–6 short "notes" (each one idea, a few words). Group related ideas under the same theme. Ground notes in the provided content when a source is given; otherwise brainstorm sensible ideas for the request. No prose, no code fences.`;

const RESEARCH_SYSTEM = `You are running a DEEP RESEARCH pass on something the user put on their canvas — any link or card: a venue or rental listing, a product, a company, a repo or tool, an article or paper, a person, an open question. Your job: autonomously find everything a decision-maker would want to know, far beyond what the subject says about itself.

First decide WHAT the subject is, then work the live web hard on the angles that matter for that kind of subject — for example:
- venue / listing / product → independent reviews across platforms, current prices and availability, recurring complaints, strong alternatives
- company / service → what it actually does, traction and reputation (news, customer and employee voices), competitors
- repo / tool / tech → maturity and activity, what users report in issues and discussions, how it compares to alternatives
- article / paper / claim → who wrote it and their credibility, corroborating AND contradicting sources, what has happened since
- person → who they are, notable work, recent activity, credibility signals
- open question / topic → the current state of things, the strongest sources, where informed people disagree
Fetch the given URL for ground truth when there is one; cross-check what the subject claims about itself against what outsiders say; hunt for red flags (recurring complaints, contradictions, hidden costs, stale/renamed/discontinued).

Then write ONE dossier as clean markdown: a "# " title naming the subject; a one-paragraph verdict up top (what this is and whether it holds up); then tight sections with **bold lead-ins**, chosen to fit the subject — what independent sources actually say (recurring praise AND criticism, with numbers), the facts that matter (prices, ratings, dates, versions), red flags or surprises, and the strongest alternatives or counterpoints if any deserve a look. A small markdown table (| a | b | rows) is welcome where a grid genuinely clarifies (e.g. alternatives side by side); "---" between major sections draws a divider. Be specific and stay compact — a scannable dossier, not an essay. Every externally sourced claim cites its page inline as a markdown link ([source](URL)); end with one "Source: [Title](URL)" line per page used. Never invent a URL or a fact; if an angle came up empty, say so in one honest line. No preamble, no narration of your searching — the card is the finished dossier.`;

/** Steers a doc/list answer to render as an interactive markdown checklist. */
const CHECKLIST_DIRECTIVE =
  '\n\nFormat the actionable items as a markdown task list: every item on its own line beginning with "- [ ] " (an unchecked checkbox), one concrete action each. Use "- [x] " only for items the sources say are already done. An optional "# " title line is fine; otherwise no prose, no intro, no sign-off.';

/** A cross-document conflict/clause-diff request (→ the clause-diff table). */
function looksLikeDiff(prompt: string): boolean {
  return /\b(conflict|contradict|differ|discrepan|clause|reconcile|inconsisten|at odds)\b/i.test(prompt);
}

/** A "draw / visualise this as a diagram" request (→ a Mermaid diagram card). */
function looksLikeDiagram(prompt: string): boolean {
  return /\b(diagram|flow ?chart|sequence diagram|mind ?map|org chart|gantt|class diagram|er diagram|entity[- ]relationship|state diagram|user journey|journey map|process (map|flow)|visuali[sz]e|sketch|draw)\b/i.test(
    prompt,
  );
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

/** An explicit "as written prose / in words" request (→ a doc card). Lets a
 *  refinement of a table/diagram convert back to prose ("as a short write-up"). */
function looksLikeProse(prompt: string): boolean {
  return /\b(prose|in writing|short write[- ]?up|written (summary|explanation|form|prose|account)|as an? (essay|narrative|paragraph)|in paragraphs?)\b/i.test(
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

function pickShape(prompt: string, current?: AskShape): AskShape {
  const p = prompt.toLowerCase();
  // NOTE: brainstorm/affinity prompts no longer route to sticky notes —
  // stickies are the USER's annotation medium, not an AI output (owner
  // decision 2026-07-05). Brainstorms land as lists like any idea dump.
  // The affinity event machinery stays for possible user-driven layouts.
  if (looksLikeDiagram(prompt)) return 'diagram';
  // An explicit "as prose" request wins over the keep-current fallback, so a
  // table/diagram can be turned back into a written card on demand.
  if (looksLikeProse(prompt)) return 'doc';
  if (
    looksLikeDiff(prompt) ||
    /\b(compare|comparison|vs\.?|versus|pros and cons|trade-?offs?|matrix|table|side by side)\b/.test(p)
  ) {
    return 'table';
  }
  // A checklist is a list whose items are task lines; both route to 'list'.
  if (
    wantsChecklist(prompt) ||
    /\b(list|bullets?|enumerate|steps|key (points|dates|terms)|what are the)\b/.test(p)
  ) {
    return 'list';
  }
  // No explicit format named. When refining an existing answer, keep its shape
  // so a tweak ("add a node", "make it shorter") regenerates that same card
  // in place rather than producing a different artefact. Affinity boards are a
  // multi-card layout, not a single refinable card — never keep them here.
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
  framePaths?: string[];
  imageData?: ImageInput[];
}

/** The per-mode generation budget the two generators share. */
function genBudget(opts: GenOpts) {
  return {
    tools: opts.deep ? researchToolset() : opts.web ? webToolset() : undefined,
    maxTokens: opts.deep ? RESEARCH_MAX_TOKENS : MAX_TOKENS,
    maxTurns: opts.deep ? RESEARCH_MAX_CONTINUATIONS : WEB_MAX_CONTINUATIONS,
    sidecarTimeoutMs: opts.deep ? RESEARCH_SIDECAR_TIMEOUT_MS : undefined,
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
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildContent(user, images) },
    ];
    // Server tools may pause a long turn (stop_reason "pause_turn"); resume by
    // replaying the assistant content until the model actually finishes.
    for (let turn = 0; turn <= maxTurns; turn++) {
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          ...(tools ? { tools } : {}),
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
      if (!tools || final.stop_reason !== 'pause_turn') return;
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

export async function* streamAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !sidecarAvailable()) {
    yield* streamDemoAsk(req, signal);
    return;
  }

  yield { type: 'status', message: 'reading the source…' };
  const { context, citable, images, linkRefs, framePaths, imageData } = await gatherContext(req);
  if (signal.aborted) return;

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
    yield* streamDoc('doc', RESEARCH_SYSTEM, user, signal, images, { web: true, deep: true, framePaths, imageData });
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
