/**
 * Renders a structured rich card — a sequence of typed blocks (packages/shared
 * blocks.ts) the model emits as newline-delimited JSON, validated and hydrated
 * server-side. The counterpart to DocMarkdown: where that parses a markdown
 * string, this walks already-structured blocks, so tables/maps/images/links are
 * guaranteed well-formed. Inline text
 * inside paragraphs, headings, list items and cells still runs through
 * DocMarkdown's `renderInline` for the small marks (bold/italic/code/links).
 *
 * Maps arrive already geocoded (get_map ran server-side), so this renders the
 * viewport straight from the stops — no client hydration round-trip.
 */

import { stopEventPropagation } from 'tldraw';
import type { RichBlock, MapStop } from '@jarwiz/shared';
import { googleMapsRouteUrl, googleMapsUrl, MapViewport } from '../shapes/mapView';
import { renderInline } from './DocMarkdown';

/** Remote image URLs route through the same-origin cache-proxy (see DocMarkdown);
 *  data: and root-relative asset URLs pass through untouched. */
function imageSrc(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/image?src=${encodeURIComponent(url)}` : url;
}

export function RichBlocks({
  blocks,
  onToggleTask,
  onCite,
}: {
  blocks: RichBlock[];
  /** Toggling a checklist item — ordinal is its index across ALL checklist items. */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
  onCite?: (page: number) => void;
}) {
  let taskOrdinal = 0;
  return (
    <div className="jz-markdown jz-richblocks">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const H = (b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3') as 'h1';
            return (
              <H key={i} className={`jz-md-h${b.level}`}>
                {renderInline(b.text, onCite)}
              </H>
            );
          }
          case 'paragraph':
            return (
              <p key={i} className="jz-md-p">
                {renderInline(b.text, onCite)}
              </p>
            );
          case 'divider':
            return <hr key={i} className="jz-md-hr" />;
          case 'list':
            return b.ordered ? (
              <ol key={i} className="jz-md-ol">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, onCite)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="jz-md-ul">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, onCite)}</li>
                ))}
              </ul>
            );
          case 'checklist':
            return (
              <ul key={i} className="jz-md-ul jz-md-tasklist">
                {b.items.map((it) => {
                  const ordinal = taskOrdinal++;
                  return (
                    <li key={ordinal} className="jz-md-task">
                      <input
                        type="checkbox"
                        className="jz-md-checkbox"
                        checked={it.done}
                        disabled={!onToggleTask}
                        style={{ pointerEvents: 'all' }}
                        onPointerDown={stopEventPropagation}
                        onChange={() => onToggleTask?.(ordinal, !it.done)}
                      />
                      <span className={it.done ? 'jz-md-task-done' : undefined}>{renderInline(it.text, onCite)}</span>
                    </li>
                  );
                })}
              </ul>
            );
          case 'table':
            return (
              <table key={i} className="jz-md-table">
                {b.columns.length > 0 ? (
                  <thead>
                    <tr>
                      {b.columns.map((c, ci) => (
                        <th key={ci}>{renderInline(c, onCite)}</th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci}>{renderInline(c, onCite)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case 'image':
            return (
              <figure key={i} className="jz-block-image">
                <img
                  className="jz-md-img"
                  src={imageSrc(b.url)}
                  alt={b.alt ?? ''}
                  draggable={false}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget.closest('.jz-block-image') as HTMLElement | null)?.style.setProperty('display', 'none');
                  }}
                />
                {b.caption ? <figcaption className="jz-block-image-cap">{renderInline(b.caption, onCite)}</figcaption> : null}
              </figure>
            );
          case 'link':
            return (
              <a
                key={i}
                className="jz-block-link"
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ pointerEvents: 'all' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {b.image ? <img className="jz-block-link-img" src={imageSrc(b.image)} alt="" draggable={false} referrerPolicy="no-referrer" /> : null}
                <span className="jz-block-link-body">
                  {b.siteName ? <span className="jz-block-link-site">{b.siteName}</span> : null}
                  <span className="jz-block-link-title">{b.title || b.url}</span>
                  {b.description ? <span className="jz-block-link-desc">{b.description}</span> : null}
                </span>
              </a>
            );
          case 'map':
            return <MapRender key={i} ordered={b.ordered} stops={b.stops} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** A pre-geocoded map block — viewport with the Google-Maps hand-off floating
 *  inside the frame (a corner chip), so the map is one self-contained tile with
 *  no separate link bar underneath. */
function MapRender({ ordered, stops }: { ordered: boolean; stops: MapStop[] }) {
  if (stops.length === 0) return null;
  const routable = ordered && stops.length > 1;
  return (
    <div className="jz-map-block">
      <div className="jz-map-block-frame">
        <MapViewport stops={stops} ordered={ordered} interactive={false} />
        <a
          className="jz-map-block-cta"
          href={routable ? googleMapsRouteUrl(stops) : googleMapsUrl(stops[0]!)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          ➤ {routable ? 'Open route' : 'Open in Google Maps'}
        </a>
      </div>
    </div>
  );
}
