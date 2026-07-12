/**
 * Annotate — Stickies mode. The user explicitly asked Jarwiz to drop sticky
 * notes across their board ("TL;DR each link", "review my ideas, add your two
 * cents"). Given the instruction and the candidate cards (id-tagged), decide
 * which cards it applies to and write ONE short sticky note for each. The client
 * places each note next to its target card.
 *
 * Only annotate cards the instruction genuinely covers — "the links" means the
 * link cards, not everything. Empty result is fine (nothing matched).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnnotateNote, AnnotateRequest, NoticeCard } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';

const MAX_CARDS = 24;
const MAX_TEXT_PER_CARD = 1200;
const MAX_NOTES = 16;
const MAX_NOTE_LEN = 170;
const MAX_TOKENS = 1600;
const SIDECAR_TIMEOUT_MS = 120_000;

const SYSTEM = `You are Jarwiz, annotating a collaborator's board with sticky notes because they explicitly asked you to. Given their instruction and the board's cards (each with an id), decide which cards the instruction applies to, and write ONE short sticky note for each — in your own voice, doing exactly what they asked (a TL;DR, a review, your two cents, a flag, a suggestion).

Rules:
- Only annotate the cards the instruction genuinely covers. "the links" → the link cards only; "my ideas" → the idea/note cards only. If it clearly means everything, cover everything relevant.
- One note per card, sticky-sized: ONE crisp sentence (~25 words max, it must fit a small sticky), no headings, no markdown. Punchy and specific to THAT card.
- Ground every note in the card's actual content — never generic.
- If nothing on the board matches, return an empty array.

Return ONLY a JSON array (no prose, no code fences):
[{"cardId": string (exactly one of the given ids), "note": string}]`;

function boardList(cards: NoticeCard[]): string {
  return cards
    .slice(0, MAX_CARDS)
    .map((c) => {
      const label = c.title ? `${c.kind}: ${c.title}` : c.kind;
      const body = (c.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_PER_CARD);
      return `id=${c.id} [${label}]${body ? ` — ${body}` : ''}`;
    })
    .join('\n');
}

async function ask(user: string, signal: AbortSignal): Promise<string> {
  if (hasModelKey()) {
    const client = anthropic();
    const msg = await client.messages.create(
      { model: AGENT_MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: 'user', content: user }] },
      { signal },
    );
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (sidecarAvailable()) {
    return sidecarGenerate({ system: SYSTEM, user, signal, timeoutMs: SIDECAR_TIMEOUT_MS });
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

/** Decide the sticky notes to drop, each pinned to a real card id. Defensive:
 *  drops notes not pinned to a sent card, and one note per card. */
export async function annotateBoard(req: AnnotateRequest, signal: AbortSignal): Promise<AnnotateNote[]> {
  const cards = Array.isArray(req.cards) ? req.cards : [];
  const prompt = (req.prompt ?? '').trim();
  if (cards.length === 0 || !prompt) return [];
  const ids = new Set(cards.map((c) => c.id));
  const user = `Instruction: ${prompt}\n\nBoard cards:\n${boardList(cards)}\n\nReturn the sticky notes as JSON.`;

  let raw: string;
  try {
    raw = await ask(user, signal);
  } catch {
    return [];
  }
  if (signal.aborted) return [];

  const out: AnnotateNote[] = [];
  const used = new Set<string>();
  for (const item of parseArray(raw)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const cardId = String(o.cardId ?? '').trim();
    if (!ids.has(cardId) || used.has(cardId)) continue;
    const note = String(o.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LEN);
    if (!note) continue;
    used.add(cardId);
    out.push({ cardId, note });
    if (out.length >= MAX_NOTES) break;
  }
  return out;
}
