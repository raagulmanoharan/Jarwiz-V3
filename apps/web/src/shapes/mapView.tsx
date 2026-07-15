/**
 * The shared map viewport — one renderer for every place maps appear: the
 * standalone map card, the inline map block inside doc answers, and the
 * full-screen trip view (CardFocusOverlay). MapLibre GL over OpenFreeMap
 * vector tiles (keyless; attribution kept visible), lazy-loaded so the main
 * bundle stays lean; basemap follows the app theme. When tiles are unreachable
 * — or a map opts into `mock` (the marketing board) — it degrades to a
 * schematic basemap: abstract roads/blocks with the route and linearly
 * projected pins, never a broken frame. See docs/MAPS.md.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MapStop } from '@jarwiz/shared';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { getTheme, subscribeTheme } from '../ui/theme';

/** OpenFreeMap style JSON per theme — no key, no registration; the styles are
 *  already near-monochrome so the basemap sits inside the design system. */
const MAP_STYLE: Record<string, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Give the style this long to load before declaring tiles unreachable. */
const STYLE_TIMEOUT_MS = 12_000;

/** One lazy import for every map surface — the library (and its CSS) loads
 *  the first time a map renders, never in the main bundle. */
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
export function googleMapsUrl(stop: MapStop): string {
  const q = stop.approx ? `${stop.lat},${stop.lng}` : stop.query || `${stop.lat},${stop.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** The whole ordered plan handed to Google Maps navigation in one link:
 *  first stop = origin, last = destination, the rest ride as waypoints. */
export function googleMapsRouteUrl(stops: MapStop[]): string {
  const place = (s: MapStop) => (s.approx ? `${s.lat},${s.lng}` : s.query || `${s.lat},${s.lng}`);
  const origin = encodeURIComponent(place(stops[0]!));
  const destination = encodeURIComponent(place(stops[stops.length - 1]!));
  const waypoints = stops
    .slice(1, -1)
    .map((s) => encodeURIComponent(place(s)))
    .join('%7C');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}`;
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

export function MapViewport({
  stops,
  ordered,
  interactive,
  activeIndex = null,
  mock = false,
}: {
  stops: MapStop[];
  ordered: boolean;
  interactive: boolean;
  /** Highlighted stop (the trip rail's hover/click) — its pin lifts and the
   *  camera eases to it. Null = the whole-trip framing. */
  activeIndex?: number | null;
  /** Skip live tiles entirely and render the schematic mock basemap. Used by
   *  the marketing use-case board, where a deterministic, instant map beats a
   *  live one that can be slow to load or blocked by the host's CSP. */
  mock?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Marker[]>([]);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);

  // Create the map (once per theme — the basemap style follows light/dark).
  useEffect(() => {
    if (mock) return; // the marketing board wants the schematic mock, not tiles
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
  }, [theme, mock]);

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

  // The rail's highlight: lift the active pin; ease the camera to it (or back
  // to the whole trip when the highlight clears).
  useEffect(() => {
    if (!map || failed) return;
    markersRef.current.forEach((m, i) =>
      m.getElement().classList.toggle('jz-map-pin--active', i === activeIndex),
    );
    if (activeIndex != null && stops[activeIndex]) {
      map.easeTo({
        center: [stops[activeIndex]!.lng, stops[activeIndex]!.lat],
        zoom: Math.max(map.getZoom(), 11),
        duration: reducedMotion() ? 0 : 420,
      });
    }
  }, [map, failed, activeIndex, stops]);

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

  // Mock = intentional schematic (no note); failed = genuine tile outage (a
  // quiet, honest caption). Both render the same map-like fallback surface.
  if (mock || failed) {
    return <MapFallback stops={stops} activeIndex={activeIndex} ordered={ordered} note={mock ? '' : 'offline · schematic map'} />;
  }

  return (
    <>
      <div
        ref={containerRef}
        className="jz-map-canvas"
        // At rest the map's own handlers must never see the pointer — the
        // canvas owns pan/zoom. Edit/focus mode hands the gestures to the map.
        style={{ pointerEvents: interactive ? 'all' : 'none' }}
      />
      {!styleReady ? <div className="jz-map-loading">loading map…</div> : null}
    </>
  );
}

/** A schematic street-map texture drawn behind the pins — abstract roads,
 *  blocks, a park and a river in the design system's monochrome ink, so the
 *  fallback reads as a MAP rather than a broken frame. Purely decorative and
 *  stop-independent; the pins keep the real relative geography on top. */
function MockBasemap() {
  return (
    <svg className="jz-map-mock-base" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
      <path className="jz-map-mock-water" d="M0 70 C 26 63, 52 79, 84 71 S 138 64, 160 73 L160 100 L0 100 Z" />
      <rect className="jz-map-mock-park" x="16" y="15" width="28" height="22" rx="3" />
      <g className="jz-map-mock-block">
        <rect x="52" y="12" width="30" height="16" rx="1.5" />
        <rect x="92" y="10" width="24" height="18" rx="1.5" />
        <rect x="124" y="16" width="24" height="14" rx="1.5" />
        <rect x="54" y="40" width="26" height="15" rx="1.5" />
        <rect x="96" y="40" width="30" height="14" rx="1.5" />
        <rect x="20" y="46" width="24" height="14" rx="1.5" />
      </g>
      <g className="jz-map-mock-road">
        <line x1="0" y1="34" x2="160" y2="31" />
        <line x1="0" y1="63" x2="160" y2="60" />
        <line x1="49" y1="0" x2="52" y2="100" />
        <line x1="88" y1="0" x2="91" y2="100" />
        <line x1="121" y1="0" x2="126" y2="100" />
        <line className="jz-map-mock-road--minor" x1="0" y1="4" x2="160" y2="50" />
        <line className="jz-map-mock-road--minor" x1="70" y1="0" x2="160" y2="90" />
      </g>
    </svg>
  );
}

/** Tiles unreachable OR an intentional mock — a designed degrade, never a
 *  broken frame: a schematic basemap with the ordered route and the pins in
 *  their real relative geography (linear lat/lng projection). */
function MapFallback({
  stops,
  activeIndex,
  ordered = true,
  note = '',
}: {
  stops: MapStop[];
  activeIndex?: number | null;
  ordered?: boolean;
  note?: string;
}) {
  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // 12% inset so edge pins don't clip; a single stop centres. Same math for the
  // pins (via %) and the route polyline (SVG stretched to fill), so they align.
  const px = (s: MapStop) => (maxLng === minLng ? 50 : 12 + (76 * (s.lng - minLng)) / (maxLng - minLng));
  const py = (s: MapStop) => (maxLat === minLat ? 50 : 12 + (76 * (maxLat - s.lat)) / (maxLat - minLat));
  const route = ordered && stops.length > 1 ? stops.map((s) => `${px(s)},${py(s)}`).join(' ') : '';
  return (
    <div className="jz-map-fallback">
      <MockBasemap />
      {route ? (
        <svg className="jz-map-mock-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline points={route} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {stops.map((stop, i) => (
        <div
          key={`${stop.lat},${stop.lng},${i}`}
          className={`jz-map-pin${stop.approx ? ' jz-map-pin--approx' : ''}${i === activeIndex ? ' jz-map-pin--active' : ''}`}
          style={{ position: 'absolute', left: `${px(stop)}%`, top: `${py(stop)}%` }}
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
      {note ? <span className="jz-map-fallback-note">{note}</span> : null}
    </div>
  );
}
