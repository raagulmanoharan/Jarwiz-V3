/**
 * The hero showreel (?embed=1) — a perpetual, non-interactive loop that tells
 * Jarwiz's core story with the REAL product pieces: real card shapes (link,
 * table, doc, diagram, note, image), real provenance lineage, the real
 * collaborator-cursor look, and the real proactive-comment popover.
 *
 * Everything ephemeral (both cursors, the dragged file, the comment, the parse
 * glow, the click ripples) is anchored in PAGE coordinates and re-projected to
 * screen every animation frame — exactly like the product's own cursor layer —
 * so it truly rides the canvas: it pans and zooms with the board and never
 * drifts when the camera moves or the page scrolls.
 *
 * The film, looped forever:
 *   1. WIDE — a genuinely busy research board.
 *   2. The Maker's cursor carries a **file** in and drops it; it becomes a PDF
 *      card (an image of the pricing sheet — always renders, no pdf.js).
 *   3. After a beat, **Jarwiz** flies over, selects the card and scans it (a soft
 *      white glow) while it parses the evidence.
 *   4. Jarwiz travels to the comparison table and flags the stale cell — a
 *      **discrepancy comment** is pinned right there.
 *   5. After a beat, the Maker opens the comment and clicks **"Fix it with
 *      Jarwiz"**; the real cell highlights and the value regenerates inline.
 *   6. The card is removed, the camera pulls back, and the loop resets.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, createShapeId, useEditor, type TLShapeId } from 'tldraw';
import { Sparkles, Wand2, Scale, FileText } from 'lucide-react';
import { setShapeTitle } from '../shapes/shapeTitle';
import { PROV_META_KEY } from '../ask/useAsk';

// ── The canned research board ──────────────────────────────────────────────
// One stale cell (`STALE`) is the whole story: the table quotes last year's
// Pipedrive price; the evidence sheet says otherwise; the fix streams it to `TRUE`.
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
// loop only drops/removes the evidence card and streams the one cell.
const L = {
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
  sketch: { x: -460, y: 250, w: 400, h: 300 },
  stickies: [
    { x: 780, y: -360, w: 220, h: 110 },
    { x: -300, y: 600, w: 230, h: 140 },
  ],
  // The evidence card — an IMAGE of the pricing sheet (aspect ≈ 0.775 w/h).
  pdf: { x: 1200, y: -210, w: 300, h: 388 },
};

const PDF_IMG = `${import.meta.env.BASE_URL}evidence-pricing.jpg`;
const SKETCH_URL = `${import.meta.env.BASE_URL}sketch-flow.jpg`;

const CURSOR_PATH = 'M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z';

// A page-space tween: current (x,y) eases from (fx,fy) to (tx,ty) over `dur`.
interface Tween {
  x: number; y: number; fx: number; fy: number; tx: number; ty: number; t0: number; dur: number;
}
const newTween = (): Tween => ({ x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 0 });

export function EmbedShowreel() {
  const editor = useEditor();
  const rootRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const jzRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLDivElement>(null);
  const parseRef = useRef<HTMLDivElement>(null);
  const clickRef = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);
  const ids = useRef<{ table: TLShapeId; diagram: TLShapeId; pdf: TLShapeId } | null>(null);

  // Page-space anchors, projected to screen each frame by the rAF loop.
  const youTw = useRef<Tween>(newTween());
  const jzTw = useRef<Tween>(newTween());
  const commentPage = useRef({ x: 0, y: 0 });
  const clickPage = useRef({ x: 0, y: 0 });

  const [youVis, setYouVis] = useState(false);
  const [fileVis, setFileVis] = useState(false);
  const [jz, setJz] = useState<{ visible: boolean; status: string | null }>({ visible: false, status: null });
  const [comment, setComment] = useState<{ visible: boolean; open: boolean }>({ visible: false, open: false });
  const [parseVis, setParseVis] = useState(false);
  const [click, setClick] = useState(0);
  const clickSeq = useRef(0);
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? Math.min(ms, 250) : ms) as unknown as number;
      timers.current.push(t);
    };
    const clearTimers = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    // ── Page-space motion ──────────────────────────────────────────────────
    const place = (tw: Tween, x: number, y: number) => {
      tw.x = x; tw.y = y; tw.fx = x; tw.fy = y; tw.tx = x; tw.ty = y; tw.dur = 0;
    };
    const glideTo = (tw: Tween, x: number, y: number, dur: number) => {
      tw.fx = tw.x; tw.fy = tw.y; tw.tx = x; tw.ty = y; tw.t0 = performance.now(); tw.dur = reduce ? 0 : dur;
    };
    const tick = (tw: Tween) => {
      if (tw.dur <= 0) { tw.x = tw.tx; tw.y = tw.ty; return; }
      const k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      tw.x = tw.fx + (tw.tx - tw.fx) * e;
      tw.y = tw.fy + (tw.ty - tw.fy) * e;
    };

    // The rAF loop: project every page anchor to screen and write the DOM. This
    // is what makes the whole cast ride the canvas through pans and zooms.
    let raf = 0;
    const project = (px: number, py: number) => editor.pageToViewport({ x: px, y: py });
    const frame = () => {
      raf = requestAnimationFrame(frame);
      tick(youTw.current);
      tick(jzTw.current);
      if (youRef.current) {
        const s = project(youTw.current.x, youTw.current.y);
        youRef.current.style.transform = `translate(${s.x - 4}px, ${s.y - 3}px)`;
      }
      if (fileRef.current) {
        // Below the "You" badge so the two don't overlap while dragging.
        const s = project(youTw.current.x, youTw.current.y);
        fileRef.current.style.transform = `translate(${s.x + 8}px, ${s.y + 46}px)`;
      }
      if (jzRef.current) {
        const s = project(jzTw.current.x, jzTw.current.y);
        jzRef.current.style.transform = `translate(${s.x - 4}px, ${s.y - 3}px)`;
      }
      if (commentRef.current) {
        const s = project(commentPage.current.x, commentPage.current.y);
        commentRef.current.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
      if (clickRef.current) {
        const s = project(clickPage.current.x, clickPage.current.y);
        clickRef.current.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
      if (parseRef.current && ids.current) {
        const b = editor.getShapePageBounds(ids.current.pdf);
        if (b) {
          const tl = project(b.x, b.y);
          const br = project(b.x + b.w, b.y + b.h);
          parseRef.current.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
          parseRef.current.style.width = `${br.x - tl.x}px`;
          parseRef.current.style.height = `${br.y - tl.y}px`;
        }
      }
    };
    raf = requestAnimationFrame(frame);

    const clickAt = (x: number, y: number) => {
      clickPage.current = { x, y };
      clickSeq.current += 1;
      setClick(clickSeq.current);
    };

    // Camera framings the film pans between.
    const FRAME = {
      wide: new Box(-1030, -600, 2560, 1330),
      drop: new Box(760, -220, 900, 640),
      table: new Box(-150, -180, 900, 540),
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

      const t = editor.getShape(table);
      if (t) setShapeTitle(editor, t, 'CRM shortlist');
      const t2 = editor.getShape(table2);
      if (t2) setShapeTitle(editor, t2, 'Feature matrix');

      // Provenance lineage (dotted): the table was built FROM the sources + the
      // feature matrix; the recommendation and notes FROM the table; the flow
      // diagram FROM the whiteboard sketch.
      editor.updateShape({ id: table, type: 'table-card', meta: { [PROV_META_KEY]: [...linkIds, table2] } });
      editor.updateShape({ id: doc, type: 'doc-card', meta: { [PROV_META_KEY]: [table] } });
      editor.updateShape({ id: notes, type: 'doc-card', meta: { [PROV_META_KEY]: [table] } });
      editor.updateShape({ id: diagram, type: 'diagram-card', meta: { [PROV_META_KEY]: [sketch] } });

      panTo(FRAME.wide, 0);
    };

    const dropPdf = () => {
      if (!ids.current) return;
      editor.createShape({
        id: ids.current.pdf,
        type: 'image-card',
        x: L.pdf.x,
        y: L.pdf.y,
        props: { w: L.pdf.w, h: L.pdf.h, src: PDF_IMG, name: 'Vendor Pricing 2026' },
      });
    };
    const clearPdf = () => {
      if (ids.current && editor.getShape(ids.current.pdf)) editor.deleteShapes([ids.current.pdf]);
    };
    const setPrice = (price: string) => {
      if (!ids.current) return;
      editor.updateShape({ id: ids.current.table, type: 'table-card', props: { rows: rowsWith(price) } });
    };
    // Flag/unflag the stale price cell ON the real table shape (Pipedrive row,
    // Price/seat column) via meta — the highlight rides the actual cell.
    const flashCell = (on: boolean) => {
      if (!ids.current) return;
      const cur = editor.getShape(ids.current.table);
      if (!cur) return;
      editor.updateShape({
        id: ids.current.table,
        type: 'table-card',
        meta: { ...cur.meta, jzFlashCell: on ? [1, 2] : null },
      } as Parameters<typeof editor.updateShape>[0]);
    };

    // Key page-space anchors.
    const DROP = { x: L.pdf.x + L.pdf.w * 0.5, y: L.pdf.y + L.pdf.h * 0.5 };
    const CELL = { x: L.table.x + L.table.w * 0.46, y: L.table.y + L.table.h * 0.33 };
    // The "Fix it with Jarwiz" button sits inside the popover, below the pin.
    const FIXBTN = { x: CELL.x + 24, y: CELL.y + 128 };

    // ── One pass of the film ────────────────────────────────────────────────
    const run = () => {
      clearPdf();
      setPrice(STALE);
      flashCell(false);
      setComment({ visible: false, open: false });
      setParseVis(false);
      setYouVis(false);
      setFileVis(false);
      setJz({ visible: false, status: null });
      setClick(0);
      if (ids.current) editor.select(ids.current.table, ids.current.diagram);
      panTo(FRAME.wide, 0);
      place(youTw.current, 1780, -540);
      place(jzTw.current, 1820, 560);

      // 1) Brief wide beat, then push in on the drop zone.
      after(900, () => panTo(FRAME.drop, 1400));

      // 2) The Maker's cursor comes in CARRYING the file, and drags it to the
      //    drop spot slowly (0.8×). The file is tied to the cursor.
      after(2500, () => { place(youTw.current, 1720, -470); setYouVis(true); setFileVis(true); });
      after(2750, () => glideTo(youTw.current, DROP.x + 18, DROP.y + 12, 2600));

      // 3) Drop → the file becomes the card; the file fades where the card forms.
      after(5450, () => { dropPdf(); setFileVis(false); clickAt(DROP.x, DROP.y); });
      after(6000, () => setYouVis(false));

      // 4) A beat, then Jarwiz flies in, selects the card and scans it (~5s).
      after(7000, () => { place(jzTw.current, DROP.x + 180, DROP.y + 190); glideTo(jzTw.current, DROP.x - 30, DROP.y - 10, 750); setJz({ visible: true, status: 'reading the evidence…' }); });
      after(7700, () => setParseVis(true));
      after(9400, () => setJz({ visible: true, status: 'cross-checking the prices…' }));
      after(11200, () => setJz({ visible: true, status: 'found a mismatch…' }));
      after(12600, () => setParseVis(false));

      // 5) Camera follows Jarwiz to the table; it flags the stale cell — the
      //    comment is pinned right there.
      after(12700, () => { panTo(FRAME.table, 1400); glideTo(jzTw.current, CELL.x, CELL.y, 1400); setJz({ visible: true, status: 'following the trail…' }); });
      after(14300, () => setJz({ visible: true, status: 'flagging it…' }));
      after(15100, () => { commentPage.current = { x: CELL.x, y: CELL.y }; clickAt(CELL.x, CELL.y); setComment({ visible: true, open: false }); });
      after(15700, () => setJz({ visible: false, status: null }));

      // 6) A beat, then the Maker goes over, opens the comment and clicks
      //    "Fix it with Jarwiz".
      after(16900, () => { place(youTw.current, CELL.x + 150, CELL.y - 130); glideTo(youTw.current, CELL.x + 6, CELL.y + 8, 1000); setYouVis(true); });
      after(18100, () => { clickAt(CELL.x, CELL.y); setComment({ visible: true, open: true }); });
      after(19300, () => glideTo(youTw.current, FIXBTN.x, FIXBTN.y, 850));
      after(20250, () => clickAt(FIXBTN.x, FIXBTN.y));
      after(20650, () => setYouVis(false));

      // 7) No Jarwiz cursor: the comment closes, the real cell highlights, and the
      //    value regenerates inline (backspace, then stream in).
      after(20700, () => { setComment({ visible: false, open: false }); flashCell(true); });
      const STREAM = ['$1', '$', '', '$', '$1', TRUE];
      const STREAM_STEP = 120;
      STREAM.forEach((v, i) => after(21000 + i * STREAM_STEP, () => setPrice(v)));
      const streamEnd = 21000 + STREAM.length * STREAM_STEP;
      after(streamEnd + 900, () => flashCell(false));

      // 8) Settle, remove the card BEFORE the pull-back (so the wide board matches
      //    the loop's start), then a slow pull-back and loop.
      after(streamEnd + 1700, () => clearPdf());
      after(streamEnd + 2000, () => panTo(FRAME.wide, 1500));
      after(streamEnd + 4400, run);
    };

    seed();
    after(300, run);

    return () => {
      clearTimers();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div ref={rootRef} className="jz-showreel" aria-hidden="true">
      {/* The scanning glow rides the PDF card's page bounds (rAF-positioned). */}
      <div
        ref={parseRef}
        className="jz-parse-halo"
        style={{ position: 'absolute', left: 0, top: 0, display: parseVis ? 'block' : 'none' }}
      />

      {/* The proactive comment, pinned in page space at the flagged cell. */}
      <div
        ref={commentRef}
        className="jz-comment"
        style={{ position: 'absolute', left: 0, top: 0, display: comment.visible ? 'block' : 'none' }}
      >
        <button className={`jz-comment-pin jz-comment-pin--tension${comment.open ? ' jz-comment-pin--open' : ''}`}>
          <Sparkles size={12} />
        </button>
        {comment.open ? (
          <div className="jz-comment-pop">
            <div className="jz-comment-head">
              <span className="jz-comment-avatar"><Sparkles size={12} /></span>
              <span className="jz-comment-name">Jarwiz</span>
              <span className="jz-comment-kind jz-comment-kind--tension"><Scale size={12} />Tension</span>
            </div>
            <div className="jz-comment-body">{COMMENT_BODY}</div>
            <div className="jz-comment-actions">
              <button className="jz-comment-fix"><Wand2 size={13} /> Fix it with Jarwiz</button>
              <button className="jz-comment-dismiss">Dismiss</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* The file the Maker carries in — tied to the "You" cursor until it drops. */}
      <div
        ref={fileRef}
        className={`jz-drag-file${fileVis ? '' : ' jz-drag-file--hidden'}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <FileText size={15} />
        <span>Vendor Pricing 2026.pdf</span>
      </div>

      {/* The Maker cursor — simply "You". */}
      <div
        ref={youRef}
        className={`jz-avatar jz-avatar--jarwiz jz-avatar--you jz-avatar--idle${youVis ? '' : ' jz-avatar--hidden'}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <svg className="jz-cursor-arrow" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d={CURSOR_PATH} />
        </svg>
        <div className="jz-avatar-badge"><span className="jz-avatar-name">You</span></div>
      </div>

      {/* The Jarwiz cursor — carries the muttering quips. */}
      <div
        ref={jzRef}
        className={`jz-avatar jz-avatar--jarwiz${jz.status ? '' : ' jz-avatar--idle'}${jz.visible ? '' : ' jz-avatar--hidden'}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <svg className="jz-cursor-arrow" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d={CURSOR_PATH} />
        </svg>
        <div className="jz-avatar-badge">
          <span className="jz-avatar-name">Jarwiz</span>
          {jz.status ? <span key={jz.status} className="jz-avatar-status">{jz.status}</span> : null}
        </div>
      </div>

      {/* A click ripple, keyed so each click replays; rAF keeps it on its cell. */}
      {click ? <span ref={clickRef} key={click} className="jz-click-ring" style={{ position: 'absolute', left: 0, top: 0 }} /> : null}
    </div>
  );
}
