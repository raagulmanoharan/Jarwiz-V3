/**
 * The inline map block inside a doc answer (docs/MAPS.md). A ```map fence in
 * the doc's markdown holds the model's proposed stops; this component hydrates
 * them through POST /api/geo/stops (server-side geocoding — cached, throttled,
 * honest `approx` fallback) and renders the shared MapViewport with a quiet
 * toolbar: Open route (the free Google Maps hand-off) and ⤢ expand map, which
 * promotes the block into a full standalone map card wired to this doc.
 *
 * Division of labour (owner-approved mock, 2026-07-11): the inline block is
 * for when the map ILLUSTRATES an answer; the standalone card is for when the
 * map IS the artifact.
 */

import { useEffect, useMemo, useState } from 'react';
import type { MapStop } from '@jarwiz/shared';
import { googleMapsRouteUrl, googleMapsUrl, MapViewport } from '../shapes/mapView';

/** What a doc's map fence may carry (the model's proposal, pre-verification). */
interface FenceSpec {
  ordered: boolean;
  stops: Array<Record<string, unknown>>;
}

/** Ask the canvas to promote this block into a standalone map card. A DOM
 *  event keeps DocMarkdown dependency-free — MapExpandLayer (inside the
 *  tldraw tree, where the editor lives) listens and creates the shape. */
export interface MapExpandDetail {
  stops: MapStop[];
  ordered: boolean;
  /** The doc card the block lives in — becomes the map card's provenance. */
  sourceId?: string;
}
export const MAP_EXPAND_EVENT = 'jz:map-expand';

function parseFence(raw: string): FenceSpec | null {
  try {
    const json = JSON.parse(raw) as { ordered?: unknown; stops?: unknown };
    if (!Array.isArray(json.stops) || json.stops.length === 0) return null;
    return {
      ordered: json.ordered !== false,
      stops: json.stops.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object'),
    };
  } catch {
    return null;
  }
}

/** One hydration per distinct fence content — docs re-render on every stream
 *  delta and on selection; the geocoder must see each fence once. */
const hydrateCache = new Map<string, Promise<MapStop[] | null>>();
function hydrate(raw: string, spec: FenceSpec): Promise<MapStop[] | null> {
  let inflight = hydrateCache.get(raw);
  if (!inflight) {
    inflight = fetch('/api/geo/stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stops: spec.stops }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stops?: MapStop[] } | null) =>
        Array.isArray(data?.stops) && data!.stops.length > 0 ? data!.stops : null,
      )
      .catch(() => null);
    hydrateCache.set(raw, inflight);
    void inflight.then((v) => {
      if (!v) hydrateCache.delete(raw); // a transient failure may succeed later
    });
  }
  return inflight;
}

export function DocMapBlock({ raw, sourceId }: { raw: string; sourceId?: string }) {
  const spec = useMemo(() => parseFence(raw), [raw]);
  const [stops, setStops] = useState<MapStop[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    void hydrate(raw, spec).then((resolved) => {
      if (!alive) return;
      if (resolved) setStops(resolved);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [raw, spec]);

  // An unparseable fence renders as nothing — same degrade-to-nothing rule as
  // dead images; the prose around it still carries the answer.
  if (!spec) return null;
  if (failed) return null;
  if (!stops) return <div className="jz-map-block jz-map-block--pending">placing the stops…</div>;

  const routable = spec.ordered && stops.length > 1;
  return (
    <div className="jz-map-block">
      <div className="jz-map-block-frame">
        <MapViewport stops={stops} ordered={spec.ordered} interactive={false} />
      </div>
      <div className="jz-map-block-bar" style={{ pointerEvents: 'all' }} onPointerDown={(e) => e.stopPropagation()}>
        <a
          className="jz-map-block-link"
          href={routable ? googleMapsRouteUrl(stops) : googleMapsUrl(stops[0]!)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          ➤ {routable ? 'Open route' : 'Open in Google Maps'}
        </a>
        <span className="jz-map-block-sep">·</span>
        <button
          className="jz-map-block-link"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent<MapExpandDetail>(MAP_EXPAND_EVENT, {
                detail: { stops, ordered: spec.ordered, sourceId },
              }),
            );
          }}
        >
          ⤢ expand map
        </button>
      </div>
    </div>
  );
}
