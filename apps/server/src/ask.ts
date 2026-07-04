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
import { extractAssetPages, extractAssetText } from './assets.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

const MAX_TOKENS = 1400;
const PER_SOURCE_CHARS = 8_000;

const DOC_SYSTEM = `You answer a question about the provided source document(s) on a canvas, as a clear written card. Use clean markdown: an optional short "# " title line, then tight paragraphs (and sub-headings only if it genuinely helps). Ground every claim in the provided content; if the sources don't contain the answer, say so plainly rather than inventing. Be specific and concise — no preamble, no sign-off.`;

const LIST_SYSTEM = `You answer a question about the provided source document(s) as a focused markdown list. Optionally one "# " title line, then "- " bullets (or "1." steps if the question implies order). Each item tight and specific, grounded in the content. If the sources don't support an item, omit it. No preamble.`;

const TABLE_SYSTEM = `You answer a question about the provided source document(s) as a comparison/matrix TABLE. Return ONLY a JSON object {"columns": string[], "rows": string[][]} — the first column names the items/dimensions, one row per item, short cells. Ground cells in the provided content; leave a cell empty rather than inventing. No prose, no markdown, no code fences.`;

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

/** An affinity-mapping / brainstorm request (→ clustered sticky notes). */
function looksLikeAffinity(prompt: string): boolean {
  return /\b(affinity|brainstorm|sticky notes?|cluster|group (the |these )?ideas|ideate|generate ideas|mind ?dump)\b/i.test(
    prompt,
  );
}

/** An "action items / to-dos / next steps" request (→ a checklist inside a card). */
function wantsChecklist(prompt: string): boolean {
  return /\b(action items?|actions?|to-?dos?|task list|checklist|next steps|follow[- ]ups?)\b/i.test(prompt);
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

const SEED_SYSTEM = `You are given the text of a card on a user's canvas (a dropped document, or an answer they are working through). Propose the 3 or 4 most useful NEXT MOVES for this reader — anticipate where they would drill in from here: go deeper on the pivotal claim, challenge the weakest assumption, connect it to a decision, extract what is actionable. Each must be SPECIFIC to this text (name the clause, the metric, the section) — never generic like "Summarize this". Return ONLY a JSON array of objects {"label": string, "prompt": string}: "label" is a 2–4 word button caption; "prompt" is the full question to ask. No prose, no code fences.`;

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
      if (label && prompt) out.push({ label: label.slice(0, 32), prompt: prompt.slice(0, 400) });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

function pickShape(prompt: string, current?: AskShape): AskShape {
  const p = prompt.toLowerCase();
  // Affinity + diagram are explicit visual intents — check them before the
  // text/table fallbacks so "diagram of the table" still draws a diagram.
  if (looksLikeAffinity(prompt)) return 'affinity';
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

/** At most this many images per Ask (keeps the request and token cost bounded). */
const MAX_IMAGES = 4;
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
): Promise<{ context: string; citable: boolean; images: ImageInput[] }> {
  const parts: string[] = [];
  const images: ImageInput[] = [];
  let citable = false;
  let i = 0;
  for (const s of req.sources) {
    i += 1;
    const head = `Source ${i} (${s.kind}${s.title ? `: ${s.title}` : ''}):`;
    if (s.kind === 'image' && s.dataUrl) {
      const img = images.length < MAX_IMAGES ? parseImageDataUrl(s.dataUrl, s.title || `Image ${i}`) : null;
      if (img) {
        images.push(img);
        parts.push(`${head}\n(Image attached — provided as a vision input.)`);
      } else {
        parts.push(`${head}\n(Image could not be read.)`);
      }
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
  return { context: parts.join('\n\n'), citable, images };
}

const CITE_DIRECTIVE =
  '\n\nThe source text is tagged with [p.N] page markers. When a statement draws on a specific page, cite it inline as [p.N] (use the marker from the text). Cite the page where the fact actually appears; do not invent page numbers.';

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

async function generate(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const msg = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: buildContent(user, images) }],
      },
      { signal },
    );
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (sidecarAvailable()) return sidecarGenerate({ system, user: withImageNote(user, images), signal });
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

/**
 * Stream the answer as text deltas. With an API key (the production path) this
 * is genuine token-by-token streaming via the Anthropic SDK, so the canvas fills
 * as the model writes and a long answer never waits on one big call. The CLI
 * sidecar (dev only) can't token-stream, so it generates once and chunks the
 * result to approximate the same feel.
 */
async function* generateStream(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const stream = client.messages.stream(
      {
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: buildContent(user, images) }],
      },
      { signal },
    );
    for await (const event of stream) {
      if (signal.aborted) return;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    return;
  }
  if (sidecarAvailable()) {
    const text = await sidecarGenerate({ system, user: withImageNote(user, images), signal });
    for (const piece of chunk(text)) {
      if (signal.aborted) return;
      yield piece;
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

  yield { type: 'status', message: 'Reading the source…' };
  const { context, citable, images } = await gatherContext(req);
  if (signal.aborted) return;

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

  const shape = pickShape(req.prompt, req.currentShape);
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
    // Cross-document conflict requests get the clause-diff table treatment.
    const tableSystem =
      looksLikeDiff(req.prompt) && req.sources.filter((s) => s.assetId).length >= 2
        ? CLAUSE_DIFF_SYSTEM
        : TABLE_SYSTEM;
    const raw = await generate(tableSystem, user, signal, images);
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
    yield* streamDoc('doc', DOC_SYSTEM, user, signal, images);
    return;
  }

  const base = shape === 'list' ? LIST_SYSTEM : DOC_SYSTEM;
  let system = citable ? base + CITE_DIRECTIVE : base;
  if (wantsChecklist(req.prompt)) system += CHECKLIST_DIRECTIVE;
  yield* streamDoc(shape, system, user, signal, images);
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
    for await (const delta of generateStream(DIAGRAM_SYSTEM, user, signal, images)) {
      if (signal.aborted) return;
      yield { type: 'card.delta', textDelta: delta };
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
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape };
  // Buffer only until the first line resolves (a "# Title" goes to the card's
  // title); everything after streams straight into the body as it arrives.
  let buf = '';
  let titleResolved = false;
  try {
    for await (const delta of generateStream(system, user, signal, images)) {
      if (signal.aborted) return;
      if (titleResolved) {
        yield { type: 'card.delta', textDelta: delta };
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
        if (rest) yield { type: 'card.delta', textDelta: rest };
      } else {
        yield { type: 'card.delta', textDelta: buf };
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
    else yield { type: 'card.delta', textDelta: buf };
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}
