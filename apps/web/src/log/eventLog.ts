/**
 * The activity log — a Stitch-style timeline of what happened on the canvas:
 * a PDF added, a question asked, an artefact generated. Each event captures a
 * full editor snapshot, so the user can revert the board to any point (losing
 * later progress — the UI confirms first). Hovering an event highlights the
 * artefact(s) it touched.
 *
 * Events are keyed by the active board (multi-board): each board sees only its
 * own history, so a revert can never load one board's snapshot into another.
 * Snapshots are heavy, so each board retains at most MAX_EVENTS (oldest are
 * dropped) to keep a long session's memory bounded.
 */

import type { Editor, TLEditorSnapshot, TLShapeId } from 'tldraw';
import { getActiveBoardId, subscribeBoards } from '../boards/boardStore';

export type LogKind = 'pdf' | 'artefact';

export interface LogEvent {
  id: string;
  kind: LogKind;
  label: string;
  detail?: string;
  ts: number;
  shapeIds: TLShapeId[];
  snapshot: TLEditorSnapshot;
}

/** Per-board cap on retained events (each holds a full editor snapshot). */
const MAX_EVENTS = 20;

const eventsByBoard = new Map<string, LogEvent[]>();
const EMPTY: LogEvent[] = [];
let hovered: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

// When the active board changes, the visible log changes with it — drop any
// hover highlight (it referenced the old board's shapes) and re-notify so
// Timeline re-reads the new board's events.
let lastBoardId = getActiveBoardId();
subscribeBoards(() => {
  const id = getActiveBoardId();
  if (id === lastBoardId) return;
  lastBoardId = id;
  hovered = null;
  emit();
});

export function subscribeLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The active board's events (empty for a board with no history yet). */
export function getEvents(): LogEvent[] {
  return eventsByBoard.get(getActiveBoardId()) ?? EMPTY;
}

export function getHoveredEvent(): string | null {
  return hovered;
}

export function setHoveredEvent(id: string | null): void {
  if (hovered === id) return;
  hovered = id;
  emit();
}

/** Record an event, capturing the board state right after it happened. */
export function logEvent(
  editor: Editor,
  event: { kind: LogKind; label: string; detail?: string; shapeIds: TLShapeId[] },
): void {
  const boardId = getActiveBoardId();
  const next = [
    ...(eventsByBoard.get(boardId) ?? EMPTY),
    {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      snapshot: editor.getSnapshot(),
      ...event,
    },
  ];
  eventsByBoard.set(boardId, next.slice(-MAX_EVENTS));
  emit();
}

/** Revert the board to an event's snapshot, dropping everything after it. */
export function revertToEvent(editor: Editor, id: string): void {
  const boardId = getActiveBoardId();
  const events = eventsByBoard.get(boardId) ?? EMPTY;
  const idx = events.findIndex((e) => e.id === id);
  if (idx < 0) return;
  editor.loadSnapshot(events[idx]!.snapshot);
  eventsByBoard.set(boardId, events.slice(0, idx + 1));
  hovered = null;
  emit();
}
