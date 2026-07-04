/**
 * Autopilot as a set of concurrent background tasks.
 *
 * The whole point of Autopilot is that you kick one off and walk away — start a
 * continuation on this card, then go work another card (or fire Autopilot there
 * too). So a run is NOT tied to the editing component or to a single "active"
 * slot: each card gets its own independent session with its own AbortController,
 * and they run in parallel. A Writer avatar shows at every active card.
 *
 * State lives here (module scope), so a fill keeps streaming even if tldraw
 * unmounts the card's component (off-screen) or the user leaves edit mode.
 *
 * Trust contract (per card): start; type to yield instantly; Esc to stop; one
 * fill = one undo; insert-only.
 */

import type { Editor, TLShapeId, TLRichText } from 'tldraw';
import { getArrowBindings, renderPlaintextFromRichText, type TLArrowShape } from 'tldraw';
import { getAgent, type AutopilotBoardCard, type AutopilotEvent, type TableAutopilotEvent } from '@jarwiz/shared';
import { startStreaming, stopStreaming } from './streaming';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { setClarify } from '../ask/clarify';

export const AUTOPILOT_AGENT = getAgent('writer');

export interface AutopilotSession {
  cardId: TLShapeId;
  status: string;
  /** Page-space point the Writer avatar parks at (card corner, or the live cell). */
  anchor: { x: number; y: number } | null;
}

let sessions: ReadonlyMap<TLShapeId, AutopilotSession> = new Map();
const controllers = new Map<TLShapeId, AbortController>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

function setSession(next: AutopilotSession): void {
  const map = new Map(sessions);
  map.set(next.cardId, next);
  sessions = map;
  notify();
}

function clearSession(cardId: TLShapeId): void {
  if (!sessions.has(cardId)) return;
  const map = new Map(sessions);
  map.delete(cardId);
  sessions = map;
  notify();
}

export function subscribeAutopilot(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAutopilotSnapshot(): ReadonlyMap<TLShapeId, AutopilotSession> {
  return sessions;
}

export function isAutopilotRunning(cardId: TLShapeId): boolean {
  return controllers.has(cardId);
}

/** Yield the pen / stop the fill on one card. Safe to call when not running. */
export function abortAutopilot(cardId: TLShapeId): void {
  controllers.get(cardId)?.abort();
  controllers.delete(cardId);
  stopStreaming(cardId);
  clearSession(cardId);
  endPresence(AUTOPILOT_AGENT.id);
}

function cardCorner(editor: Editor, cardId: TLShapeId): { x: number; y: number } | null {
  const b = editor.getShapePageBounds(cardId);
  return b ? { x: b.maxX + 16, y: b.minY + 22 } : null;
}

/** Read SSE frames from a fetch Response body, calling `onEvent` per `data:` line. */
async function readSSE<T>(body: ReadableStream<Uint8Array>, onEvent: (e: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return;
    try {
      onEvent(JSON.parse(line.slice(6)) as T);
    } catch {
      /* malformed frame */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  handle(buffer);
}

/* ─── Board context gathering ───────────────────────────────────────────── */

/** Rich Jarwiz cards. */
const CARD_TYPES = new Set([
  'doc-card', 'note-card', 'table-card', 'diagram-card',
  'link-card', 'pdf-card', 'youtube-card',
]);
/** Native tldraw primitives that carry text the agent should read (canvas pivot
 *  P1). The card model used to make these invisible — a flowchart you drew gave
 *  the AI nothing. Now geo shapes, free text, sticky notes, labelled connectors,
 *  and frame names all become context. */
const PRIMITIVE_TYPES = new Set(['geo', 'text', 'note', 'arrow', 'frame']);
const CONTEXT_TYPES = new Set([...CARD_TYPES, ...PRIMITIVE_TYPES]);
const MAX_CONTEXT_CARDS = 8;
const MAX_TEXT_CHARS = 450;

/** Flatten a tldraw rich-text doc to plain text; safe on missing/garbage input. */
function plainText(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try {
    return renderPlaintextFromRichText(editor, richText as TLRichText).trim();
  } catch {
    return '';
  }
}

function extractCardText(editor: Editor, shape: ReturnType<Editor['getShape']>): string | null {
  if (!shape) return null;
  const p = shape.props as Record<string, unknown>;
  switch (shape.type) {
    // ── Rich cards ──────────────────────────────────────────────────────
    case 'doc-card':
    case 'note-card':
      return typeof p.text === 'string' ? p.text : null;
    case 'diagram-card':
      return typeof p.code === 'string' ? p.code : null;
    case 'table-card': {
      const cols = Array.isArray(p.columns) ? (p.columns as string[]) : [];
      const rows = Array.isArray(p.rows) ? (p.rows as string[][]) : [];
      const header = cols.join(' | ');
      const body = rows.map((r) => r.join(' | ')).join('\n');
      return header ? `${header}\n${body}` : body;
    }
    case 'link-card': {
      const title = typeof p.title === 'string' ? p.title : '';
      const desc = typeof p.description === 'string' ? p.description : '';
      return [title, desc].filter(Boolean).join('\n') || null;
    }
    case 'pdf-card':
      return typeof p.name === 'string' ? `(PDF: ${p.name})` : '(PDF document)';
    case 'youtube-card':
      return typeof p.title === 'string' ? `(Video: ${p.title})` : '(YouTube video)';
    // ── Native primitives ───────────────────────────────────────────────
    case 'geo':
    case 'text':
    case 'note': {
      const t = plainText(editor, p.richText);
      return t || null; // an unlabelled box/sketch carries no text — skip it
    }
    case 'arrow': {
      // A labelled connector is semantic ("depends on", "blocks"); an unlabelled
      // one is pure structure and is already captured by following the arrow.
      const t = plainText(editor, p.richText);
      return t || null;
    }
    case 'frame':
      return typeof p.name === 'string' && p.name.trim() ? `(Section: ${p.name.trim()})` : null;
    default:
      return null;
  }
}

/** The agent-facing kind label for a shape. */
function kindFor(type: string): string {
  if (type.endsWith('-card')) return type.replace('-card', '');
  if (type === 'geo') return 'shape';
  if (type === 'arrow') return 'connector';
  return type; // 'text' | 'note' | 'frame'
}

function shapeToCard(
  editor: Editor,
  shape: ReturnType<Editor['getShape']>,
  relation: AutopilotBoardCard['relation'],
): AutopilotBoardCard | null {
  if (!shape || !CONTEXT_TYPES.has(shape.type)) return null;
  const text = extractCardText(editor, shape);
  if (text === null) return null;
  const p = shape.props as Record<string, unknown>;
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : undefined;
  return { kind: kindFor(shape.type), title, text: text.slice(0, MAX_TEXT_CHARS), relation };
}

function gatherBoardContext(editor: Editor, cardId: TLShapeId): AutopilotBoardCard[] {
  const seen = new Set<TLShapeId>([cardId]);
  const result: AutopilotBoardCard[] = [];

  const push = (id: TLShapeId, relation: AutopilotBoardCard['relation']) => {
    if (seen.has(id) || result.length >= MAX_CONTEXT_CARDS) return;
    seen.add(id);
    const card = shapeToCard(editor, editor.getShape(id), relation);
    if (card) result.push(card);
  };

  // 1. Connected — shapes on the other end of any connector touching this card
  //    (cards AND primitives — a doc wired to a hand-drawn box is "connected").
  const arrows = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow') as TLArrowShape[];
  for (const arrow of arrows) {
    const b = getArrowBindings(editor, arrow);
    if (b.start?.toId === cardId && b.end?.toId) push(b.end.toId, 'connected');
    if (b.end?.toId === cardId && b.start?.toId) push(b.start.toId, 'connected');
  }

  // 2. Selected — other shapes in the current selection.
  for (const id of editor.getSelectedShapeIds()) push(id, 'selected');

  // 3. Nearby — text-bearing shapes whose centre is within 700px of ours.
  const bounds = editor.getShapePageBounds(cardId);
  if (bounds) {
    const { midX: cx, midY: cy } = bounds;
    const all = editor.getCurrentPageShapes();
    const byDist = all
      .filter((s) => !seen.has(s.id) && CONTEXT_TYPES.has(s.type))
      .map((s) => {
        const b = editor.getShapePageBounds(s.id);
        if (!b) return null;
        const dx = b.midX - cx;
        const dy = b.midY - cy;
        return { id: s.id, dist: Math.sqrt(dx * dx + dy * dy) };
      })
      .filter((x): x is { id: TLShapeId; dist: number } => x !== null && x.dist <= 700)
      .sort((a, b) => a.dist - b.dist);
    for (const { id } of byDist) push(id, 'nearby');
  }

  // 4. Board — remaining text-bearing shapes anywhere on the page.
  for (const s of editor.getCurrentPageShapes()) push(s.id, 'board');

  return result;
}

/* ─── Prose continue (A0) ───────────────────────────────────────────────── */

/**
 * Has the user given the agent enough to continue from with confidence?
 *
 * The bar: a finished thought (ends with .!? or newline AND ≥3 words), a
 * structural unit (heading, bullet, or task line), a non-empty title, or any
 * external grounding (connected/selected/nearby/board cards). Anything below
 * that and the agent would be guessing — so we route those to the clarify
 * picker instead.
 *
 * Exported so the card UI can hide the "Press Tab to continue" nudge until
 * the bar is met — Tab still works (falls back to clarify), but we only
 * volunteer the suggestion when we'd actually have something to continue from.
 */
export function isAutopilotReady(editor: Editor, cardId: TLShapeId): boolean {
  const shape = editor.getShape(cardId);
  if (!shape || (shape.type !== 'doc-card' && shape.type !== 'note-card')) return false;
  const props = shape.props as { text: string; title?: string };
  if (props.title?.trim()) return true;
  const text = props.text;
  const trimmed = text.trim();
  if (trimmed) {
    // Structural unit: heading / bullet / task line — agent can extend the list.
    if (/(^|\n)\s*(#{1,6}\s|[-*]\s)/.test(text)) return true;
    // Finished thought: ends on punctuation or newline AND has at least 3 words.
    const endsClean = /[.!?]\s*$/.test(trimmed) || /\n\s*$/.test(text);
    const wordCount = trimmed.split(/\s+/).length;
    if (endsClean && wordCount >= 3) return true;
  }
  // External grounding — connected/selected/nearby cards give the agent something to draw on.
  return gatherBoardContext(editor, cardId).length > 0;
}

export async function continueProse(editor: Editor, cardId: TLShapeId): Promise<void> {
  if (controllers.has(cardId)) return; // already filling this card
  const shape = editor.getShape(cardId);
  if (!shape || (shape.type !== 'doc-card' && shape.type !== 'note-card')) return;

  const kind = shape.type === 'note-card' ? 'note' : 'doc';
  const props = shape.props as { text: string; title?: string };
  const baseText = props.text;
  const title = props.title;
  const boardContext = gatherBoardContext(editor, cardId);

  // Below the confidence bar — ask what the doc is about instead of guessing.
  if (!isAutopilotReady(editor, cardId)) {
    setClarify({
      question: 'What do you want to write?',
      options: ['Meeting notes', 'Project brief', 'Team update', 'Technical spec'],
      prompt: '',
      sourceIds: [cardId],
      targetId: null,
      onAnswer: (answer) => {
        // Set the answer as the doc title so the model has something to open with.
        if (shape.type === 'doc-card') {
          editor.updateShape({ id: cardId, type: 'doc-card', props: { title: answer } });
        }
        void continueProse(editor, cardId);
      },
    });
    return;
  }

  editor.markHistoryStoppingPoint('autopilot'); // whole fill = one undo
  const controller = new AbortController();
  controllers.set(cardId, controller);
  startStreaming(cardId);
  const anchor = cardCorner(editor, cardId);
  setSession({ cardId, status: 'continuing your draft…', anchor });
  // Park the Writer avatar by the card so the user can see who's writing.
  startPresence(AUTOPILOT_AGENT.id);
  setPresenceStatus(AUTOPILOT_AGENT.id, 'continuing your draft…');
  if (anchor) setPresenceCursor(AUTOPILOT_AGENT.id, anchor.x, anchor.y);

  let appended = '';
  let joined = false;
  // Buffer of characters queued for typing-speed drain
  let typingQueue = '';
  let draining = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Drain one character at a time with a human typing rhythm: long pauses after
  // sentence punctuation, shorter after commas/newlines, brief after whitespace,
  // fastest mid-word. The session anchor is set once at the start of the run —
  // the card's corner doesn't move per character, so we don't re-notify here.
  const drainQueue = async () => {
    if (draining) return;
    draining = true;
    while (typingQueue.length > 0) {
      if (controller.signal.aborted) break;
      const ch = typingQueue.charAt(0);
      typingQueue = typingQueue.slice(1);
      appended += ch;
      const current = editor.getShape(cardId);
      if (current && (current.type === 'doc-card' || current.type === 'note-card')) {
        editor.updateShape({
          id: cardId,
          type: current.type,
          props: { text: baseText + appended },
        } as Parameters<typeof editor.updateShape>[0]);
      }
      const delay = /[.!?]/.test(ch) ? 80 + Math.random() * 60
                  : ch === ',' ? 55 + Math.random() * 30
                  : ch === '\n' ? 70 + Math.random() * 40
                  : /\s/.test(ch) ? 35 + Math.random() * 25
                  : 18 + Math.random() * 20;
      await sleep(delay);
    }
    draining = false;
  };

  try {
    const res = await fetch('/api/autopilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        text: baseText,
        title,
        boardContext: boardContext.length > 0 ? boardContext : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error('autopilot request failed');
    await readSSE<AutopilotEvent>(res.body, (event) => {
      if (event.type !== 'delta') return;
      // Clean join: if the model didn't lead with whitespace and our text
      // doesn't end with it, insert a break (newlines before a markdown heading,
      // else a space) so the continuation doesn't weld onto the last word.
      if (!joined && event.textDelta) {
        joined = true;
        if (baseText && !/\s$/.test(baseText) && !/^\s/.test(event.textDelta)) {
          typingQueue += /^#{1,6}\s/.test(event.textDelta) ? '\n\n' : ' ';
        }
      }
      typingQueue += event.textDelta;
      void drainQueue();
    });
    // Wait for any queued characters to finish typing
    while (typingQueue.length > 0 && !controller.signal.aborted) {
      await sleep(30);
    }
  } catch {
    /* aborted (yield/Esc) or network — nothing to surface */
  } finally {
    if (controllers.get(cardId) === controller) {
      controllers.delete(cardId);
      stopStreaming(cardId);
      clearSession(cardId);
      endPresence(AUTOPILOT_AGENT.id);
    }
  }
}

/* ─── Table cell-fill (A1) ──────────────────────────────────────────────── */

interface TableProps {
  columns: string[];
  rows: string[][];
}

/** Page-space center of one table cell, for the avatar's cell-to-cell hop. */
function cellAnchor(
  editor: Editor,
  cardId: TLShapeId,
  cols: number,
  totalRows: number,
  row: number,
  col: number,
  headerH: number,
): { x: number; y: number } | null {
  const b = editor.getShapePageBounds(cardId);
  if (!b || cols < 1) return null;
  const colW = b.w / cols;
  const bodyH = b.h - headerH;
  const rowH = bodyH / Math.max(1, totalRows);
  // Park at the cell's right edge, not its center, so the avatar doesn't sit on
  // top of the (left-aligned) text it's writing into.
  return { x: b.x + (col + 1) * colW - 10, y: b.y + headerH + (row + 0.5) * rowH };
}

export async function fillTable(
  editor: Editor,
  cardId: TLShapeId,
  headerH = 40,
): Promise<void> {
  if (controllers.has(cardId)) return;
  const shape = editor.getShape(cardId);
  if (!shape || shape.type !== 'table-card') return;

  const props = shape.props as TableProps;
  const columns = [...props.columns];
  const rows = props.rows.map((r) => [...r]);

  editor.markHistoryStoppingPoint('autopilot-table');
  const controller = new AbortController();
  controllers.set(cardId, controller);
  startStreaming(cardId);
  const tableAnchor = cardCorner(editor, cardId);
  setSession({ cardId, status: 'filling the table…', anchor: tableAnchor });
  startPresence(AUTOPILOT_AGENT.id);
  setPresenceStatus(AUTOPILOT_AGENT.id, 'filling the table…');
  if (tableAnchor) setPresenceCursor(AUTOPILOT_AGENT.id, tableAnchor.x, tableAnchor.y);

  try {
    const res = await fetch('/api/autopilot/table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns, rows }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error('table autopilot request failed');
    await readSSE<TableAutopilotEvent>(res.body, (event) => {
      if (event.type !== 'cell') return;
      const current = editor.getShape(cardId);
      if (!current || current.type !== 'table-card') return;
      const cur = current.props as TableProps;
      // Insert-only: never overwrite a non-empty cell the user typed.
      if (cur.rows[event.row]?.[event.col]?.trim()) return;
      const nextRows = cur.rows.map((r) => [...r]);
      const targetRow = nextRows[event.row];
      if (!targetRow) return;
      targetRow[event.col] = event.text;
      editor.updateShape({
        id: cardId,
        type: 'table-card',
        props: { rows: nextRows },
      } as Parameters<typeof editor.updateShape>[0]);
      const cell = cellAnchor(editor, cardId, columns.length, nextRows.length, event.row, event.col, headerH);
      setSession({ cardId, status: 'filling the table…', anchor: cell });
      // Hop the Writer avatar cell-to-cell so the user sees who is filling each one.
      if (cell) setPresenceCursor(AUTOPILOT_AGENT.id, cell.x, cell.y);
    });
  } catch {
    /* aborted or network */
  } finally {
    if (controllers.get(cardId) === controller) {
      controllers.delete(cardId);
      stopStreaming(cardId);
      clearSession(cardId);
      endPresence(AUTOPILOT_AGENT.id);
    }
  }
}
