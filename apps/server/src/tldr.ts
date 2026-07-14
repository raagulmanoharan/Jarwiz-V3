/**
 * TL;DR — the one-glance gist that sits ON a dropped card (link, video, PDF,
 * spreadsheet), below its preview. A drop kicks this off automatically so the
 * card fills in its own summary while you keep working; the "Summarize" agent
 * still exists for the fuller, connected companion card (they're distinct
 * roles — this is the teaser, that's the essay).
 *
 * Cheap and fast on purpose: a single claude-haiku-4-5 turn (mirroring the link
 * preview's Haiku cleanup), sidecar fallback when there's no key, over text the
 * card already carries — page text / transcript for links & video, and a
 * server-side extraction for PDFs & sheets (the exact source Ask grounds on).
 * Best-effort throughout: no readable text, no key, or an API error all resolve
 * to an empty string, and the card simply shows no strip rather than a lie.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, hasModelKey } from './model.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { extractAssetText } from './assets.js';
import { extractSheetText } from './sheets.js';

/** Fast + cheap — a TL;DR is a teaser, not an essay (same model the link
 *  preview uses to tidy scraped metadata). */
const TLDR_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 200;
/** Enough source to summarize honestly without paying for a whole document. */
const MAX_INPUT_CHARS = 8_000;
const SIDECAR_TIMEOUT_MS = 30_000;
/** A TL;DR longer than this stopped being a TL;DR — hard-trim the output. */
const MAX_TLDR_CHARS = 320;

export type TldrKind = 'link' | 'youtube' | 'pdf' | 'sheet';

export interface TldrInput {
  kind: TldrKind;
  /** Title (link/video/file name) — light context for the summary. */
  title?: string;
  /** Readable content the card already holds (link page text, video transcript). */
  text?: string;
  /** Server asset id — PDFs & sheets extract their text here on demand. */
  assetId?: string;
}

/**
 * Frozen system prompt — a static string so the cache_control breakpoint hits
 * across runs. The bar is "what is this, in one breath": specific, honest, and
 * short enough to read at a glance without opening the source.
 */
const SYSTEM = `You write the TL;DR that sits on a card the user just dropped onto their canvas — a link, a video, a PDF, or a spreadsheet. One glance should tell them what it is and whether it's worth opening.

Rules:
- ONE or TWO sentences. A tight teaser, never a full summary — under 55 words.
- Lead with the substance: what it actually says, offers, or contains — not "This is an article about…". Name the specific thing (the claim, the product, the dataset, the topic).
- Plain, calm, first-person-free. No hype, no "In this video…", no restating the title verbatim.
- Summarize ONLY the provided text. Never invent facts, numbers, or claims. If the text is too thin to say anything real, reply with an empty response.
- Output the TL;DR text ONLY — no preamble, no quotes, no markdown, no "TL;DR:" label.`;

/** Pull the summarizable text for this card: what it already carries, else a
 *  server-side extraction for the file kinds that keep bytes in the blob store. */
async function resolveText(input: TldrInput): Promise<string> {
  const inline = input.text?.trim();
  if (inline) return inline.slice(0, MAX_INPUT_CHARS);
  if (input.assetId) {
    if (input.kind === 'sheet') {
      const csv = await extractSheetText(input.assetId, MAX_INPUT_CHARS);
      return csv?.trim() ?? '';
    }
    const extracted = await extractAssetText(input.assetId, MAX_INPUT_CHARS);
    return extracted?.text.trim() ?? '';
  }
  return '';
}

function buildUserTurn(input: TldrInput, text: string): string {
  const label =
    input.kind === 'youtube'
      ? 'video'
      : input.kind === 'pdf'
        ? 'PDF document'
        : input.kind === 'sheet'
          ? 'spreadsheet'
          : 'web page';
  const parts = [`Write the TL;DR for this ${label}.`, ''];
  if (input.title?.trim()) parts.push(`Title: ${input.title.trim().slice(0, 300)}`, '');
  parts.push('Content:', '"""', text, '"""');
  return parts.join('\n');
}

/** Collapse whitespace, strip a stray "TL;DR:" the model may prepend, and cap. */
function clean(raw: string): string {
  return raw
    .replace(/^\s*tl;?dr[:\-\s]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TLDR_CHARS);
}

/**
 * Generate a card's TL;DR. Returns an empty string when nothing readable was
 * available or no model could run — the caller treats that as "no strip".
 */
export async function generateTldr(input: TldrInput, signal: AbortSignal): Promise<string> {
  const text = await resolveText(input);
  if (!text) return '';
  const user = buildUserTurn(input, text);

  if (hasModelKey()) {
    const msg = await anthropic().messages.create(
      { model: TLDR_MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: 'user', content: user }] },
      { signal },
    );
    const out = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return clean(out);
  }
  if (sidecarAvailable()) {
    const out = await sidecarGenerate({ system: SYSTEM, user, signal, timeoutMs: SIDECAR_TIMEOUT_MS });
    return clean(out);
  }
  return '';
}
