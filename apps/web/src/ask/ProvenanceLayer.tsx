/**
 * Provenance overlay — an answer's lineage, shown only on demand. The canvas
 * used to carry a persistent dotted arrow per source→answer link; those read
 * as clutter (owner call, 2026-07-05). Now nothing is drawn until you CLICK a
 * card: select an answer and a very subtle hairline dotted line reaches back
 * to each source it was built from; select a source and the lines reach
 * forward to the answers that cite it. Lineage lives on the card
 * (`meta.jzSources`, written by useAsk.recordSources) so it survives reload.
 *
 * This is a pointer-transparent SVG in viewport space — it never intercepts
 * clicks and it pans/zooms with the board via reactive recomputation.
 */

import { useEditor, useValue } from 'tldraw';
import { PROV_META_KEY } from './useAsk';

interface Link {
  d: string;
  /** The source end — a faint dot marks where the lineage starts. */
  sx: number;
  sy: number;
}

/** Midpoint of the edge of `a` that faces `b`, in page space. */
function facingAnchor(
  a: { x: number; y: number; w: number; h: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? a.x + a.w : a.x, y: cy };
  }
  return { x: cx, y: dy >= 0 ? a.y + a.h : a.y };
}

export function ProvenanceLayer() {
  const editor = useEditor();

  const links = useValue<Link[]>(
    'provenance-links',
    () => {
      const selected = editor.getSelectedShapeIds();
      if (selected.length === 0) return [];

      // Collect source→answer pairs touching any selected card, both ways.
      const pairs = new Set<string>(); // `${fromId}|${toId}`, from = source
      const onPage = editor.getCurrentPageShapes();
      for (const sel of selected) {
        const shape = editor.getShape(sel);
        const own = (shape?.meta?.[PROV_META_KEY] as string[] | undefined) ?? [];
        for (const src of own) pairs.add(`${src}|${sel}`); // answer selected → its sources
      }
      for (const s of onPage) {
        const srcs = (s.meta?.[PROV_META_KEY] as string[] | undefined) ?? [];
        if (srcs.length === 0) continue;
        for (const sel of selected) {
          if (srcs.includes(sel)) pairs.add(`${sel}|${s.id}`); // source selected → answers
        }
      }
      if (pairs.size === 0) return [];

      const out: Link[] = [];
      for (const key of pairs) {
        const [fromId, toId] = key.split('|') as [string, string];
        const fb = editor.getShapePageBounds(fromId as never);
        const tb = editor.getShapePageBounds(toId as never);
        if (!fb || !tb) continue;
        // Page-space coordinates — the layer renders inside tldraw's camera
        // transform (OnTheCanvas), *behind* the shapes, so cards occlude the
        // lines and only the connecting segments in the gaps show.
        const a = facingAnchor(fb, { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 });
        const b = facingAnchor(tb, { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 });
        // A gentle S-curve: control points pulled along the dominant axis so
        // the line eases out of one card and into the other.
        const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        const k = 0.42;
        const c1 = horizontal ? { x: a.x + (b.x - a.x) * k, y: a.y } : { x: a.x, y: a.y + (b.y - a.y) * k };
        const c2 = horizontal ? { x: b.x - (b.x - a.x) * k, y: b.y } : { x: b.x, y: b.y - (b.y - a.y) * k };
        out.push({
          d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
          sx: a.x,
          sy: a.y,
        });
      }
      return out;
    },
    [editor],
  );

  if (links.length === 0) return null;

  return (
    <svg className="jz-prov-layer" viewBox="-50000 -50000 100000 100000" aria-hidden>
      {links.map((l, i) => (
        <g key={i}>
          <path className="jz-prov-line" d={l.d} />
          <circle className="jz-prov-dot" cx={l.sx} cy={l.sy} r={2} />
        </g>
      ))}
    </svg>
  );
}
