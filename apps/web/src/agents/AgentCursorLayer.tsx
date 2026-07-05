/**
 * Jarwiz presence — one avatar, one identity, alive on the board. Like a
 * collaborator's cursor on a FigJam board, Jarwiz is always somewhere: idly
 * roaming the viewport and pausing to look at cards when nothing is
 * happening, flying to a freshly dropped link/PDF/image and sweeping it
 * line-by-line ("reading…") while it processes, and following the agent-run
 * choreography (Ask/Analyze/Autopilot/Cluster/Diagram write the presence
 * store, which takes absolute priority) whenever a run is in flight.
 *
 * Motion is scripted, not CSS-transitioned: a rAF brain drives a Follower
 * (cursorMotion.ts) through human arcs — curved paths, overshoot-and-settle,
 * distance-proportional pace, a faint tremor at rest. Position lives in page
 * space and converts to viewport per frame, so it pans/zooms with the board.
 * Under prefers-reduced-motion the entity keeps today's calm behaviour:
 * no roaming, instant parks, visible only while working.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useEditor } from 'tldraw';
import { JARWIZ } from '@jarwiz/shared';
import { Follower, scanWaypoints, tremor, type Vec } from './cursorMotion';
import { readingQuips, takeIngested, type IngestedCard } from './jarwizLife';
import { getPresenceSnapshot } from './presence';

/** How long a look at an already-processed card lasts (images, and the tail
 *  end of a read after processing resolves). Long enough that the first quip
 *  always gets its moment, even when processing is instant. */
const MIN_READ_MS = 2800;
/** Give up waiting on a stuck upload/preview — presence must stay honest. */
const MAX_READ_MS = 25_000;
/** Idle dwell between wander hops. */
const DWELL_MS: [number, number] = [2600, 7200];
/** How long each reading quip stays up before the next one lands. */
const QUIP_MS: [number, number] = [1900, 2700];

type Mode = 'wander-idle' | 'wander-move' | 'read-seek' | 'read-scan' | 'run';

interface Reading extends IngestedCard {
  /** Earliest finish — even an instant card gets a beat of attention. */
  minUntil: number;
  /** Latest finish — a stuck pipeline doesn't trap the entity forever. */
  capUntil: number;
  /** The muttering script — 'reading…' first, then shuffled quips. */
  quips: string[];
  quipIdx: number;
  nextQuipAt: number;
}

interface Brain {
  mode: Mode;
  reading: Reading | null;
  scanQueue: Vec[];
  dwellUntil: number;
  nextDriftAt: number;
  lastVisited: string | null;
}

export function AgentCursorLayer() {
  return <JarwizEntity />;
}

function JarwizEntity() {
  const editor = useEditor();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Rare React state — only label/visibility changes re-render; position is
  // written imperatively every frame.
  const [status, setStatus] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const vp = editor.getViewportPageBounds();
    const follower = new Follower({ x: vp.midX + vp.w * 0.18, y: vp.midY - vp.h * 0.1 });
    const brain: Brain = {
      mode: 'wander-idle',
      reading: null,
      scanQueue: [],
      dwellUntil: performance.now() + 1800,
      nextDriftAt: 0,
      lastVisited: null,
    };
    let shownStatus: string | null = null;
    let shownVisible = false;
    let raf = 0;

    const show = (nextVisible: boolean, nextStatus: string | null) => {
      if (nextVisible !== shownVisible) {
        shownVisible = nextVisible;
        setVisible(nextVisible);
      }
      if (nextStatus !== shownStatus) {
        shownStatus = nextStatus;
        setStatus(nextStatus);
      }
    };

    /** Card-corner park point — same spot the ask choreography uses. */
    const parkPoint = (b: { maxX: number; maxY: number }): Vec => ({ x: b.maxX - 14, y: b.maxY - 16 });

    const pickWanderTarget = (): Vec => {
      const view = editor.getViewportPageBounds();
      const candidates: Array<{ id: string; b: { maxX: number; maxY: number } }> = [];
      for (const s of editor.getCurrentPageShapes()) {
        if (s.id === brain.lastVisited) continue;
        const b = editor.getShapePageBounds(s.id);
        if (b && b.midX > view.minX && b.midX < view.maxX && b.midY > view.minY && b.midY < view.maxY) {
          candidates.push({ id: s.id, b });
        }
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      if (pick && Math.random() < 0.65) {
        brain.lastVisited = pick.id;
        return parkPoint(pick.b);
      }
      brain.lastVisited = null;
      const padX = view.w * 0.14;
      const padY = view.h * 0.16;
      return {
        x: view.minX + padX + Math.random() * (view.w - padX * 2),
        y: view.minY + padY + Math.random() * (view.h - padY * 2),
      };
    };

    /** Is the dropped card's own processing finished? */
    const processingDone = (reading: Reading): boolean => {
      const shape = editor.getShape(reading.id);
      if (!shape) return true;
      const props = shape.props as { loading?: boolean; status?: string };
      if (reading.kind === 'link') return props.loading === false;
      if (reading.kind === 'pdf') return props.status !== 'uploading';
      return true; // images are complete on creation
    };

    const finishReading = (now: number) => {
      brain.reading = null;
      brain.scanQueue = [];
      brain.mode = 'wander-idle';
      brain.dwellUntil = now + 900;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const zoom = editor.getZoomLevel();
      const reduce = reduceMotion.matches;

      // 1) A live agent run owns the avatar outright.
      const run = Object.values(getPresenceSnapshot()).find((p) => p?.active);
      if (run) {
        brain.mode = 'run';
        brain.reading = null;
        brain.scanQueue = [];
        if (run.cursor) {
          if (reduce) follower.jumpTo(run.cursor);
          else follower.moveTo(run.cursor, now, { zoom, speed: 1.15 });
        }
        show(true, run.status);
      } else {
        if (brain.mode === 'run') finishReading(now);

        // 2) Fresh ingestion? Fly over and read while it processes.
        if (!brain.reading) {
          let next = takeIngested();
          while (next && !editor.getShape(next.id)) next = takeIngested();
          if (next) {
            brain.reading = {
              ...next,
              minUntil: now + MIN_READ_MS,
              capUntil: now + MAX_READ_MS,
              quips: readingQuips(next.kind),
              quipIdx: 0,
              // First swap comes early so even an instant card gets one joke.
              nextQuipAt: now + 1100 + Math.random() * 400,
            };
            brain.scanQueue = [];
            brain.mode = 'read-seek';
          }
        }

        if (brain.reading) {
          const bounds = editor.getShapePageBounds(brain.reading.id);
          if (!bounds) {
            finishReading(now); // deleted or undone mid-read
          } else if (
            (processingDone(brain.reading) && now >= brain.reading.minUntil) ||
            now >= brain.reading.capUntil
          ) {
            finishReading(now);
          } else {
            if (now >= brain.reading.nextQuipAt) {
              brain.reading.quipIdx = (brain.reading.quipIdx + 1) % brain.reading.quips.length;
              brain.reading.nextQuipAt = now + QUIP_MS[0] + Math.random() * (QUIP_MS[1] - QUIP_MS[0]);
            }
            show(true, brain.reading.quips[brain.reading.quipIdx] ?? 'reading…');
            if (brain.mode === 'read-seek') {
              const entry = { x: bounds.minX + bounds.w * 0.2, y: bounds.minY + bounds.h * 0.18 };
              if (reduce) {
                follower.jumpTo(parkPoint(bounds));
                brain.mode = 'read-scan';
              } else {
                follower.moveTo(entry, now, { zoom, speed: 1.3 });
                if (follower.settled) brain.mode = 'read-scan';
              }
            } else if (!reduce && follower.settled) {
              // Sweep the card like eyes over lines; re-derive from live
              // bounds so a card dragged mid-read keeps its reader.
              if (brain.scanQueue.length === 0) {
                brain.scanQueue = scanWaypoints(bounds, brain.reading.kind === 'pdf' ? 4 : 3);
              }
              const pt = brain.scanQueue.shift()!;
              follower.moveTo(pt, now, { zoom, speed: 0.55, gentle: true });
            }
          }
        } else if (reduce) {
          // Reduced motion: no roaming — the entity appears only while working.
          show(false, null);
        } else {
          // 3) Nothing to do — live on the board like a curious collaborator.
          show(true, null);
          if (brain.mode !== 'wander-move' && now >= brain.dwellUntil) {
            follower.moveTo(pickWanderTarget(), now, { zoom, speed: 0.9 });
            brain.mode = 'wander-move';
          } else if (brain.mode === 'wander-move' && follower.settled) {
            brain.mode = 'wander-idle';
            brain.dwellUntil = now + DWELL_MS[0] + Math.random() * (DWELL_MS[1] - DWELL_MS[0]);
            brain.nextDriftAt = now + 700 + Math.random() * 900;
          } else if (brain.mode === 'wander-idle' && follower.settled && now >= brain.nextDriftAt) {
            // A resting hand is never perfectly still.
            follower.moveTo(
              { x: follower.pos.x + (Math.random() - 0.5) * 22 / zoom, y: follower.pos.y + (Math.random() - 0.5) * 16 / zoom },
              now,
              { zoom, speed: 0.35, gentle: true },
            );
            brain.nextDriftAt = now + 900 + Math.random() * 1500;
          }
        }
      }

      follower.tick(now);
      if (wrapRef.current) {
        const screen = editor.pageToViewport(follower.pos);
        const j = reduce ? { x: 0, y: 0 } : tremor(now);
        // Anchor on the arrow TIP (4,3 in the svg), like a real cursor hotspot.
        wrapRef.current.style.transform = `translate(${screen.x - 4 + j.x}px, ${screen.y - 3 + j.y}px)`;
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

  // Always mounted — the rAF loop owns the transform, so unmounting would
  // flash the avatar at the origin for a frame on re-entry. Hidden = faded.
  return <JarwizAvatar status={status} hidden={!visible} wrapRef={wrapRef} />;
}

function JarwizAvatar({
  status,
  hidden,
  wrapRef,
}: {
  status: string | null;
  hidden: boolean;
  wrapRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={wrapRef}
      className={`jz-avatar jz-avatar--jarwiz${status ? '' : ' jz-avatar--idle'}${hidden ? ' jz-avatar--hidden' : ''}`}
      style={{ '--agent-color': JARWIZ.color } as CSSProperties}
    >
      {/* The collaborator pointer — a classic cursor arrow in Jarwiz ink. */}
      <svg
        className="jz-cursor-arrow"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        role="img"
        aria-label={JARWIZ.name}
      >
        <path d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" />
      </svg>
      {/* One trailing pill: name always, the quip beside it when working. */}
      <div className="jz-avatar-badge">
        <span className="jz-avatar-name">{JARWIZ.name}</span>
        {/* Keyed so each quip remounts and replays the swap animation. */}
        {status ? <span key={status} className="jz-avatar-status">{status}</span> : null}
      </div>
    </div>
  );
}
