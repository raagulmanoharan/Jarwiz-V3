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
import type { AskEvent, AskRequest, AskShape } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { extractAssetPages, extractAssetText } from './assets.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

const MAX_TOKENS = 1400;
const PER_SOURCE_CHARS = 8_000;

const DOC_SYSTEM = `You answer a question about the provided source document(s) on a canvas, as a clear written card. Use clean markdown: an optional short "# " title line, then tight paragraphs (and sub-headings only if it genuinely helps). Ground every claim in the provided content; if the sources don't contain the answer, say so plainly rather than inventing. Be specific and concise — no preamble, no sign-off.`;

const LIST_SYSTEM = `You answer a question about the provided source document(s) as a focused markdown list. Optionally one "# " title line, then "- " bullets (or "1." steps if the question implies order). Each item tight and specific, grounded in the content. If the sources don't support an item, omit it. No preamble.`;

const TABLE_SYSTEM = `You answer a question about the provided source document(s) as a comparison/matrix TABLE. Return ONLY a JSON object {"columns": string[], "rows": string[][]} — the first column names the items/dimensions, one row per item, short cells. Ground cells in the provided content; leave a cell empty rather than inventing. No prose, no markdown, no code fences.`;

const CLAUSE_DIFF_SYSTEM = `You are comparing multiple source documents clause-by-clause to surface overlaps and CONFLICTS. Return ONLY a JSON object {"columns": string[], "rows": string[][]}. Columns MUST be: "Topic / Clause", then one column per source document (use a short version of each document's title), then a final "Conflict?" column. Each row is a topic the documents both address; fill each document's cell with its stance/wording (short, grounded), and set "Conflict?" to "Yes", "No", or "Partial" with a few words on why. Prioritise rows where the documents differ or contradict. Ground every cell in the provided text; leave a cell blank if a document is silent. No prose, no code fences.`;

/** A cross-document conflict/clause-diff request (→ the clause-diff table). */
function looksLikeDiff(prompt: string): boolean {
  return /\b(conflict|contradict|differ|discrepan|clause|reconcile|inconsisten|at odds)\b/i.test(prompt);
}

const SEED_SYSTEM = `You are given the text of a document a user just dropped on a canvas. Propose the 3 or 4 most useful, SPECIFIC questions this reader would want answered about THIS document — the kind that defeat the blank-slate "what do I even ask?" problem. Return ONLY a JSON array of objects {"label": string, "prompt": string}: "label" is a 2–4 word button caption; "prompt" is the full question to ask. Be concrete to this document's actual content (name the clause, the metric, the section) — never generic like "Summarize this". No prose, no code fences.`;

export interface SeedPrompt {
  label: string;
  prompt: string;
}

/** Predefined, content-aware Ask prompts for a freshly dropped PDF. */
export async function proposeSeedPrompts(assetId: string, signal: AbortSignal): Promise<SeedPrompt[]> {
  const extracted = await extractAssetText(assetId, 8_000);
  if (!extracted?.text) return [];
  let raw: string;
  try {
    raw = await generate(SEED_SYSTEM, `Document text:\n"""\n${extracted.text}\n"""`, signal);
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

function pickShape(prompt: string): AskShape {
  const p = prompt.toLowerCase();
  if (
    looksLikeDiff(prompt) ||
    /\b(compare|comparison|vs\.?|versus|pros and cons|trade-?offs?|matrix|table|side by side)\b/.test(p)
  ) {
    return 'table';
  }
  if (/\b(list|bullets?|enumerate|steps|checklist|key (points|dates|terms)|what are the)\b/.test(p)) {
    return 'list';
  }
  return 'doc';
}

async function gatherContext(req: AskRequest): Promise<{ context: string; citable: boolean }> {
  const parts: string[] = [];
  let citable = false;
  let i = 0;
  for (const s of req.sources) {
    i += 1;
    const head = `Source ${i} (${s.kind}${s.title ? `: ${s.title}` : ''}):`;
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
  return { context: parts.join('\n\n'), citable };
}

const CITE_DIRECTIVE =
  '\n\nThe source text is tagged with [p.N] page markers. When a statement draws on a specific page, cite it inline as [p.N] (use the marker from the text). Cite the page where the fact actually appears; do not invent page numbers.';

async function generate(system: string, user: string, signal: AbortSignal): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const msg = await client.messages.create(
      { model: AGENT_MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: user }] },
      { signal },
    );
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (sidecarAvailable()) return sidecarGenerate({ system, user, signal });
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

export async function* streamAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: 'Reading the source…' };
  const { context, citable } = await gatherContext(req);
  if (signal.aborted) return;

  const shape = pickShape(req.prompt);
  const user = `Question:\n${req.prompt}\n\n${context}`;

  if (shape === 'table') {
    // Cross-document conflict requests get the clause-diff table treatment.
    const tableSystem =
      looksLikeDiff(req.prompt) && req.sources.filter((s) => s.assetId).length >= 2
        ? CLAUSE_DIFF_SYSTEM
        : TABLE_SYSTEM;
    const raw = await generate(tableSystem, user, signal);
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
      yield { type: 'card.create', shape: 'table', columns, rows };
      yield { type: 'done' };
      return;
    }
    // Not clean JSON — degrade to a written answer.
    const text = await generate(DOC_SYSTEM, user, signal);
    yield* streamText('doc', text, signal);
    return;
  }

  const base = shape === 'list' ? LIST_SYSTEM : DOC_SYSTEM;
  const system = citable ? base + CITE_DIRECTIVE : base;
  const text = await generate(system, user, signal);
  if (signal.aborted) return;
  yield* streamText(shape, text, signal);
}

/** Emit a text answer as create → deltas → done, pulling an optional title. */
async function* streamText(shape: AskShape, text: string, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const lines = text.split('\n');
  let title: string | undefined;
  let body = text;
  if (lines[0]?.startsWith('# ')) {
    title = lines[0].replace(/^#\s+/, '').slice(0, 80);
    body = lines.slice(1).join('\n').trim();
  }
  yield { type: 'card.create', shape, title };
  for (const piece of chunk(body)) {
    if (signal.aborted) return;
    yield { type: 'card.delta', textDelta: piece };
    await sleep(20, signal);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}
