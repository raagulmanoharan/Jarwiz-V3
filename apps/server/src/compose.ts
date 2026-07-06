/**
 * Compose — the board fan-out. Instead of answering with one monolithic card,
 * read the board (a brief, or a few dropped things) and build it OUT into a
 * rich spatial set: a comparison table, sticky-note tips, plan/day docs, a
 * budget. Two phases: PLAN the set (one JSON call), then GENERATE each card by
 * reusing the Ask engine (streamAsk) — so every card inherits the same quality
 * and formatting as a hand-typed ask. Events stream with the slot they belong
 * to; the client lays the cards out masonry-style as they arrive.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzeCard, AskShape, ComposeEvent, ComposePlanCard, ComposeRequest } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { streamAsk } from './ask.js';

const MAX_BOARD_CARDS = 24;
const MAX_TEXT_PER_CARD = 700;
const MIN_CARDS = 4;
const MAX_CARDS = 6;
const PLAN_TOKENS = 1200;
const SIDECAR_TIMEOUT_MS = 90_000;

const SHAPES: AskShape[] = ['doc', 'list', 'table', 'diagram', 'prototype'];

const PLAN_SYSTEM = `You are Jarwiz, turning a collaborator's board into a rich, spatial working set of cards — the way a sharp teammate builds out their thinking on a whiteboard. Read what's on the board and design ${MIN_CARDS}–${MAX_CARDS} cards that together move the work forward.

VARY the shapes to fit the content — this is the whole point, don't make everything a doc:
- "table" — a comparison, matrix, or budget (rows × columns). Great for options with attributes, or costs.
- "list" — steps, a checklist, an ordered plan, or a ranked set of picks/tips/recommendations.
- "doc" — a written plan, brief, or explainer.
- "diagram" — a flow, process, sequence, hierarchy, or relationship rendered as boxes-and-arrows (Mermaid). Reach for it when the content is inherently about structure or flow — a user journey, a system/architecture map, an org chart, a decision tree, a timeline — where a picture reads faster than prose. Use at most one diagram in the set; only when it genuinely fits.
- "prototype" — a live, rendered prototype of a user interface (a screen, landing page, dashboard, form, or component) as self-contained HTML. Reach for it ONLY when the board is genuinely about designing or specifying a product/UI and seeing it drawn would move the work forward. Use at most one, and never for content that isn't about an interface.

These are Jarwiz's artefacts. Do NOT produce sticky notes — sticky notes are the USER's own annotation medium, never something you author. A set of tips, ideas, options, or review points belongs in a "list" or "table", not stickies.

Each card must be genuinely useful and DISTINCT — no two cover the same ground, no filler. Keep every card CONCISE and scannable — it's one card on a board, not a full essay; favour tight lists and compact tables over long prose so cards stay short. Design the SET like a real board: e.g. for a trip — a stays comparison table, a day-by-day plan doc, top picks as a list, a budget table. Ground every card in the actual board content and subject.

Return ONLY a JSON array (no prose, no code fences) of ${MIN_CARDS}–${MAX_CARDS} objects, in the order they should be laid out:
{"type": "doc"|"list"|"table", "title": string (short, 2–5 words), "prompt": string (a COMPLETE, self-contained instruction you will run to generate THIS card — specific, names the board's subject, says what the card should contain)}`;

function boardSummary(cards: AnalyzeCard[]): string {
  return cards
    .slice(0, MAX_BOARD_CARDS)
    .map((c, i) => {
      const label = c.title ? `${c.kind}: ${c.title}` : c.kind;
      const body = (c.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_PER_CARD);
      return `${i + 1}. [${label}]${body ? ` — ${body}` : ''}`;
    })
    .join('\n');
}

async function planText(user: string, signal: AbortSignal): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const msg = await client.messages.create(
      { model: AGENT_MODEL, max_tokens: PLAN_TOKENS, system: PLAN_SYSTEM, messages: [{ role: 'user', content: user }] },
      { signal },
    );
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (sidecarAvailable()) {
    return sidecarGenerate({ system: PLAN_SYSTEM, user, signal, timeoutMs: SIDECAR_TIMEOUT_MS });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

function parseArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Plan the set of cards to build. Defensive: validates types, caps count. */
async function planBoard(board: AnalyzeCard[], intent: string | undefined, signal: AbortSignal): Promise<Array<ComposePlanCard & { prompt: string }>> {
  const summary = boardSummary(board);
  const steer = intent?.trim() ? `The user wants: ${intent.trim()}\n\n` : '';
  const user = `${steer}The board so far:\n${summary || '(empty)'}\n\nDesign the set of cards to build out this board, grounded in its subject.`;
  const raw = await planText(user, signal);
  const out: Array<ComposePlanCard & { prompt: string }> = [];
  for (const item of parseArray(raw)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const type = SHAPES.includes(o.type as AskShape) ? (o.type as AskShape) : 'doc';
    const title = String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const prompt = String(o.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!prompt) continue;
    out.push({ slot: out.length, type, title: title || 'Card', prompt });
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

/**
 * Stream a board fan-out: plan the set, then generate each card via the Ask
 * engine, forwarding its events tagged with the slot. One card generates at a
 * time (ordered) so the client can lay them out masonry-style deterministically.
 */
export async function* streamCompose(req: ComposeRequest, signal: AbortSignal): AsyncGenerator<ComposeEvent> {
  const board = Array.isArray(req.board) ? req.board : [];
  let plan: Array<ComposePlanCard & { prompt: string }>;
  try {
    plan = await planBoard(board, req.intent, signal);
  } catch (error) {
    yield { type: 'error', message: error instanceof Error ? error.message : 'Planning failed' };
    return;
  }
  if (signal.aborted) return;
  if (plan.length === 0) {
    yield { type: 'error', message: 'Could not plan a board from this content.' };
    return;
  }

  yield { type: 'plan', cards: plan.map((p) => ({ slot: p.slot, type: p.type, title: p.title })) };

  const summary = boardSummary(board);
  const source = summary ? [{ kind: 'doc' as const, title: 'The board so far', text: summary }] : [];

  for (const p of plan) {
    if (signal.aborted) return;
    // Each card runs through the same Ask engine as a typed question — but on
    // the normal budget (noResearch) so a 6-card build stays snappy.
    const askReq = { prompt: p.prompt, sources: source, shape: p.type, skipClarify: true, noResearch: true };
    try {
      for await (const ev of streamAsk(askReq, signal)) {
        if (ev.type === 'done' || ev.type === 'clarify') continue; // one final done; never clarify here
        yield { type: 'slot', slot: p.slot, event: ev };
      }
    } catch {
      // A single card failing shouldn't abort the whole build — skip it.
      continue;
    }
  }
  yield { type: 'done' };
}
