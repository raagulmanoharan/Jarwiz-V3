/**
 * The activity timeline — a Stitch-style log of canvas events (PDF added,
 * artefact generated). Hovering an event highlights the artefact(s) it touched;
 * clicking offers to revert the board to that point (which loses later
 * progress, so it asks to confirm first).
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Box, useEditor, useValue } from 'tldraw';
import {
  getEvents,
  getHoveredEvent,
  revertToEvent,
  setHoveredEvent,
  subscribeLog,
  type LogEvent,
} from './eventLog';

export function Timeline() {
  const editor = useEditor();
  const events = useSyncExternalStore(subscribeLog, getEvents, getEvents);
  const hovered = useSyncExternalStore(subscribeLog, getHoveredEvent, getHoveredEvent);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Viewport boxes for the hovered event's surviving shapes (follows pan/zoom).
  const highlight = useValue(
    'jarwiz timeline highlight',
    () => {
      const ev = events.find((e) => e.id === hovered);
      if (!ev) return [];
      return ev.shapeIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b))
        .map((b) => {
          const tl = editor.pageToViewport({ x: b.minX, y: b.minY });
          const br = editor.pageToViewport({ x: b.maxX, y: b.maxY });
          return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
        });
    },
    [editor, events, hovered],
  );

  if (events.length === 0) return null;

  return (
    <>
      {highlight.map((b, i) => (
        <div
          key={i}
          className="jz-tl-highlight"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h } as CSSProperties}
        />
      ))}

      <div className="jz-timeline">
        <div className="jz-tl-title">Activity</div>
        <div className="jz-tl-list">
          {[...events].reverse().map((ev) => (
            <TimelineItem
              key={ev.id}
              ev={ev}
              confirming={confirmId === ev.id}
              onHover={(on) => setHoveredEvent(on ? ev.id : null)}
              onClick={() => setConfirmId(ev.id)}
              onCancel={() => setConfirmId(null)}
              onConfirm={() => {
                revertToEvent(editor, ev.id);
                setConfirmId(null);
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function TimelineItem({
  ev,
  confirming,
  onHover,
  onClick,
  onCancel,
  onConfirm,
}: {
  ev: LogEvent;
  confirming: boolean;
  onHover: (on: boolean) => void;
  onClick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="jz-tl-item"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className={`jz-tl-dot jz-tl-${ev.kind}`} aria-hidden>
        {ev.kind === 'pdf' ? '◧' : '✦'}
      </span>
      <div className="jz-tl-body">
        <div className="jz-tl-label" title={ev.label}>
          {ev.label}
        </div>
        {ev.detail ? <div className="jz-tl-detail">{ev.detail}</div> : null}
        {confirming ? (
          <div className="jz-tl-confirm">
            <span>Revert here? Later changes are lost.</span>
            <div className="jz-tl-confirm-row">
              <button className="jz-tl-cancel" onClick={onCancel}>
                Cancel
              </button>
              <button className="jz-tl-revert" onClick={onConfirm}>
                Revert
              </button>
            </div>
          </div>
        ) : (
          <button className="jz-tl-revert-link" onClick={onClick}>
            Revert to here
          </button>
        )}
      </div>
    </div>
  );
}
