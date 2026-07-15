/**
 * Map card — real places on a real map (docs/MAPS.md). The Ask pipeline
 * verifies each stop server-side and streams `map.pin` events; pins land here
 * one by one while `status === 'running'`, the way a table fills cell by cell.
 *
 * Interaction follows the YouTube card's rule: INERT at rest (drag moves the
 * card, scroll pans the canvas — the map never steals a gesture), live pan/zoom
 * only inside edit mode (double-click). No internal header — like every rich
 * card, the title is the OUTSIDE tag; status and the interaction hint ride as
 * quiet overlay pills. Rendering is the shared MapViewport (mapView.tsx),
 * which the inline doc map block and the focus trip view reuse.
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useIsEditing,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import type { MapStop } from '@jarwiz/shared';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { useCardSelected } from './useCardSelected';
import { MapViewport } from './mapView';
import { JarwizSpark } from '../ui/JarwizSpark';

export interface MapCardProps {
  w: number;
  h: number;
  title: string;
  /** The one-line thesis behind the geometry (focus rail). */
  intro: string;
  /** Geocoded stops in visiting order (see MapStop, packages/shared). */
  stops: MapStop[];
  /** Route (ordered stops, dashed line) vs. places (options, no line). */
  ordered: boolean;
  /** 'running' (pins still landing) | 'done' | 'error'. */
  status: string;
  /** Render the schematic mock basemap instead of live tiles (marketing board:
   *  deterministic + instant, never a slow/blocked tile load). Optional so
   *  real, tile-backed maps stay valid. */
  mock?: boolean;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'map-card': MapCardProps;
  }
}

export type MapCardShape = TLShape<'map-card'>;

export const MAP_CARD_SIZE = { w: 520, h: 336 };

export class MapCardShapeUtil extends ShapeUtil<MapCardShape> {
  static override type = 'map-card' as const;

  static override props: RecordProps<MapCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    intro: T.string,
    stops: T.arrayOf(
      T.object({
        name: T.string,
        query: T.string,
        lat: T.number,
        lng: T.number,
        approx: T.boolean.optional(),
        day: T.string.optional(),
        time: T.string.optional(),
        note: T.string.optional(),
      }),
    ),
    ordered: T.boolean,
    status: T.string,
    mock: T.boolean.optional(),
  };

  override getDefaultProps(): MapCardShape['props'] {
    return { ...MAP_CARD_SIZE, title: '', intro: '', stops: [], ordered: true, status: 'running' };
  }

  override canResize() {
    return true;
  }

  /** Double-click enters editing — the only state where the map pans/zooms. */
  override canEdit() {
    return true;
  }

  override onResize(shape: MapCardShape, info: TLResizeInfo<MapCardShape>) {
    return resizeBox(shape, info, { minWidth: 320, minHeight: 240 });
  }

  override getGeometry(shape: MapCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: MapCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: MapCardShape) {
    return (
      <HTMLContainer>
        <MapCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function MapCardBody({ shape }: { shape: MapCardShape }) {
  const isEditing = useIsEditing(shape.id);
  const isSelected = useCardSelected(shape.id);
  const { stops, ordered, status, mock } = shape.props;

  return (
    <div className={`jz-card${isSelected ? ' jz-card-selected' : ''}`} data-status={status}>
      <div
        className="jz-map-frame"
        // In edit mode gestures belong to the map, not the canvas; at rest
        // everything falls through so drag moves the card (YouTube's rule).
        onPointerDown={isEditing ? stopEventPropagation : undefined}
        onWheelCapture={isEditing ? stopEventPropagation : undefined}
      >
        <MapViewport stops={stops} ordered={ordered} interactive={isEditing} mock={mock} />
        {status === 'running' ? (
          <span className="jz-map-float jz-map-float--live"><JarwizSpark size={11} className="jz-spark-inline" /> placing stops</span>
        ) : status === 'error' ? (
          <span className="jz-map-float">couldn’t verify places</span>
        ) : null}
        {isEditing ? (
          <span className="jz-map-float jz-map-float--hint">esc to leave</span>
        ) : isSelected ? (
          <span className="jz-map-float jz-map-float--hint">double-click to pan</span>
        ) : null}
      </div>
    </div>
  );
}
