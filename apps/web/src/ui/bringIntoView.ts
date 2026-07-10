/**
 * After a rail spawn, make sure the new card is actually IN VIEW at a
 * readable size. The old behaviour panned at the CURRENT zoom — zoomed far
 * out, the fresh card arrived as a speck; zoomed far in (or when the
 * free-spot walker nudged it away from a crowded centre), it arrived cropped
 * or off-screen. Now: keep the user's zoom when it already frames the card
 * comfortably (pan only), zoom out just enough when the card would crop, and
 * zoom in to a readable size (never past 100%) when it would be a speck.
 */

import type { Editor, TLShapeId } from 'tldraw';

/** Below this zoom a freshly spawned card is too small to type into. */
const READABLE_ZOOM = 0.7;
/** Screen-pixel breathing room around the card when we must re-zoom. */
const MARGIN = 120;

export function bringIntoView(editor: Editor, id: TLShapeId): void {
  const b = editor.getShapePageBounds(id);
  if (!b) return;
  const vp = editor.getViewportScreenBounds();
  const fit = Math.min((vp.w - MARGIN * 2) / b.w, (vp.h - MARGIN * 2) / b.h);
  const z = editor.getZoomLevel();
  const zoom =
    z > fit ? fit                     // cropped → zoom out until it fits
    : z < READABLE_ZOOM ? Math.min(1, fit) // a speck → zoom in to readable, capped at 100%
    : z;                              // already comfortable → pan only
  editor.setCamera(
    { x: vp.w / 2 / zoom - b.midX, y: vp.h / 2 / zoom - b.midY, z: zoom },
    { animation: { duration: 220 } },
  );
}
