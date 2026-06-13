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

import type { Editor, TLShapeId } from 'tldraw';
import { getAgent, type AutopilotEvent, type TableAutopilotEvent } from '@jarwiz/shared';
import { startStreaming, stopStreaming } from './streaming';

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

/* ─── Prose continue (A0) ───────────────────────────────────────────────── */

export async function continueProse(editor: Editor, cardId: TLShapeId): Promise<void> {
  if (controllers.has(cardId)) return; // already filling this card
  const shape = editor.getShape(cardId);
  if (!shape || (shape.type !== 'doc-card' && shape.type !== 'note-card')) return;

  const kind = shape.type === 'note-card' ? 'note' : 'doc';
  const props = shape.props as { text: string; title?: string };
  const baseText = props.text;

  editor.markHistoryStoppingPoint('autopilot'); // whole fill = one undo
  const controller = new AbortController();
  controllers.set(cardId, controller);
  startStreaming(cardId);
  setSession({ cardId, status: 'continuing your draft…', anchor: cardCorner(editor, cardId) });

  let appended = '';
  let joined = false;
  try {
    const res = await fetch('/api/autopilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, text: baseText, title: props.title }),
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
          appended += /^#{1,6}\s/.test(event.textDelta) ? '\n\n' : ' ';
        }
      }
      appended += event.textDelta;
      const current = editor.getShape(cardId);
      if (!current || (current.type !== 'doc-card' && current.type !== 'note-card')) return;
      editor.updateShape({
        id: cardId,
        type: current.type,
        props: { text: baseText + appended },
      } as Parameters<typeof editor.updateShape>[0]);
      setSession({ cardId, status: 'continuing your draft…', anchor: cardCorner(editor, cardId) });
    });
  } catch {
    /* aborted (yield/Esc) or network — nothing to surface */
  } finally {
    if (controllers.get(cardId) === controller) {
      controllers.delete(cardId);
      stopStreaming(cardId);
      clearSession(cardId);
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
  if (!b) return null;
  const colW = b.w / cols;
  const bodyH = b.h - headerH;
  const rowH = bodyH / Math.max(1, totalRows);
  return { x: b.x + (col + 0.5) * colW, y: b.y + headerH + (row + 0.5) * rowH };
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
  setSession({ cardId, status: 'filling the table…', anchor: cardCorner(editor, cardId) });

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
      setSession({
        cardId,
        status: 'filling the table…',
        anchor: cellAnchor(editor, cardId, columns.length, nextRows.length, event.row, event.col, headerH),
      });
    });
  } catch {
    /* aborted or network */
  } finally {
    if (controllers.get(cardId) === controller) {
      controllers.delete(cardId);
      stopStreaming(cardId);
      clearSession(cardId);
    }
  }
}
