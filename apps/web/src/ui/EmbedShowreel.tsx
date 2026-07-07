/**
 * The hero showreel (?embed=1) — a perpetual, non-interactive loop that tells
 * Jarwiz's core story with the REAL product pieces: real card shapes (table,
 * doc, pdf), the real collaborator-cursor look, and the real proactive-comment
 * popover. Nothing here is a mock render — the table that gets corrected is an
 * actual `table-card`; the evidence is an actual `pdf-card` reading a real PDF.
 *
 * The beat sheet, looped forever:
 *   1. A board already holds a comparison **table** and a **recommendation doc**.
 *   2. *You* drop a **PDF** of canonical evidence (a 2026 pricing sheet).
 *   3. **Jarwiz** flies over and *reads* it (the same "reading…" behaviour a real
 *      dropped PDF triggers).
 *   4. Jarwiz pins a **discrepancy comment** on the table — the row is on last
 *      year's price.
 *   5. *You* click **“Let Jarwiz fix it”** and the table cell re-renders itself.
 *   6. Beat, then the loop resets.
 *
 * It is a *showreel*: the whole layer is pointer-events:none, the camera is
 * pinned, and it never hands off — visitors who want to drive click “Try it
 * free”. That keeps the loop deterministic (no half-dragged cards, no re-wipe
 * yanking the board out from under a cursor).
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, createShapeId, useEditor, type TLShapeId } from 'tldraw';
import { Sparkles, Wand2, Scale } from 'lucide-react';
import { readingQuips } from '../agents/jarwizLife';

// ── The canned board ───────────────────────────────────────────────────────
// One stale cell (`STALE`) is the whole story: the table quotes last year's
// Pipedrive price; the evidence PDF says otherwise; the fix swaps it to `TRUE`.
const STALE = '$14';
const TRUE = '$19';
const TABLE = {
  columns: ['CRM', 'Plan', 'Price / seat', 'Best for'],
  baseRows: [
    ['HubSpot', 'Free CRM', '$0', 'All-in-one'],
    ['Pipedrive', 'Essential', STALE, 'Small teams'],
    ['Attio', 'Plus', '$29', 'Startups'],
  ],
};
const DOC_TEXT =
  '## The pick\n\nStart with **Pipedrive** — it scales cleanly from one seat and stays affordable for a small sales team.';
const COMMENT_BODY = `The 2026 pricing sheet lists Pipedrive Essential at ${TRUE}/seat — this row still shows ${STALE}, last year's price.`;

// Page-space layout (camera is pinned to fit this once).
const L = {
  table: { x: -280, y: -180, w: 560, h: 196 },
  doc: { x: -280, y: 60, w: 300, h: 176 },
  pdf: { x: 360, y: -180, w: 300, h: 416 },
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
  const ids = useRef<{ table: TLShapeId; doc: TLShapeId; pdf: TLShapeId } | null>(null);

  const [you, setYou] = useState<Cursor>(HIDDEN);
  const [jz, setJz] = useState<Cursor>(HIDDEN);
  const [comment, setComment] = useState<{ x: number; y: number; open: boolean } | null>(null);
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, reduce ? Math.min(ms, 400) : ms) as unknown as number;
      timers.current.push(t);
    };
    const clearTimers = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    // Page → overlay-local viewport coords. pageToViewport shares the editor
    // container's origin with this overlay (InFrontOfTheCanvas), so no rebasing.
    const vp = (px: number, py: number) => editor.pageToViewport({ x: px, y: py });
    const rectCenter = (el: HTMLElement | null) => {
      const root = rootRef.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 };
    };

    // ── Seed the persistent board (once) and pin the camera ─────────────────
    const seed = () => {
      // Start from a clean canvas — the embed board may be locally persisted,
      // so wipe anything a prior mount left behind before laying the story out.
      const existing = [...editor.getCurrentPageShapeIds()];
      if (existing.length) editor.deleteShapes(existing);
      const table = createShapeId();
      const doc = createShapeId();
      const pdf = createShapeId();
      ids.current = { table, doc, pdf };
      editor.createShape({
        id: table,
        type: 'table-card',
        x: L.table.x,
        y: L.table.y,
        props: { w: L.table.w, h: L.table.h, columns: TABLE.columns, rows: rowsWith(STALE) },
      });
      editor.createShape({
        id: doc,
        type: 'doc-card',
        x: L.doc.x,
        y: L.doc.y,
        props: { w: L.doc.w, h: L.doc.h, title: 'Recommendation', text: DOC_TEXT },
      });
      // Frame the whole story area (including where the PDF will land) and hold.
      const b = new Box(L.table.x, L.table.y, L.pdf.x + L.pdf.w - L.table.x, L.pdf.y + L.pdf.h - L.table.y);
      editor.zoomToBounds(b, { inset: 56, animation: { duration: 0 } });
    };

    const rowsWith = (price: string): string[][] =>
      TABLE.baseRows.map((r) => {
        if (r[0] !== 'Pipedrive') return r;
        const copy = [...r];
        copy[2] = price;
        return copy;
      });

    const dropPdf = () => {
      if (!ids.current) return;
      editor.createShape({
        id: ids.current.pdf,
        type: 'pdf-card',
        x: L.pdf.x,
        y: L.pdf.y,
        props: {
          w: L.pdf.w,
          h: L.pdf.h,
          src: PDF_URL,
          assetId: '',
          name: 'Vendor Pricing 2026',
          pages: 1,
          status: 'ready',
        },
      });
    };
    const clearPdf = () => {
      if (ids.current && editor.getShape(ids.current.pdf)) editor.deleteShapes([ids.current.pdf]);
    };
    const setPrice = (price: string) => {
      if (!ids.current) return;
      editor.updateShape({
        id: ids.current.table,
        type: 'table-card',
        props: { rows: rowsWith(price) },
      });
    };

    // ── One pass of the loop ────────────────────────────────────────────────
    const run = () => {
      // Reset to the starting state.
      clearPdf();
      setPrice(STALE);
      setComment(null);
      setYou(HIDDEN);
      setJz(HIDDEN);

      // Read from the PDF's left third so the cursor's trailing name-pill (which
      // extends rightward) stays inside the framed board instead of clipping.
      const pdfC = () => vp(L.pdf.x + L.pdf.w * 0.24, L.pdf.y + L.pdf.h * 0.42);
      const tableCorner = () => vp(L.table.x + L.table.w, L.table.y);
      const priceCell = () => vp(L.table.x + L.table.w * 0.62, L.table.y + L.table.h * 0.5);

      // 1) You glide in from the bottom and "drop" the PDF.
      after(500, () => {
        const p = pdfC();
        setYou({ x: p.x, y: p.y + 150, visible: true, status: null });
      });
      after(1250, () => {
        const p = pdfC();
        setYou({ x: p.x, y: p.y, visible: true, status: 'dropping a file…' });
      });
      after(1950, () => {
        dropPdf();
        const p = pdfC();
        setYou({ x: p.x + 30, y: p.y + 20, visible: true, status: null });
      });
      after(2600, () => setYou((c) => ({ ...c, visible: false })));

      // 2) Jarwiz flies over and reads the evidence.
      const quips = readingQuips('pdf');
      after(2700, () => {
        const p = priceCell();
        setJz({ x: p.x, y: p.y, visible: true, status: null });
      });
      after(3200, () => {
        const p = pdfC();
        setJz({ x: p.x, y: p.y, visible: true, status: quips[0] ?? 'reading…' });
      });
      // Cycle a couple of reading quips while scanning.
      [1, 2, 3].forEach((k) =>
        after(3200 + k * 900, () => {
          const p = pdfC();
          setJz({
            x: p.x + (k % 2 ? 26 : -26),
            y: p.y + (k % 2 ? 30 : -22),
            visible: true,
            status: quips[k % quips.length] ?? 'reading…',
          });
        }),
      );

      // 3) Jarwiz moves to the table and pins the discrepancy comment.
      after(6300, () => {
        const c = tableCorner();
        setJz({ x: c.x - 14, y: c.y + 16, visible: true, status: 'spotting a discrepancy…' });
        setComment({ x: c.x, y: c.y, open: false });
      });
      // Pop the comment open and step Jarwiz back so its badge doesn't cover the
      // note — the board is now handing the decision to you.
      after(6900, () => {
        setComment((s) => (s ? { ...s, open: true } : s));
        setJz(HIDDEN);
      });

      // 4) You move to the fix button and click it; the cell re-renders.
      after(8000, () => {
        const b = rectCenter(fixBtnRef.current);
        const c = tableCorner();
        const target = b ?? { x: c.x + 40, y: c.y + 120 };
        setYou({ x: target.x, y: target.y, visible: true, status: null });
      });
      after(9100, () => {
        const p = priceCell();
        setJz({ x: p.x, y: p.y, visible: true, status: 'fixing…' });
      });
      after(9700, () => {
        setPrice(TRUE); // the real table-card re-renders with the corrected price
        setComment(null);
      });
      after(10100, () => {
        const p = priceCell();
        setJz({ x: p.x, y: p.y, visible: true, status: 'fixed ✓' });
        setYou((c) => ({ ...c, visible: false }));
      });

      // 5) Settle, fade, and loop.
      after(11800, () => setJz((c) => ({ ...c, visible: false })));
      after(13000, run);
    };

    seed();
    after(300, run);
    return () => {
      clearTimers();
      // Leave the board as-is on unmount; the iframe is throwaway.
    };
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
