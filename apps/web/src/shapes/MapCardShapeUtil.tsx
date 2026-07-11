/**
 * Map card — real places on a real map (docs/MAPS.md). The Ask pipeline
 * verifies each stop server-side and streams `map.pin` events; pins land here
 * one by one while `status === 'running'`, the way a table fills cell by cell.
 *
 * Interaction follows the YouTube card's rule: INERT at rest (drag moves the
 * card, scroll pans the canvas — the map never steals a gesture), live pan/zoom
 * only inside edit mode (double-click). Rendering is MapLibre GL over
 * OpenFreeMap vector tiles (keyless, unlimited; attribution required and kept
 * visible), lazy-loaded like mermaid/pdfjs so the main bundle stays lean. The
 * basemap follows the app theme (positron light / dark). When tiles can't load
 * (offline, provider down) the card degrades to token-colored paper with the
 * pins linearly projected — the trip survives, only the basemap is missing.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { useCardSelected } from './useCardSelected';
import { getTheme, subscribeTheme } from '../ui/theme';

export interface MapCardProps {
  w: number;
  h: number;
  title: string;
  /** The one-line thesis behind the geometry (focus rail, P1). */
  intro: string;
  /** Geocoded stops in visiting order (see MapStop, packages/shared). */
  stops: MapStop[];
  /** Route (ordered stops, dashed line) vs. places (options, no line). */
  ordered: boolean;
  /** 'running' (pins still landing) | 'done' | 'error'. */
  status: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'map-card': MapCardProps;
  }
}

export type MapCardShape = TLShape<'map-card'>;

export const MAP_CARD_SIZE = { w: 520, h: 336 }; // 36px header + map viewport

/** OpenFreeMap style JSON per theme — no key, no registration; the styles are
 *  already near-monochrome so the basemap sits inside the design system. */
const MAP_STYLE: Record<string, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Give the style this long to load before declaring tiles unreachable. */
const STYLE_TIMEOUT_MS = 12_000;

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
  const { title, stops, ordered, status } = shape.props;

  return (
    <div className={`jz-card${isSelected ? ' jz-card-selected' : ''}`} data-status={status}>
      <div className="jz-map-header">
        <span className="jz-map-title">{title || 'Map'}</span>
        {status === 'running' ? (
          <span className="jz-map-chip jz-map-chip--live">✦ placing stops</span>
        ) : status === 'error' ? (
          <span className="jz-map-chip">couldn’t verify places</span>
        ) : null}
        <span className="jz-map-hint">{isEditing ? 'esc to leave' : 'double-click to pan'}</span>
      </div>
      <div
        className="jz-map-frame"
        // In edit mode gestures belong to the map, not the canvas; at rest
        // everything falls through so drag moves the card (YouTube's rule).
        onPointerDown={isEditing ? stopEventPropagation : undefined}
        onWheelCapture={isEditing ? stopEventPropagation : undefined}
      >
        <MapViewport stops={stops} ordered={ordered} interactive={isEditing} />
      </div>
    </div>
  );
}

/* ── MapLibre plumbing ───────────────────────────────────────────────────── */

/** One lazy import for every map card — the library (and its CSS) loads the
 *  first time a map card renders, never in the main bundle. */
let maplibrePromise: Promise<typeof import('maplibre-gl')> | null = null;
function loadMaplibre() {
  if (!maplibrePromise) {
    maplibrePromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([lib]) => lib);
  }
  return maplibrePromise;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The free hand-off: a plain Google Maps link — a verified stop opens by its
 *  qualified place query (name → the place page), an approximate one by raw
 *  coordinates (the query is exactly what we could NOT verify). */
function googleMapsUrl(stop: MapStop): string {
  const q = stop.approx ? `${stop.lat},${stop.lng}` : stop.query || `${stop.lat},${stop.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function makePinElement(stop: MapStop, index: number, showNumber: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `jz-map-pin${stop.approx ? ' jz-map-pin--approx' : ''}`;
  el.textContent = showNumber ? String(index + 1) : '';
  el.title = `${stop.name}${stop.approx ? ' — location approximate' : ''} · open in Google Maps`;
  el.setAttribute('role', 'link');
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.open(googleMapsUrl(stop), '_blank', 'noopener,noreferrer');
  });
  return el;
}

function MapViewport({
  stops,
  ordered,
  interactive,
}: {
  stops: MapStop[];
  ordered: boolean;
  interactive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Marker[]>([]);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);

  // Create the map (once per theme — the basemap style follows light/dark).
  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | null = null;
    setStyleReady(false);
    setFailed(false);
    void loadMaplibre()
      .then((lib) => {
        if (cancelled || !containerRef.current) return;
        created = new lib.Map({
          container: containerRef.current,
          style: MAP_STYLE[theme] ?? MAP_STYLE.light!,
          center: [78, 21],
          zoom: 2.4,
          fadeDuration: reducedMotion() ? 0 : undefined,
        });
        const timeout = setTimeout(() => {
          if (!cancelled && !created?.isStyleLoaded()) setFailed(true);
        }, STYLE_TIMEOUT_MS);
        created.once('load', () => {
          clearTimeout(timeout);
          if (!cancelled) setStyleReady(true);
        });
        // An error before the style ever loads = tiles unreachable (offline,
        // provider down) — degrade immediately, don't wait out the timeout.
        // Tile hiccups after load are MapLibre's to retry; we ignore those.
        created.on('error', () => {
          if (!cancelled && !created?.isStyleLoaded()) {
            clearTimeout(timeout);
            setFailed(true);
          }
        });
        setMap(created);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      setMap(null);
      created?.remove();
    };
  }, [theme]);

  // Sync pins: a handful of markers, rebuilt whenever the stops change (new
  // pins wear the materialize spring via CSS; reduced-motion stills it).
  useEffect(() => {
    if (!map || failed) return;
    let cancelled = false;
    void loadMaplibre().then((lib) => {
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = stops.map((stop, i) =>
        new lib.Marker({ element: makePinElement(stop, i, stops.length > 1) })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map),
      );
      if (stops.length === 1) {
        map.easeTo({
          center: [stops[0]!.lng, stops[0]!.lat],
          zoom: 10.5,
          duration: reducedMotion() ? 0 : 420,
        });
      } else if (stops.length > 1) {
        const bounds = new lib.LngLatBounds();
        stops.forEach((s) => bounds.extend([s.lng, s.lat]));
        map.fitBounds(bounds, {
          padding: 46,
          maxZoom: 12.5,
          duration: reducedMotion() ? 0 : 420,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [map, stops, failed]);

  // The route line — dashed, honest "visiting order, not roads" (docs/MAPS.md).
  // Places mode (ordered=false) never draws a line between options.
  useEffect(() => {
    if (!map || !styleReady) return;
    const coords = ordered && stops.length > 1 ? stops.map((s) => [s.lng, s.lat]) : [];
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
    const existing = map.getSource('jz-route') as { setData: (d: unknown) => void } | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    if (coords.length === 0) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--jz-ink-400').trim() || '#8a8a8a';
    map.addSource('jz-route', { type: 'geojson', data });
    map.addLayer({
      id: 'jz-route',
      type: 'line',
      source: 'jz-route',
      paint: { 'line-color': ink, 'line-width': 1.6, 'line-dasharray': [1.6, 2.6], 'line-opacity': 0.85 },
    });
  }, [map, styleReady, stops, ordered]);

  if (failed) return <MapFallback stops={stops} />;

  return (
    <>
      <div
        ref={containerRef}
        className="jz-map-canvas"
        // At rest the map's own handlers must never see the pointer — the
        // canvas owns pan/zoom. Edit mode hands the gestures to the map.
        style={{ pointerEvents: interactive ? 'all' : 'none' }}
      />
      {!styleReady ? <div className="jz-map-loading">loading map…</div> : null}
    </>
  );
}

/** Tiles unreachable — designed degrade, never a broken frame: the pins keep
 *  their relative geography on plain paper via a linear lat/lng projection. */
function MapFallback({ stops }: { stops: MapStop[] }) {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const pos = (stop: MapStop) => ({
    // 12% inset so edge pins don't clip; a single stop centres.
    left: `${maxLng === minLng ? 50 : 12 + (76 * (stop.lng - minLng)) / (maxLng - minLng)}%`,
    top: `${maxLat === minLat ? 50 : 12 + (76 * (maxLat - stop.lat)) / (maxLat - minLat)}%`,
  });
  return (
    <div className="jz-map-fallback">
      {stops.map((stop, i) => (
        <div
          key={`${stop.lat},${stop.lng},${i}`}
          className={`jz-map-pin${stop.approx ? ' jz-map-pin--approx' : ''}`}
          style={{ position: 'absolute', ...pos(stop) }}
          title={`${stop.name} · open in Google Maps`}
          role="link"
          onClick={(ev) => {
            ev.stopPropagation();
            window.open(googleMapsUrl(stop), '_blank', 'noopener,noreferrer');
          }}
        >
          {stops.length > 1 ? i + 1 : ''}
        </div>
      ))}
      <span className="jz-map-fallback-note">map tiles unavailable</span>
    </div>
  );
}
