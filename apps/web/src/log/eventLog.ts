/**
 * The activity log — a Stitch-style timeline of what happened on the canvas:
 * a PDF added, a question asked, an artefact generated. Each event captures a
 * full editor snapshot, so the user can revert the board to any point (losing
 * later progress — the UI confirms first). Hovering an event highlights the
 * artefact(s) it touched.
 */

import type { Editor, TLEditorSnapshot, TLShapeId } from 'tldraw';

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

let events: LogEvent[] = [];
let hovered: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribeLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getEvents(): LogEvent[] {
  return events;
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
  events = [
    ...events,
    {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      snapshot: editor.getSnapshot(),
      ...event,
    },
  ];
  emit();
}

/** Revert the board to an event's snapshot, dropping everything after it. */
export function revertToEvent(editor: Editor, id: string): void {
  const idx = events.findIndex((e) => e.id === id);
  if (idx < 0) return;
  editor.loadSnapshot(events[idx]!.snapshot);
  events = events.slice(0, idx + 1);
  hovered = null;
  emit();
}
