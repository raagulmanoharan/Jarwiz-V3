/**
 * Frame something in view at a *legible* zoom. The rule (shared by rail spawns,
 * search jumps, generated answers, and tidy) is the same everywhere: keep the
 * user's current zoom when it already frames the target comfortably (pan only),
 * zoom out just enough when the target would crop — but never past a legibility
 * floor, so a big result lands readable instead of shrinking to a speck — and
 * zoom in to a readable size (never past 100%) when it would otherwise be tiny.
 *
 * The old behaviour fit the *entire* bounds unconditionally (tldraw's
 * `zoomToBounds(..., targetZoom: 1)` only caps the MAX zoom, never the min), so
 * framing a source + its fresh answer together — or a large tidied grid — zoomed
 * so far out the new card looked like a dot. `frameBounds` adds the missing
 * floor; when it kicks in we centre on `focus` (the thing that actually matters,
 * usually the new work) so it stays put while the rest spills off-edge.
 */

import { type Box, type Editor, type TLShapeId } from 'tldraw';

/** Below this zoom a freshly spawned card is too small to type into. */
const READABLE_ZOOM = 0.7;
/** Screen-pixel breathing room around the target when we must re-zoom. */
const MARGIN = 120;

export interface FrameOpts {
  /** Screen-pixel breathing room per side (default 120). */
  margin?: number;
  /** Never zoom OUT below this. When hit, we hold it and centre on `focus`. */
  minZoom?: number;
  /** What to keep centred if the floor kicks in (else the whole bounds). */
  focus?: Box;
  animation?: { duration: number; easing?: (t: number) => number };
}

/** Frame an arbitrary page-space box at a legible zoom (see file header). */
export function frameBounds(editor: Editor, b: Box, opts?: FrameOpts): void {
  const vp = editor.getViewportScreenBounds();
  const margin = opts?.margin ?? MARGIN;
  const floor = opts?.minZoom ?? 0;
  const fit = Math.min((vp.w - margin * 2) / b.w, (vp.h - margin * 2) / b.h);
  const z = editor.getZoomLevel();
  let zoom =
    z > fit ? fit                          // cropped → zoom out until it fits
    : z < READABLE_ZOOM ? Math.min(1, fit) // a speck → zoom in to readable, capped at 100%
    : z;                                   // already comfortable → pan only
  let center: Box = b;
  if (floor > 0 && zoom < floor) {
    // Fitting it all would drop below the legibility floor. Hold the floor and
    // keep the focus (the new work) centred; the rest spills off-edge.
    zoom = floor;
    center = opts?.focus ?? b;
  }
  editor.setCamera(
    { x: vp.w / 2 / zoom - center.midX, y: vp.h / 2 / zoom - center.midY, z: zoom },
    { animation: opts?.animation ?? { duration: 220 } },
  );
}

export function bringIntoView(editor: Editor, id: TLShapeId): void {
  const b = editor.getShapePageBounds(id);
  if (b) frameBounds(editor, b);
}
