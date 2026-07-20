/**
 * A card's provenance shown IN the card — a first row of "From …" pills naming
 * the sources it was built from (moved off the card action bar, owner call
 * 2026-07-20). Each pill jumps to its source. Renders nothing when a card has
 * no provenance, so only generated cards carry the row.
 */

import { stopEventPropagation, useEditor, useValue, type TLShape, type TLShapeId } from 'tldraw';
import { CornerUpLeft } from 'lucide-react';
import { PROV_META_KEY, sourceLabel } from '../ask/useAsk';
import { bringIntoView } from './bringIntoView';

export function CardSources({ shapeId }: { shapeId: TLShapeId }) {
  const editor = useEditor();
  const sources = useValue<Array<{ id: TLShapeId; label: string }>>(
    'card-sources',
    () => {
      const s = editor.getShape(shapeId);
      const ids = (s?.meta?.[PROV_META_KEY] as string[] | undefined) ?? [];
      return ids
        .map((sid) => editor.getShape(sid as TLShapeId))
        .filter((x): x is TLShape => Boolean(x))
        .map((x) => ({ id: x.id, label: sourceLabel(x) }));
    },
    [editor, shapeId],
  );

  if (sources.length === 0) return null;

  return (
    <div className="jz-card-sources" role="group" aria-label="Sources">
      <span className="jz-card-sources-lead" aria-hidden>From</span>
      {sources.map((s) => (
        <button
          key={s.id}
          className="jz-card-source-pill"
          title={`Go to source: ${s.label}`}
          style={{ pointerEvents: 'all' }}
          onPointerDown={stopEventPropagation}
          onClick={(e) => {
            e.stopPropagation();
            editor.select(s.id);
            bringIntoView(editor, s.id);
          }}
        >
          <CornerUpLeft size={10} strokeWidth={2.2} aria-hidden />
          <span className="jz-card-source-pill-label">{s.label}</span>
        </button>
      ))}
    </div>
  );
}
