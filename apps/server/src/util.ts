/**
 * Small shared server utilities. These were copy-pasted (byte-identical) across
 * the generation modules; consolidated here so there's one definition each.
 */

/** Resolve after `ms`, or immediately when `signal` aborts — so a cancelled run
 *  never waits out a pacing delay. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Split text into groups of `size` whitespace-delimited words, keeping the
 *  trailing spaces so the joined chunks reproduce the original exactly. Used to
 *  chunk-stream the sidecar's one-shot output for a live-typing feel. */
export function chunkWords(text: string, size: number): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

/** Tolerant JSON-object parse — strips any ``` fences, then slices from the
 *  first `{` to the last `}` so surrounding prose can't break the parse.
 *  Returns null on anything unparseable. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Tolerant JSON-array parse — the array counterpart to parseJsonObject.
 *  Slices from the first `[` to the last `]`; returns [] on anything
 *  unparseable or non-array. */
export function parseJsonArray(raw: string): unknown[] {
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

/** Render one board card as a compact `[kind: title] — body` line for a
 *  board-summary prompt: the title-qualified label, then the whitespace-
 *  collapsed text clipped to `maxText`. The three board-summarising endpoints
 *  (notice/discover/compose) built this identically; they differ only in the
 *  line prefix they add (an id, or an ordinal), which stays at the call site. */
export function cardLabelBody(
  card: { kind: string; title?: string; text?: string },
  maxText: number,
): string {
  const label = card.title ? `${card.kind}: ${card.title}` : card.kind;
  const body = (card.text || '').replace(/\s+/g, ' ').trim().slice(0, maxText);
  return `[${label}]${body ? ` — ${body}` : ''}`;
}
