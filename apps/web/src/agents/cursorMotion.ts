/**
 * Human mouse trajectories for the Jarwiz entity. A real hand never moves in
 * a straight line at constant speed: it arcs, accelerates and decelerates
 * smoothly, overshoots the target a touch and corrects. This module is the
 * pure math behind that feel — a Follower holds a position in PAGE space and
 * advances along generated cubic-bezier segments each animation frame, so
 * the avatar's motion survives pans and zooms untouched.
 *
 * Durations are computed from SCREEN distance (page distance × zoom): a hop
 * across the viewport should take the same beat whether the user is zoomed
 * way out or way in.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface MoveOptions {
  /** Current zoom level — converts page distance to screen distance. */
  zoom?: number;
  /** >1 = swifter (urgent seeks), <1 = lazier (idle drifts). */
  speed?: number;
  /** Straighter, slower, no overshoot — the reading-sweep gait. */
  gentle?: boolean;
}

interface Segment {
  from: Vec;
  c1: Vec;
  c2: Vec;
  to: Vec;
  /** 0 = starts on the first tick that reaches it. */
  start: number;
  dur: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const bezier = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** Travel-time envelope, in screen pixels → ms. Tuned to FigJam-collaborator
 *  pace: quick for short hops, capped so cross-board flights stay urgent. */
const MIN_TRAVEL_MS = 380;
const MAX_TRAVEL_MS = 1900;

export class Follower {
  pos: Vec;
  private queue: Segment[] = [];
  private goal: Vec | null = null;

  constructor(start: Vec) {
    this.pos = { ...start };
  }

  /** Where the follower is ultimately headed, or null when settled. */
  get target(): Vec | null {
    return this.goal;
  }

  get settled(): boolean {
    return this.queue.length === 0;
  }

  /** Teleport — the reduced-motion path and initial placement. */
  jumpTo(to: Vec): void {
    this.pos = { ...to };
    this.queue = [];
    this.goal = null;
  }

  /**
   * Head for a new goal along a human arc. A repeat call for (roughly) the
   * same goal is a no-op so per-frame brains can call this idempotently.
   */
  moveTo(to: Vec, now: number, opts: MoveOptions = {}): void {
    const zoom = opts.zoom ?? 1;
    if (this.goal && Math.hypot(this.goal.x - to.x, this.goal.y - to.y) * zoom < 8) return;

    const speed = opts.speed ?? 1;
    const from = { ...this.pos };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const screenDist = dist * zoom;

    // Perpendicular bow gives the path its arc; gentler while scanning.
    const px = -dy / dist;
    const py = dx / dist;
    const bendScale = opts.gentle ? rand(0.02, 0.07) : rand(0.08, 0.2);
    const bend = dist * bendScale * (Math.random() < 0.5 ? -1 : 1);

    // Overshoot in screen px so the correction stays subtle at any zoom.
    const overshootPx = opts.gentle ? 0 : Math.min(16, screenDist * 0.07) * rand(0.5, 1.4);
    const overshoot = overshootPx / zoom;
    const end: Vec = opts.gentle
      ? { ...to }
      : { x: to.x + (dx / dist) * overshoot, y: to.y + (dy / dist) * overshoot };

    const c1: Vec = {
      x: from.x + dx * rand(0.2, 0.35) + px * bend,
      y: from.y + dy * rand(0.2, 0.35) + py * bend,
    };
    const c2: Vec = {
      x: from.x + dx * rand(0.6, 0.8) + px * bend * rand(0.2, 0.5),
      y: from.y + dy * rand(0.6, 0.8) + py * bend * rand(0.2, 0.5),
    };

    const dur =
      Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, 240 + screenDist * rand(1.0, 1.5))) /
      (opts.gentle ? speed * 0.85 : speed);

    this.queue = [{ from, c1, c2, to: end, start: now, dur }];
    if (!opts.gentle) {
      // The corrective settle back onto the true goal.
      this.queue.push({
        from: end,
        c1: { x: end.x + (to.x - end.x) * 0.3, y: end.y + (to.y - end.y) * 0.3 },
        c2: { x: end.x + (to.x - end.x) * 0.7, y: end.y + (to.y - end.y) * 0.7 },
        to: { ...to },
        start: 0,
        dur: rand(150, 280),
      });
    }
    this.goal = { ...to };
  }

  /** Advance one frame. Returns true while still travelling. */
  tick(now: number): boolean {
    const seg = this.queue[0];
    if (!seg) return false;
    if (seg.start === 0) seg.start = now;
    const t = Math.min(1, (now - seg.start) / seg.dur);
    const e = easeInOutCubic(t);
    this.pos = {
      x: bezier(seg.from.x, seg.c1.x, seg.c2.x, seg.to.x, e),
      y: bezier(seg.from.y, seg.c1.y, seg.c2.y, seg.to.y, e),
    };
    if (t >= 1) {
      this.queue.shift();
      if (this.queue.length === 0) this.goal = null;
    }
    return this.queue.length > 0;
  }
}

/**
 * Zig-zag sweep over a card's bounds — the eyes-reading-lines pattern the
 * avatar traces while a card is processing. Fractions of the bounds so the
 * caller can re-resolve against a card the user is dragging mid-read.
 */
export function scanWaypoints(bounds: { x: number; y: number; w: number; h: number }, rows: number): Vec[] {
  const pts: Vec[] = [];
  for (let r = 0; r < rows; r++) {
    const fy = 0.2 + (0.56 * r) / Math.max(1, rows - 1);
    const y = bounds.y + bounds.h * (fy + rand(-0.02, 0.02));
    const left = bounds.x + bounds.w * rand(0.1, 0.16);
    const right = bounds.x + bounds.w * rand(0.84, 0.9);
    pts.push(
      r % 2 === 0 ? { x: left, y } : { x: right, y },
      r % 2 === 0 ? { x: right, y } : { x: left, y },
    );
  }
  return pts;
}

/** Sub-pixel-ish tremor (screen px) so a "still" cursor never reads as frozen. */
export function tremor(nowMs: number): Vec {
  const t = nowMs * 0.001;
  return {
    x: Math.sin(t * 2.1 + 1) * 0.7 + Math.sin(t * 5.3) * 0.35,
    y: Math.cos(t * 1.7) * 0.7 + Math.sin(t * 4.1 + 2) * 0.35,
  };
}
