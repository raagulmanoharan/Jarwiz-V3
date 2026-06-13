/**
 * Shared geometry helpers for the Jarwiz card shapes.
 *
 * Every card is a rounded rectangle; tldraw 5 renders selection indicators
 * from a Path2D returned by ShapeUtil.getIndicatorPath.
 */

/** Matches --jz-radius (1rem) in styles/index.css. */
export const CARD_RADIUS = 16;

/** Matches the sticky note's tighter corner rounding (.jz-note). */
export const NOTE_RADIUS = 4;

/** Document card uses the standard card radius. */
export const DOC_RADIUS = CARD_RADIUS;

export function roundedRectPath(w: number, h: number, radius: number): Path2D {
  const path = new Path2D();
  const r = Math.min(radius, w / 2, h / 2);
  path.roundRect(0, 0, w, h, r);
  return path;
}
