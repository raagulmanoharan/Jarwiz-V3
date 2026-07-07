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
import { readingQuips } from '../agents/jarwizLife';
import { setShapeTitle } from '../shapes/shapeTitle';
import { createFlowEdge } from '../agents/flowLayout';
import { PROV_META_KEY } from '../ask/useAsk';

// ── The canned research board ──────────────────────────────────────────────
// One stale cell (`STALE`) is the whole story: the table quotes last year's
// Pipedrive price; the evidence PDF says otherwise; the fix streams it to `TRUE`.
const STALE = '$14';
const TRUE = '$19';

const LINKS = [
  { url: 'https://www.g2.com/categories/crm', siteName: 'G2', title: 'Best CRM Software in 2026', description: '1,400+ verified reviews across 180 products, scored on satisfaction.' },
  { url: 'https://saasledger.com/crm-pricing-2026', siteName: 'SaaS Ledger', title: 'The 2026 CRM Pricing Teardown', description: 'Per-seat list prices — what changed this year across the majors.' },
  { url: 'https://kalungi.com/pipedrive-vs-attio', siteName: 'Kalungi', title: 'Pipedrive vs. Attio vs. HubSpot', description: 'A hands-on comparison for small B2B sales teams.' },
  { url: 'https://nutshell.com/crm-buyers-guide', siteName: 'Nutshell', title: 'CRM Buyer’s Guide (2026)', description: 'How to choose your first real CRM without overpaying.' },
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
  '- Shortlisted 5 vendors from G2 + the pricing teardown.\n' +
  '- Team is 4 seats today, planning ~12 by Q4.\n' +
  '- Must-have: clean pipeline view and an open API.\n' +
  '- Budget ceiling: **$25 / seat**.';

const DIAGRAM = `flowchart TD
  A[Shortlist CRMs] --> B{Free tier?}
  B -->|Yes| C[Trial HubSpot]
  B -->|No| D[Trial Pipedrive]
  C --> E[Compare pricing]
  D --> E
  E --> F{Under budget?}
  F -->|Yes| G[Decide]
  F -->|No| D`;

const STICKIES = ['Double-check the 2026 pricing — sheet due Friday', 'Ask sales about seat floors before we commit'];

const COMMENT_BODY = `The 2026 pricing sheet lists Pipedrive Essential at ${TRUE}/seat — this row still shows ${STALE}, last year's price.`;

// Fixed page-space layout — a sprawling workspace. The board is built ONCE; the
// loop only drops/removes the PDF and streams the one cell, so the heavy shapes
// (mermaid, link previews) render a single time.
const L = {
  links: [
    { x: -780, y: -460, w: 250, h: 160 },
    { x: -500, y: -460, w: 250, h: 160 },
    { x: -780, y: -270, w: 250, h: 160 },
    { x: -500, y: -270, w: 250, h: 160 },
  ],
  table: { x: 0, y: 0, w: 600, h: 330 },
  table2: { x: -780, y: -30, w: 480, h: 290 },
  doc: { x: 700, y: 0, w: 320, h: 300 },
  notes: { x: 700, y: 340, w: 320, h: 230 },
  diagram: { x: 0, y: 400, w: 560, h: 320 },
  stickies: [
    { x: 640, y: -250, w: 210, h: 150 },
    { x: -240, y: 430, w: 220, h: 150 },
  ],
  pdf: { x: 1120, y: 20, w: 300, h: 420 },
};

const PDF_URL = `${import.meta.env.BASE_URL}evidence-pricing.pdf`;

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
  const ids = useRef<{ table: TLShapeId; pdf: TLShapeId } | null>(null);

  const [you, setYou] = useState<Cursor>(HIDDEN);
  const [jz, setJz] = useState<Cursor>(HIDDEN);
  const [comment, setComment] = useState<{ x: number; y: number; open: boolean } | null>(null);
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
    const FRAME = {
      wide: new Box(-820, -500, 2380, 1280), // the whole busy board
      drop: new Box(560, -140, 1040, 640), // pushed in on the PDF + table's right
      table: new Box(-180, -150, 960, 600), // settled on the comparison table
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
      const stickyIds = L.stickies.map(() => createShapeId());
      const pdf = createShapeId();
      ids.current = { table, pdf };

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
      L.stickies.forEach((pos, i) => {
        editor.createShape({ id: stickyIds[i]!, type: 'note-card', x: pos.x, y: pos.y, props: { w: pos.w, h: pos.h, text: STICKIES[i]!, color: '' } });
      });

      // Titles that ride on meta (tables have no title prop).
      const t = editor.getShape(table);
      if (t) setShapeTitle(editor, t, 'CRM shortlist');
      const t2 = editor.getShape(table2);
      if (t2) setShapeTitle(editor, t2, 'Feature matrix');

      // Real connector arrows — the visible edges that make it read as one
      // connected piece of work.
      createFlowEdge(editor, linkIds[0]!, table);
      createFlowEdge(editor, linkIds[1]!, table);
      createFlowEdge(editor, linkIds[2]!, table2);
      createFlowEdge(editor, linkIds[3]!, table2);
      createFlowEdge(editor, table2, table);
      createFlowEdge(editor, table, doc);
      createFlowEdge(editor, table, diagram);

      // Provenance lineage — the table was built FROM the sources; the doc FROM
      // the table. Selecting the table draws both hops with the product's lines.
      editor.updateShape({ id: table, type: 'table-card', meta: { [PROV_META_KEY]: [...linkIds, table2] } });
      editor.updateShape({ id: doc, type: 'doc-card', meta: { [PROV_META_KEY]: [table] } });

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

    // ── One pass of the film ────────────────────────────────────────────────
    const run = () => {
      clearPdf();
      setPrice(STALE);
      setComment(null);
      setYou(HIDDEN);
      setJz(HIDDEN);
      editor.selectNone();
      panTo(FRAME.wide, 0);

      const pdfC = () => vp(L.pdf.x + L.pdf.w * 0.24, L.pdf.y + L.pdf.h * 0.42);
      const tableCorner = () => vp(L.table.x + L.table.w, L.table.y);
      const priceCell = () => vp(L.table.x + L.table.w * 0.46, L.table.y + L.table.h * 0.35);

      // 1) WIDE: let the busy board breathe, then flash the provenance lineage.
      after(900, () => {
        if (ids.current) editor.select(ids.current.table);
      });
      after(3000, () => editor.selectNone());

      // 2) Push in on the drop zone; the Maker drops the PDF.
      after(3400, () => panTo(FRAME.drop, 950));
      after(4500, () => {
        const p = pdfC();
        setYou({ x: p.x, y: p.y + 150, visible: true, status: null });
      });
      after(5100, () => {
        const p = pdfC();
        setYou({ x: p.x, y: p.y, visible: true, status: 'dropping a file…' });
      });
      after(5700, () => {
        dropPdf();
        const p = pdfC();
        setYou({ x: p.x + 30, y: p.y + 20, visible: true, status: null });
      });
      after(6300, () => setYou((c) => ({ ...c, visible: false })));

      // 3) Jarwiz flies over and reads the evidence.
      const quips = readingQuips('pdf');
      after(6400, () => {
        const p = pdfC();
        setJz({ x: p.x, y: p.y, visible: true, status: quips[0] ?? 'reading…' });
      });
      [1, 2, 3].forEach((k) =>
        after(6400 + k * 900, () => {
          const p = pdfC();
          setJz({ x: p.x + (k % 2 ? 26 : -26), y: p.y + (k % 2 ? 30 : -22), visible: true, status: quips[k % quips.length] ?? 'reading…' });
        }),
      );

      // 4) Camera FOLLOWS Jarwiz to the table; it pins the discrepancy.
      after(9400, () => {
        panTo(FRAME.table, 950);
        setJz((c) => ({ ...c, status: 'following the trail…' }));
      });
      after(10450, () => {
        const c = tableCorner();
        setJz({ x: c.x - 14, y: c.y + 16, visible: true, status: 'spotting a discrepancy…' });
        setComment({ x: c.x, y: c.y, open: false });
      });
      after(11050, () => {
        setComment((s) => (s ? { ...s, open: true } : s));
        setJz(HIDDEN);
      });

      // 5) You click the fix; the cell backspaces then STREAMS the correction.
      after(12150, () => {
        const b = rectCenter(fixBtnRef.current);
        const c = tableCorner();
        const target = b ?? { x: c.x + 40, y: c.y + 120 };
        setYou({ x: target.x, y: target.y, visible: true, status: null });
      });
      after(13200, () => {
        const p = priceCell();
        setJz({ x: p.x, y: p.y, visible: true, status: 'fixing…' });
      });
      after(13600, () => setComment(null));
      const STREAM = ['$1', '$', '', '$', '$1', TRUE];
      const STREAM_STEP = 95;
      STREAM.forEach((v, i) => after(13800 + i * STREAM_STEP, () => setPrice(v)));
      const streamEnd = 13800 + STREAM.length * STREAM_STEP;
      after(streamEnd + 150, () => {
        const p = priceCell();
        setJz({ x: p.x, y: p.y, visible: true, status: 'fixed ✓' });
        setYou((c) => ({ ...c, visible: false }));
      });

      // 6) Settle, pull back to the wide board, and loop.
      after(16100, () => setJz((c) => ({ ...c, visible: false })));
      after(16500, () => panTo(FRAME.wide, 950));
      after(18400, run);
    };

    seed();
    after(500, run);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div ref={rootRef} className="jz-showreel" aria-hidden="true">
      <ScriptedCursor cursor={you} label="You" you />
      <ScriptedCursor cursor={jz} label="Jarwiz" />
      {comment ? <ShowreelComment pos={comment} open={comment.open} fixRef={fixBtnRef} /> : null}
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
