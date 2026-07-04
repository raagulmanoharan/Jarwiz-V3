/**
 * Cross-board content search (ROADMAP §10 #7) — the side panel's board filter
 * matches board TITLES instantly and board CONTENTS asynchronously. Contents
 * are read straight from each board's local database (boardDb.ts), so no
 * board has to be mounted to be searchable. Extraction is keyed to the text-
 * bearing props of our card shapes (plus tldraw's rich-text primitives) —
 * a blind walk over all string props would index colors, statuses, and
 * data-URLs.
 */

import { DB_PREFIX, existingDbNames, readBoardRecords } from './boardDb';
import { boardPersistenceKey, type Board } from './boardStore';

/** Snippet radius (chars either side of the match). */
const CONTEXT = 34;

type AnyRecord = { id: string } & Record<string, unknown>;

/** Pull the text a human would consider "on the card" out of one record. */
function recordText(record: AnyRecord): string {
  if (record.typeName !== 'shape') return '';
  const props = record.props as Record<string, unknown> | undefined;
  if (!props) return '';
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v);
  };
  // Card shapes: the fields users type into (or read), nothing mechanical.
  push(props.text);
  push(props.title);
  push(props.name); // pdf filename / frame name
  push(props.code); // diagram source
  push(props.description); // link card
  push(props.url); // link card
  if (Array.isArray(props.columns)) (props.columns as unknown[]).forEach(push);
  if (Array.isArray(props.rows)) {
    (props.rows as unknown[][]).forEach((row) => Array.isArray(row) && row.forEach(push));
  }
  // Native primitives (text / geo labels / sticky notes / arrow labels) hold a
  // TipTap rich-text doc — walk it for text leaves.
  if (props.richText && typeof props.richText === 'object') {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text') push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(props.richText);
  }
  return parts.join('\n');
}

function snippetAround(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(text.length, index + matchLen + CONTEXT);
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${clean(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

/**
 * Which boards contain `query` in their content, with a one-line snippet per
 * hit. Reads every board's database sequentially — fine at side-panel scale
 * (the roadmap's "painful at 10 boards" is exactly 10 small reads).
 */
export async function searchBoardContents(
  query: string,
  boards: Board[],
): Promise<Map<string, string>> {
  const q = query.trim().toLowerCase();
  const hits = new Map<string, string>();
  if (q.length < 2) return hits;
  const present = await existingDbNames();
  for (const board of boards) {
    try {
      const records = await readBoardRecords(DB_PREFIX + boardPersistenceKey(board.id), present);
      if (records.length === 0) continue;
      const text = records.map(recordText).filter(Boolean).join('\n');
      const idx = text.toLowerCase().indexOf(q);
      if (idx >= 0) hits.set(board.id, snippetAround(text, idx, q.length));
    } catch {
      /* unreadable board database — skip it rather than break the filter */
    }
  }
  return hits;
}
