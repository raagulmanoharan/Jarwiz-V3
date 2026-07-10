/**
 * Rich table cells — what makes the table multipurpose (a tour itinerary with
 * links and photos, a vendor matrix with sources), not just a comparison grid.
 * Cells STAY plain strings (schema, backup, search, and autopilot all keep
 * seeing text); the static renderer understands a minimal inline markdown:
 *
 *   ![alt](src)      → thumbnail image (https / data:image / /api/assets only)
 *   [label](url)     → link chip (https only)
 *   bare https URL   → link chip labelled with its hostname
 *   **bold** *italic* __underline__ ~~strike~~ — the format bar's vocabulary
 *   newline          → line break
 *
 * Anything unsafe or unrecognized renders as the literal text it is.
 */

import { Fragment, type ReactNode } from 'react';
import { stopEventPropagation } from 'tldraw';

const TOKEN_RE =
  /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|__([^_\n]+?)__|~~([^~\n]+?)~~|(https?:\/\/[^\s)<>"']+)/g;

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

function safeImgSrc(url: string): string | null {
  // A remote URL routes through the server's cache-proxy (/api/image): the
  // table generator caches images it can reach at build time, but any URL
  // that slipped through raw (offline build, older card) would hotlink —
  // fragile against hotlink protection / CORS / the source dying.
  if (/^https?:\/\//i.test(url)) return `/api/image?src=${encodeURIComponent(url)}`;
  return /^(data:image\/|\/api\/assets\/)/i.test(url) ? url : null;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function CellLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="jz-table-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      style={{ pointerEvents: 'all' }}
      onPointerDown={stopEventPropagation}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

/** Plain-text segments drop stray '**' — a streaming cell holds an unclosed
 *  bold marker until its pair arrives, and a model occasionally leaves one
 *  behind; literal asterisk-noise should never reach the reader. */
function plain(segment: string): string {
  return segment.replace(/\*\*/g, '');
}

function renderLine(line: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(plain(line.slice(last, idx)));
    const [whole, imgAlt, imgSrc, linkLabel, linkHref, bold, italic, underline, strike, bareUrl] = m;
    if (imgSrc !== undefined) {
      const src = safeImgSrc(imgSrc);
      parts.push(
        src ? (
          <img
            key={n++}
            className="jz-table-img"
            src={src}
            alt={imgAlt ?? ''}
            loading="lazy"
            // A dead image hides rather than showing a broken frame — same
            // degrade-to-nothing rule as the rich card's Image component.
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          whole
        ),
      );
    } else if (linkHref !== undefined) {
      const href = safeHref(linkHref);
      parts.push(href ? <CellLink key={n++} href={href} label={linkLabel!} /> : whole);
    } else if (bold !== undefined) {
      parts.push(<strong key={n++}>{bold}</strong>);
    } else if (italic !== undefined) {
      parts.push(<em key={n++}>{italic}</em>);
    } else if (underline !== undefined) {
      parts.push(<u key={n++}>{underline}</u>);
    } else if (strike !== undefined) {
      parts.push(<s key={n++}>{strike}</s>);
    } else if (bareUrl !== undefined) {
      const href = safeHref(bareUrl);
      parts.push(href ? <CellLink key={n++} href={href} label={hostLabel(bareUrl)} /> : whole);
    }
    last = idx + whole.length;
  }
  if (last < line.length) parts.push(plain(line.slice(last)));
  return <Fragment key={key}>{parts}</Fragment>;
}

/** Render one cell's string as rich content. */
export function renderRichCell(text: string): ReactNode {
  if (!text) return text;
  const lines = text.split('\n');
  if (lines.length === 1) return renderLine(text, 0);
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {renderLine(line, i)}
    </Fragment>
  ));
}
