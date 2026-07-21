/**
 * Shared base class for every Jarwiz card ShapeUtil.
 *
 * Each card is a plain w×h box, so two pieces of scaffolding were identical in
 * all 13 card utils: the geometry (a filled rectangle from w/h) and
 * resizability (always on). They were hand-copied into each file; they live
 * here once. A card util extends `CardShapeUtil<XCardShape>` and only writes
 * what makes it that card — its props schema, `component`, indicator path,
 * per-card resize constraints, edit/streaming behaviour, and so on.
 */

import { Rectangle2d, ShapeUtil, type TLShape } from 'tldraw';

/** Any Jarwiz card shape: a registered `TLShape` whose props carry at least
 *  width/height (plus its own extras). Intersecting with `TLShape` — the union
 *  `ShapeUtil` constrains on — keeps every card util assignable while still
 *  giving `getGeometry` typed access to `w`/`h`. */
export type CardBoxShape = TLShape & { props: { w: number; h: number } };

export abstract class CardShapeUtil<T extends CardBoxShape> extends ShapeUtil<T> {
  /** Every card is a filled w×h rectangle. */
  override getGeometry(shape: T) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  /** Every card is freely resizable — each util still sets its own minimum
   *  size in `onResize`. */
  override canResize() {
    return true;
  }
}
