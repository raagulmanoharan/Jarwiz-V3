/**
 * Card focus mode — any non-text card opened full-screen over a darkened board
 * (the doc card gets its own rich editor, DocFocusOverlay; this is the READ
 * presentation for everything else). A dashboard fills the screen, an image
 * becomes a lightbox, a PDF/prototype gets room to breathe, a table/sheet is
 * legible edge to edge. Read-only by design — the canvas card stays the source
 * of truth. Opened from the refine bar's ⤢ Expand; Esc or the backdrop closes.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue, type TLShape } from 'tldraw';
import { X, ExternalLink } from 'lucide-react';
import { Renderer } from '@openuidev/react-lang';
import type { MapStop } from '@jarwiz/shared';
import { getShapeTitle } from '../shapes/shapeTitle';
import { googleMapsRouteUrl, googleMapsUrl, MapViewport } from '../shapes/mapView';
import { dashboardLibrary } from '../dashboard/library';
import { renderMermaid } from '../lib/mermaid';
import { closeCardFocus, getCardFocus, subscribeCardFocus } from './focusCard';

/** Card types that open in this presentation overlay (doc-card is handled by
 *  the rich editor overlay instead; stickies are annotations, not artifacts). */
const FOCUSABLE = new Set([
  'dashboard-card',
  'table-card',
  'sheet-card',
  'prototype-card',
  'image-card',
  'pdf-card',
  'diagram-card',
  'youtube-card',
  'link-card',
  'map-card',
]);

/** Which types this overlay knows how to render — the same set, exported so the
 *  refine bar offers ⤢ Expand exactly where a full-screen view exists. */
export function canFocusCard(type: string): boolean {
  return type === 'doc-card' || FOCUSABLE.has(type);
}

function stripFences(html: string): string {
  return html.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/i, '');
}

export function CardFocusOverlay() {
  const editor = useEditor();
  const focusId = useSyncExternalStore(subscribeCardFocus, getCardFocus, getCardFocus);
  const shape = useValue(
    'card-focus-shape',
    () => (focusId ? editor.getShape(focusId) : undefined),
    [editor, focusId],
  );

  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCardFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId]);

  if (!focusId || !shape || !FOCUSABLE.has(shape.type)) return null;
  const title = getShapeTitle(shape) || 'Card';

  return (
    <div
      className="jz-focus-backdrop"
      onPointerDown={(e) => {
        stopEventPropagation(e);
        if (e.target === e.currentTarget) closeCardFocus();
      }}
      onWheelCapture={stopEventPropagation}
    >
      <div className="jz-cardfocus-page" role="dialog" aria-label="Full-screen view">
        <div className="jz-cardfocus-head">
          <span className="jz-focus-title" title={title}>{title}</span>
          <button
            className="jz-cardbar-iconbtn jz-focus-close"
            title="Close (Esc)"
            aria-label="Close full-screen view"
            onClick={closeCardFocus}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="jz-cardfocus-stage">
          <FocusBody shape={shape} />
        </div>
      </div>
    </div>
  );
}

function FocusBody({ shape }: { shape: TLShape }) {
  switch (shape.type) {
    case 'dashboard-card':
      return <DashboardFocus shape={shape} />;
    case 'prototype-card':
      return <PrototypeFocus shape={shape} />;
    case 'image-card':
      return <ImageFocus shape={shape} />;
    case 'pdf-card':
      return <PdfFocus shape={shape} />;
    case 'table-card':
      return <TableFocus shape={shape} />;
    case 'sheet-card':
      return <SheetFocus shape={shape} />;
    case 'diagram-card':
      return <DiagramFocus shape={shape} />;
    case 'youtube-card':
      return <YouTubeFocus shape={shape} />;
    case 'link-card':
      return <LinkFocus shape={shape} />;
    case 'map-card':
      return <MapFocus shape={shape} />;
    default:
      return null;
  }
}

/** The trip view (docs/MAPS.md P1): map left, itinerary rail right. Rows
 *  group by the stops' own day labels; hovering a row lifts its pin and the
 *  camera eases to it. "Open route" hands the whole ordered plan to Google
 *  Maps navigation — one free link, no API. */
function MapFocus({ shape }: { shape: TLShape }) {
  const { intro, stops, ordered } = shape.props as {
    intro: string;
    stops: MapStop[];
    ordered: boolean;
  };
  const [active, setActive] = useState<number | null>(null);

  // Preserve the stops' own day labels in first-appearance order; unlabelled
  // stops group under no header (a places shortlist has no days at all).
  const groups: Array<{ day: string | null; items: Array<{ stop: MapStop; index: number }> }> = [];
  stops.forEach((stop, index) => {
    const day = stop.day?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push({ stop, index });
    else groups.push({ day, items: [{ stop, index }] });
  });

  return (
    <div className="jz-mapfocus">
      <div className="jz-mapfocus-map">
        <MapViewport stops={stops} ordered={ordered} interactive activeIndex={active} />
      </div>
      <div className="jz-mapfocus-rail" onMouseLeave={() => setActive(null)}>
        <div className="jz-mapfocus-railhead">
          {intro ? <p className="jz-mapfocus-intro">{intro}</p> : null}
          <a
            className="jz-mapfocus-route"
            href={ordered && stops.length > 1 ? googleMapsRouteUrl(stops) : stops[0] ? googleMapsUrl(stops[0]) : '#'}
            target="_blank"
            rel="noopener noreferrer"
          >
            ➤ {ordered && stops.length > 1 ? 'Open route' : 'Open in Google Maps'}
          </a>
        </div>
        <div className="jz-mapfocus-rows">
          {groups.map((group, gi) => (
            <div key={`g-${gi}`}>
              {group.day ? <div className="jz-mapfocus-group">{group.day}</div> : null}
              {group.items.map(({ stop, index }) => (
                <button
                  key={`row-${index}`}
                  className={`jz-mapfocus-row${index === active ? ' jz-mapfocus-row--active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                >
                  {stop.time ? <span className="jz-mapfocus-when">{stop.time}</span> : null}
                  <span className="jz-mapfocus-what">
                    <span className="jz-mapfocus-name">
                      {stops.length > 1 ? <span className="jz-mapfocus-n">{index + 1}</span> : null}
                      {stop.name}
                      {stop.approx ? <span className="jz-mapfocus-approx">location approximate</span> : null}
                    </span>
                    {stop.note ? <span className="jz-mapfocus-note">{stop.note}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="jz-mapfocus-railfoot">
          <span>{stops.length} stop{stops.length === 1 ? '' : 's'}</span>
          <span>map data © OpenStreetMap</span>
        </div>
      </div>
    </div>
  );
}

function DashboardFocus({ shape }: { shape: TLShape }) {
  const { spec } = shape.props as { spec: string };
  return (
    <div className="jz-cardfocus-scroll jzd-root" data-status="done">
      <div className="jzd-scroll">
        <Renderer response={spec} library={dashboardLibrary} isStreaming={false} />
      </div>
    </div>
  );
}

function PrototypeFocus({ shape }: { shape: TLShape }) {
  const { html } = shape.props as { html: string };
  return (
    <iframe
      className="jz-cardfocus-frame"
      title="Prototype"
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      srcDoc={stripFences(html || '')}
    />
  );
}

function ImageFocus({ shape }: { shape: TLShape }) {
  const { src, name } = shape.props as { src: string; name: string };
  return (
    <div className="jz-cardfocus-center">
      {src ? <img className="jz-cardfocus-img" src={src} alt={name || ''} draggable={false} /> : null}
    </div>
  );
}

function PdfFocus({ shape }: { shape: TLShape }) {
  const { src, assetId } = shape.props as { src: string; assetId: string };
  const url = src || (assetId ? `/api/assets/${encodeURIComponent(assetId)}` : '');
  if (!url) return null;
  return <iframe className="jz-cardfocus-frame" title="PDF" src={`${url}#view=FitH`} />;
}

function DiagramFocus({ shape }: { shape: TLShape }) {
  const { code } = shape.props as { code: string };
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void renderMermaid(`jz-focus-mmd-${shape.id.replace(/[^a-z0-9]/gi, '')}`, code || '').then((res) => {
      if (alive) setSvg(res.svg ?? null);
    });
    return () => {
      alive = false;
    };
  }, [code, shape.id]);
  return (
    <div className="jz-cardfocus-center">
      {svg ? (
        <div className="jz-cardfocus-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="jz-cardfocus-empty">Rendering diagram…</div>
      )}
    </div>
  );
}

function TableFocus({ shape }: { shape: TLShape }) {
  const { columns, rows } = shape.props as { columns: string[]; rows: string[][] };
  return (
    <div className="jz-cardfocus-scroll">
      <FocusTable columns={columns ?? []} rows={rows ?? []} />
    </div>
  );
}

function SheetFocus({ shape }: { shape: TLShape }) {
  const { assetId } = shape.props as { assetId: string };
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    fetch(`/api/sheet/${encodeURIComponent(assetId)}/grid`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g: { sheets?: { rows: string[][] }[] } | null) => {
        if (!alive) return;
        const rows = g?.sheets?.[0]?.rows;
        if (rows?.length) setGrid(rows);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [assetId]);
  if (failed) return <div className="jz-cardfocus-empty">Couldn’t read this spreadsheet.</div>;
  if (!grid) return <div className="jz-cardfocus-empty">Reading…</div>;
  const [head, ...body] = grid;
  return (
    <div className="jz-cardfocus-scroll">
      <FocusTable columns={head ?? []} rows={body} />
    </div>
  );
}

function FocusTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <table className="jz-cardfocus-table">
      {columns.length ? (
        <thead>
          <tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{(Array.isArray(r) ? r : [r]).map((c, ci) => <td key={ci}>{String(c ?? '')}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function YouTubeFocus({ shape }: { shape: TLShape }) {
  const { videoId } = shape.props as { videoId: string };
  if (!videoId) return null;
  return (
    <iframe
      className="jz-cardfocus-frame"
      title="Video"
      src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

function LinkFocus({ shape }: { shape: TLShape }) {
  const p = shape.props as { url: string; title: string; description: string; image: string; siteName: string };
  return (
    <div className="jz-cardfocus-center">
      <div className="jz-cardfocus-link">
        {p.image ? <img className="jz-cardfocus-link-img" src={p.image} alt="" draggable={false} /> : null}
        <div className="jz-cardfocus-link-body">
          {p.siteName ? <div className="jz-cardfocus-link-site">{p.siteName}</div> : null}
          <div className="jz-cardfocus-link-title">{p.title || p.url}</div>
          {p.description ? <p className="jz-cardfocus-link-desc">{p.description}</p> : null}
          <a className="jz-cardfocus-link-open" href={p.url} target="_blank" rel="noreferrer">
            Open link <ExternalLink size={13} strokeWidth={2} />
          </a>
        </div>
      </div>
    </div>
  );
}
