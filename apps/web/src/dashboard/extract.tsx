/**
 * Drag OUT of a rich card. Every extractable block inside a generative-UI card
 * (a table, the hero image, a prose section, a chart) grows a small grab
 * handle on hover; drag it onto the canvas and it lands as a REAL card of the
 * right type — instantly, no model round-trip, because the data is already in
 * the rendered spec. The new card records the rich card in `meta.jzSources`,
 * so the click-to-reveal lineage (and auto-sync) treat it like any other
 * derived card.
 *
 * Pointer mechanics live here, card-type mapping lives with each library
 * component (they hand us a `makeCard`). The handle stops propagation so
 * tldraw never mistakes the gesture for a card translate; a small ghost pill
 * follows the pointer; release over the canvas (outside the host card)
 * creates + selects the extracted card, anywhere else cancels.
 *
 * Affordance: SELECTING the rich card reveals every handle (the same moment
 * the action bar and lineage lines appear). Hover-reveal can't work here —
 * tldraw keeps shape HTML at pointer-events:none so the card body stays
 * draggable, which also means blocks never receive CSS hover. The handles
 * themselves re-enable pointer events only while shown.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, type Editor, type TLShapeId } from 'tldraw';
import { useCardSelected } from '../shapes/useCardSelected';

/** Same key useAsk writes (`jzSources`) — duplicated as a literal to keep this
 *  module out of the shapes→library→extract→useAsk import cycle. */
const PROV_META_KEY = 'jzSources';

/** The rich card hosting the blocks — provided by DashboardCardShapeUtil. */
export const ExtractHostContext = createContext<TLShapeId | null>(null);

export type MakeCard = (editor: Editor, at: { x: number; y: number }) => TLShapeId | null;

/** Wrap a block to make it draggable-out. Renders children untouched plus the
 *  hover handle; outside a host card (no context) it's a plain passthrough. */
export function Extractable({
  label,
  makeCard,
  children,
}: {
  label: string;
  makeCard: MakeCard;
  children: React.ReactNode;
}) {
  const hostId = useContext(ExtractHostContext);
  if (!hostId) return <>{children}</>;
  return (
    <div className="jzd-extract">
      {children}
      <ExtractHandle label={label} makeCard={makeCard} hostId={hostId} />
    </div>
  );
}

function ExtractHandle({ label, makeCard, hostId }: { label: string; makeCard: MakeCard; hostId: TLShapeId }) {
  const editor = useEditor();
  const selected = useCardSelected(hostId);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  // Escape aborts a drag in flight.
  useEffect(() => {
    if (!ghost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGhost(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ghost]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let live = true;
    const move = (ev: PointerEvent) => setGhost({ x: ev.clientX, y: ev.clientY });
    const cancel = () => {
      live = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGhost(null);
    };
    const up = (ev: PointerEvent) => {
      if (!live) return;
      cancel();
      // Only a drop on the board counts — chrome, panels, and thin air don't.
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || !el.closest('.tl-canvas')) return;
      const pt = editor.screenToPage({ x: ev.clientX, y: ev.clientY });
      // Released back over the rich card itself → the user changed their mind.
      const hb = editor.getShapePageBounds(hostId);
      if (hb?.containsPoint(pt)) return;
      const id = makeCard(editor, pt);
      if (!id) return;
      const card = editor.getShape(id);
      if (card) {
        editor.updateShape({
          id,
          type: card.type,
          meta: { ...card.meta, [PROV_META_KEY]: [hostId] },
        });
      }
      editor.select(id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setGhost({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <button
        className={`jzd-extract-handle${selected || ghost ? ' jzd-extract-handle--on' : ''}`}
        title={`Drag out as a ${label.toLowerCase()} card`}
        aria-label={`Drag out as a ${label.toLowerCase()} card`}
        onPointerDown={onPointerDown}
      >
        <GripGlyph />
        <span className="jzd-extract-tag">{label}</span>
      </button>
      {ghost
        ? createPortal(
            <div className="jz-extract-ghost" style={{ left: ghost.x + 12, top: ghost.y + 10 }} aria-hidden>
              ⤴ {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function GripGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="8" cy="5" r="2" />
      <circle cx="16" cy="5" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="19" r="2" />
      <circle cx="16" cy="19" r="2" />
    </svg>
  );
}
