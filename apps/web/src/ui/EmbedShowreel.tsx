/**
 * The hero showreel (?embed=1) — a perpetual, non-interactive loop that tells
 * Jarwiz's core story with the REAL product pieces: real card shapes (link,
 * table, doc, diagram, note, pdf), real connector arrows, real provenance
 * lineage, the real collaborator-cursor look, and the real proactive-comment
 * popover. Nothing here is a mock render.
 *
 * The film, looped forever (the camera moves like the real product):
 *   1. WIDE — a genuinely busy research board: source link-cards, two tables, a
 *      recommendation doc, research notes, a decision flow diagram, sticky
 *      notes, all wired together with connector arrows + provenance lineage.
 *   2. The Maker drops a **PDF** of canonical evidence; the camera pushes IN.
 *   3. **Jarwiz** flies over and *reads* it (the real "reading…" behaviour).
 *   4. The camera FOLLOWS Jarwiz's cursor as it travels to the comparison table
 *      and pins a **discrepancy comment** (a row is on last year's price).
 *   5. **“Let Jarwiz fix it”** — the stale cell backspaces and the corrected
 *      value STREAMS back in, like a real generation.
 *   6. The camera pulls back to the wide board and the loop resets.
 *
 * It is a *showreel*: pointer-events:none, never hands off (visitors click
 * "Try it free"). Every beat recomputes its anchors from the live camera, so
 * cursors and the comment stay pinned to their cards through the pans.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, createShapeId, useEditor, type TLShapeId } from 'tldraw';
import { Sparkles, Wand2, Scale } from 'lucide-react';
import { setShapeTitle } from '../shapes/shapeTitle';
import { PROV_META_KEY } from '../ask/useAsk';

// ── The canned research board ──────────────────────────────────────────────
// One stale cell (`STALE`) is the whole story: the table quotes last year's
// Pipedrive price; the evidence PDF says otherwise; the fix streams it to `TRUE`.
const STALE = '$14';
const TRUE = '$19';

const LINKS = [
  { url: 'https://www.g2.com/categories/crm', siteName: 'G2', title: 'Best CRM Software in 2026', description: 'Ranked across 180 products.' },
  { url: 'https://saasledger.com/crm-pricing-2026', siteName: 'SaaS Ledger', title: 'The 2026 CRM Pricing Teardown', description: 'Per-seat list prices for 2026.' },
  { url: 'https://kalungi.com/pipedrive-vs-attio', siteName: 'Kalungi', title: 'Pipedrive vs. Attio vs. HubSpot', description: 'A comparison for small teams.' },
  { url: 'https://nutshell.com/crm-buyers-guide', siteName: 'Nutshell', title: 'CRM Buyer’s Guide (2026)', description: 'How to choose without overpaying.' },
];

const TABLE = {
  columns: ['CRM', 'Plan', 'Price / seat', 'Best for', 'G2'],
  baseRows: [
    ['HubSpot', 'Free CRM', '$0', 'All-in-one', '4.4'],
    ['Pipedrive', 'Essential', STALE, 'Small teams', '4.5'],
    ['Attio', 'Plus', '$29', 'Startups', '4.6'],
    ['Salesforce', 'Starter', '$25', 'Enterprise', '4.3'],
    ['Zoho', 'Standard', '$18', 'Budget', '4.1'],
    ['Folk', 'Pro', '$20', 'Networkers', '4.2'],
  ],
};

const TABLE2 = {
  columns: ['Feature', 'HubSpot', 'Pipedrive', 'Attio'],
  rows: [
    ['Free tier', 'Yes', 'No', 'No'],
    ['Open API', 'Paid', 'Yes', 'Yes'],
    ['Custom objects', 'Paid', 'No', 'Yes'],
    ['Email sync', 'Yes', 'Yes', 'Yes'],
  ],
};

const DOC_TEXT =
  '## Recommendation\n\n' +
  '**Pipedrive** is the pick for a small, growing sales team — it scales from a single seat with no tier wall, and its pipeline view is the cleanest of the shortlist.\n\n' +
  '- **Runner-up — Attio.** A modern data model and slick automations, if the price fits.\n' +
  '- **Skip for now — Salesforce.** Powerful, but heavy for a team under ten.\n\n' +
  '_Revisit once you cross ~15 seats or need marketing automation._';

const NOTES_DOC =
  '## Research notes\n\n' +
  '**Sources reviewed**\n' +
  '- G2 — *Best CRM Software 2026*, 1,400+ reviews [1]\n' +
  '- SaaS Ledger — *2026 Pricing Teardown* [2]\n' +
  '- Kalungi — *Pipedrive vs. Attio vs. HubSpot* [3]\n' +
  '- Nutshell — *CRM Buyer’s Guide* [4]\n\n' +
  '**Requirements**\n' +
  '- Team: 4 seats today → ~12 by Q4.\n' +
  '- Must-have: clean pipeline view + open API.\n' +
  '- Budget ceiling: **$25 / seat / mo**.\n\n' +
  '**Open questions**\n' +
  '- Pipedrive 2026 list price — confirm vs. teardown [2].\n' +
  '- Seat floors on annual plans — ask sales.\n\n' +
  '_Last updated 4 Jan 2026 · 6 sources cited_';

const DIAGRAM = `flowchart TD
  A[Shortlist CRMs] --> B{Free tier?}
  B -->|Yes| C[Trial HubSpot]
  B -->|No| D[Trial Pipedrive]
  C --> E[Compare pricing]
  D --> E
  E --> F{Under $25/seat?}
  F -->|No| G[Negotiate]
  G --> D
  F -->|Yes| H{Open API?}
  H -->|No| I[Flag risk]
  H -->|Yes| J{Scales to 15 seats?}
  I --> J
  J -->|No| D
  J -->|Yes| K[Shortlist ✓]
  K --> L{Team approves?}
  L -->|No| A
  L -->|Yes| M[Decide]`;

const STICKIES = ['Double-check the 2026 pricing — sheet due Friday', 'Ask sales about seat floors before we commit'];

const COMMENT_BODY = `The 2026 pricing sheet lists Pipedrive Essential at ${TRUE}/seat — this row still shows ${STALE}, last year's price.`;

// Fixed page-space layout — a sprawling workspace. The board is built ONCE; the
// loop only drops/removes the PDF and streams the one cell, so the heavy shapes
// (mermaid, link previews) render a single time.
// Generous spacing: link- and doc-cards auto-grow to fit their content, so we
// leave wide gutters between every card and pick heights that comfortably fit
// the text — otherwise a grown card would overlap its neighbour.
const L = {
  // Staggered, not a rigid grid — offset x/y so the sources feel scattered like
  // a real board. Compact heights (no media band now) keep them clear of the
  // feature matrix below.
  links: [
    { x: -980, y: -540, w: 270, h: 110 },
    { x: -660, y: -585, w: 270, h: 110 },
    { x: -1010, y: -360, w: 270, h: 110 },
    { x: -640, y: -395, w: 270, h: 110 },
  ],
  table2: { x: -980, y: -150, w: 470, h: 270 },
  table: { x: 0, y: -200, w: 600, h: 330 },
  doc: { x: 770, y: -210, w: 320, h: 420 },
  notes: { x: 770, y: 300, w: 340, h: 400 },
  diagram: { x: 30, y: 220, w: 600, h: 430 },
  // The hand-drawn whiteboard the flow diagram was digitised from — an image
  // card, sitting just left of the diagram and feeding it as a source.
  sketch: { x: -460, y: 250, w: 400, h: 300 },
  stickies: [
    { x: 780, y: -360, w: 220, h: 110 },
    { x: -300, y: 600, w: 230, h: 140 },
  ],
  pdf: { x: 1200, y: -200, w: 300, h: 420 },
};

const PDF_URL = `${import.meta.env.BASE_URL}evidence-pricing.pdf`;
const SKETCH_URL = `${import.meta.env.BASE_URL}sketch-flow.jpg`;

interface Cursor {
  x: number;
  y: number;
  visible: boolean;
  status: string | null;
}
const HIDDEN: Cursor = { x: 0, y: 0, visible: false, status: null };

export function EmbedShowreel() {
  const editor = useEditor();
  const rootRef = useRef<HTMLDivElement>(null);
  const fixBtnRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const ids = useRef<{ table: TLShapeId; diagram: TLShapeId; pdf: TLShapeId } | null>(null);

  const [you, setYou] = useState<Cursor>(HIDDEN);
  const [jz, setJz] = useState<Cursor>(HIDDEN);
  const [comment, setComment] = useState<{ x: number; y: number; open: boolean } | null>(null);
  // A rotating "scanning" border drawn over the PDF card while Jarwiz parses it.
  const [parse, setParse] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // A one-shot click ripple at a point (keyed so each click replays the animation).
  const [click, setClick] = useState<{ x: number; y: number; n: number } | null>(null);
  const clickSeq = useRef(0);
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? Math.min(ms, 300) : ms) as unknown as number;
      timers.current.push(t);
    };
    const clearTimers = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    const vp = (px: number, py: number) => editor.pageToViewport({ x: px, y: py });
    const rectCenter = (el: HTMLElement | null) => {
      const root = rootRef.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 };
    };

    // Camera framings the film pans between.
    // Three distinct framings. drop and table are tight and DON'T overlap, so
    // travelling between them reads as a real camera pan (following Jarwiz across
    // the board), not an imperceptible zoom nudge.
    const FRAME = {
      wide: new Box(-1030, -600, 2560, 1330), // the whole busy board
      drop: new Box(760, -200, 900, 620), // pushed in on the doc + dropped PDF (right side)
      table: new Box(-150, -180, 900, 540), // tight on the comparison table (left of it)
    };
    const panTo = (b: Box, ms: number) =>
      editor.zoomToBounds(b, { inset: 40, animation: { duration: reduce ? 0 : ms } });

    const rowsWith = (price: string): string[][] =>
      TABLE.baseRows.map((r) => {
        if (r[0] !== 'Pipedrive') return r;
        const copy = [...r];
        copy[2] = price;
        return copy;
      });

    // ── Build the whole board once ──────────────────────────────────────────
    const seed = () => {
      const existing = [...editor.getCurrentPageShapeIds()];
      if (existing.length) editor.deleteShapes(existing);

      const linkIds = L.links.map(() => createShapeId());
      const table = createShapeId();
      const table2 = createShapeId();
      const doc = createShapeId();
      const notes = createShapeId();
      const diagram = createShapeId();
      const sketch = createShapeId();
      const stickyIds = L.stickies.map(() => createShapeId());
      const pdf = createShapeId();
      ids.current = { table, diagram, pdf };

      L.links.forEach((pos, i) => {
        const src = LINKS[i]!;
        editor.createShape({
          id: linkIds[i]!,
          type: 'link-card',
          x: pos.x,
          y: pos.y,
          props: { w: pos.w, h: pos.h, url: src.url, title: src.title, description: src.description, image: '', favicon: '', siteName: src.siteName, loading: false },
        });
      });
      editor.createShape({ id: table, type: 'table-card', x: L.table.x, y: L.table.y, props: { w: L.table.w, h: L.table.h, columns: TABLE.columns, rows: rowsWith(STALE) } });
      editor.createShape({ id: table2, type: 'table-card', x: L.table2.x, y: L.table2.y, props: { w: L.table2.w, h: L.table2.h, columns: TABLE2.columns, rows: TABLE2.rows } });
      editor.createShape({ id: doc, type: 'doc-card', x: L.doc.x, y: L.doc.y, props: { w: L.doc.w, h: L.doc.h, title: 'Recommendation', text: DOC_TEXT } });
      editor.createShape({ id: notes, type: 'doc-card', x: L.notes.x, y: L.notes.y, props: { w: L.notes.w, h: L.notes.h, title: 'Research notes', text: NOTES_DOC } });
      editor.createShape({ id: diagram, type: 'diagram-card', x: L.diagram.x, y: L.diagram.y, props: { w: L.diagram.w, h: L.diagram.h, code: DIAGRAM, title: 'Evaluation flow' } });
      editor.createShape({ id: sketch, type: 'image-card', x: L.sketch.x, y: L.sketch.y, props: { w: L.sketch.w, h: L.sketch.h, src: SKETCH_URL, name: 'Whiteboard — evaluation flow' } });
      L.stickies.forEach((pos, i) => {
        editor.createShape({ id: stickyIds[i]!, type: 'note-card', x: pos.x, y: pos.y, props: { w: pos.w, h: pos.h, text: STICKIES[i]!, color: '' } });
      });

      // Titles that ride on meta (tables have no title prop).
      const t = editor.getShape(table);
      if (t) setShapeTitle(editor, t, 'CRM shortlist');
      const t2 = editor.getShape(table2);
      if (t2) setShapeTitle(editor, t2, 'Feature matrix');

      // Connections are shown as the product's own PROVENANCE lineage (the subtle
      // dotted hairlines), not solid connector arrows: the table was built FROM
      // the four sources and the feature matrix; the recommendation and notes
      // were built FROM the table. Selecting the table draws every hop as a
      // dotted line, which is the whole web of work in one gesture.
      editor.updateShape({ id: table, type: 'table-card', meta: { [PROV_META_KEY]: [...linkIds, table2] } });
      editor.updateShape({ id: doc, type: 'doc-card', meta: { [PROV_META_KEY]: [table] } });
      editor.updateShape({ id: notes, type: 'doc-card', meta: { [PROV_META_KEY]: [table] } });
      // The flow diagram was digitised FROM the hand-drawn whiteboard sketch.
      editor.updateShape({ id: diagram, type: 'diagram-card', meta: { [PROV_META_KEY]: [sketch] } });

      panTo(FRAME.wide, 0);
    };

    const dropPdf = () => {
      if (!ids.current) return;
      editor.createShape({
        id: ids.current.pdf,
        type: 'pdf-card',
        x: L.pdf.x,
        y: L.pdf.y,
        props: { w: L.pdf.w, h: L.pdf.h, src: PDF_URL, assetId: '', name: 'Vendor Pricing 2026', pages: 1, status: 'ready' },
      });
    };
    const clearPdf = () => {
      if (ids.current && editor.getShape(ids.current.pdf)) editor.deleteShapes([ids.current.pdf]);
    };
    const setPrice = (price: string) => {
      if (!ids.current) return;
      editor.updateShape({ id: ids.current.table, type: 'table-card', props: { rows: rowsWith(price) } });
    };

    // Fire a click ripple at a viewport point.
    const clickAt = (p: { x: number; y: number }) => {
      clickSeq.current += 1;
      setClick({ x: p.x, y: p.y, n: clickSeq.current });
    };
    // The PDF card's rectangle in viewport space, for the rotating scan border.
    const pdfHaloRect = () => {
      if (!ids.current) return null;
      const b = editor.getShapePageBounds(ids.current.pdf);
      if (!b) return null;
      const tl = editor.pageToViewport({ x: b.x, y: b.y });
      const br = editor.pageToViewport({ x: b.x + b.w, y: b.y + b.h });
      return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    };

    // ── One pass of the film ────────────────────────────────────────────────
    // Deliberately unhurried: each beat gets room to read. The PDF is dropped,
    // Jarwiz selects + scans it (a rotating border, ~5.5s), travels to the table
    // and clicks it (comment appears at the cursor), the Maker opens the comment
    // and clicks "fix", Jarwiz streams the correction, then the PDF is removed
    // just before the pull-back so the wide board matches the loop's start.
    const run = () => {
      clearPdf();
      setPrice(STALE);
      setComment(null);
      setParse(null);
      setClick(null);
      setYou(HIDDEN);
      setJz(HIDDEN);
      // Keep the table AND the flow diagram selected for the WHOLE loop so both
      // dotted provenance webs stay drawn (selection chrome is transparent).
      if (ids.current) editor.select(ids.current.table, ids.current.diagram);
      panTo(FRAME.wide, 0);

      const pdfC = () => vp(L.pdf.x + L.pdf.w * 0.3, L.pdf.y + L.pdf.h * 0.42);
      const priceCell = () => vp(L.table.x + L.table.w * 0.46, L.table.y + L.table.h * 0.33);
      // Where the comment gets pinned — captured when Jarwiz clicks the cell so
      // the popover (and the Maker's cursor) stay exactly on that spot.
      let commentPt = { x: 0, y: 0 };

      // 1) WIDE establishing shot — let the busy board breathe.
      // 2) Push in on the drop zone; the Maker drops the PDF.
      after(2600, () => panTo(FRAME.drop, 1500));
      after(4400, () => { const p = pdfC(); setYou({ x: p.x, y: p.y + 170, visible: true, status: 'dropping evidence…' }); });
      after(5200, () => { const p = pdfC(); setYou({ x: p.x, y: p.y + 44, visible: true, status: 'dropping evidence…' }); });
      after(5700, () => { dropPdf(); const p = pdfC(); clickAt(p); setYou({ x: p.x + 26, y: p.y + 18, visible: true, status: null }); });
      after(6300, () => setYou(HIDDEN));

      // 3) Jarwiz flies in, SELECTS the card, and scans it (~5.5s of rotating
      //    border) while it parses the evidence.
      after(6600, () => { const p = pdfC(); setJz({ x: p.x, y: p.y, visible: true, status: 'reading the evidence…' }); });
      after(7200, () => setParse(pdfHaloRect()));
      after(9000, () => setJz((c) => ({ ...c, status: 'cross-checking the prices…' })));
      after(11000, () => setJz((c) => ({ ...c, status: 'found a mismatch…' })));
      after(12600, () => setParse(null));

      // 4) Camera FOLLOWS Jarwiz to the table; it clicks the stale cell and pins
      //    the comment right where the cursor lands.
      after(12700, () => { panTo(FRAME.table, 1500); setJz((c) => ({ ...c, status: 'following the trail…' })); });
      after(14500, () => { const c = priceCell(); setJz({ x: c.x, y: c.y, visible: true, status: 'flagging it…' }); });
      after(15300, () => { const c = priceCell(); commentPt = c; clickAt(c); setComment({ x: c.x, y: c.y, open: false }); });
      after(15900, () => setJz(HIDDEN));

      // 5) The Maker goes over, opens the comment, and clicks "Let Jarwiz fix it".
      after(16900, () => setYou({ x: commentPt.x + 8, y: commentPt.y + 10, visible: true, status: null }));
      after(17600, () => { clickAt(commentPt); setComment((s) => (s ? { ...s, open: true } : s)); });
      after(18800, () => { const b = rectCenter(fixBtnRef.current); const t = b ?? { x: commentPt.x + 40, y: commentPt.y + 150 }; setYou({ x: t.x, y: t.y, visible: true, status: null }); });
      after(19600, () => { const b = rectCenter(fixBtnRef.current); if (b) clickAt(b); });

      // 6) Jarwiz fixes it — the stale cell backspaces, then the value STREAMS in.
      after(19900, () => { const p = priceCell(); setJz({ x: p.x, y: p.y, visible: true, status: 'fixing…' }); setComment(null); });
      const STREAM = ['$1', '$', '', '$', '$1', TRUE];
      const STREAM_STEP = 110;
      STREAM.forEach((v, i) => after(20200 + i * STREAM_STEP, () => setPrice(v)));
      const streamEnd = 20200 + STREAM.length * STREAM_STEP;
      after(streamEnd + 200, () => { const p = priceCell(); setJz({ x: p.x, y: p.y, visible: true, status: 'fixed ✓' }); setYou(HIDDEN); });

      // 7) Settle on the fix, hide the PDF BEFORE the pull-back (so the wide board
      //    matches the loop's start), then a slow pull-back and loop.
      after(streamEnd + 2000, () => setJz(HIDDEN));
      after(streamEnd + 2400, () => clearPdf());
      after(streamEnd + 2700, () => panTo(FRAME.wide, 1600));
      after(streamEnd + 5200, run);
    };

    seed();
    after(500, run);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div ref={rootRef} className="jz-showreel" aria-hidden="true">
      {parse ? (
        <div
          className="jz-parse-halo"
          style={{ left: parse.left, top: parse.top, width: parse.width, height: parse.height }}
        />
      ) : null}
      <ScriptedCursor cursor={you} label="You" you />
      <ScriptedCursor cursor={jz} label="Jarwiz" />
      {comment ? <ShowreelComment pos={comment} open={comment.open} fixRef={fixBtnRef} /> : null}
      {click ? <span key={click.n} className="jz-click-ring" style={{ left: click.x, top: click.y }} /> : null}
    </div>
  );
}

function ScriptedCursor({ cursor, label, you = false }: { cursor: Cursor; label: string; you?: boolean }) {
  return (
    <div
      className={`jz-avatar jz-avatar--scripted jz-avatar--jarwiz${you ? ' jz-avatar--you' : ''}${
        cursor.status ? '' : ' jz-avatar--idle'
      }${cursor.visible ? '' : ' jz-avatar--hidden'}`}
      style={{ transform: `translate(${cursor.x - 4}px, ${cursor.y - 3}px)` }}
    >
      <svg className="jz-cursor-arrow" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" />
      </svg>
      <div className="jz-avatar-badge">
        <span className="jz-avatar-name">{label}</span>
        {cursor.status ? (
          <span key={cursor.status} className="jz-avatar-status">
            {cursor.status}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The proactive-comment popover, reusing the product's own `.jz-comment*`
 *  design. Non-interactive here (the loop drives it) — the fix button is real
 *  markup so the "You" cursor can land on it. */
function ShowreelComment({
  pos,
  open,
  fixRef,
}: {
  pos: { x: number; y: number };
  open: boolean;
  fixRef: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="jz-comment" style={{ left: pos.x, top: pos.y }}>
      <button className={`jz-comment-pin jz-comment-pin--tension${open ? ' jz-comment-pin--open' : ''}`}>
        <Sparkles size={12} />
      </button>
      {open ? (
        <div className="jz-comment-pop">
          <div className="jz-comment-head">
            <span className="jz-comment-avatar">
              <Sparkles size={12} />
            </span>
            <span className="jz-comment-name">Jarwiz</span>
            <span className="jz-comment-kind jz-comment-kind--tension">
              <Scale size={12} />
              Tension
            </span>
          </div>
          <div className="jz-comment-body">{COMMENT_BODY}</div>
          <div className="jz-comment-actions">
            <button ref={fixRef} className="jz-comment-fix">
              <Wand2 size={13} /> Let Jarwiz fix it
            </button>
            <button className="jz-comment-dismiss">Dismiss</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
