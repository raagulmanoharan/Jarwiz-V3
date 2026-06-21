/**
 * "Based on: …" header (Big Rocks 2.2 — show your work). When a single answer
 * card that came from an Ask is selected, this shows the sources it was built
 * from, anchored at the card's top. Tapping a source selects and zooms to it, so
 * a user can always answer "why did it say that?" by looking, not guessing.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getProvenance, getProvenanceMap, subscribeProvenance } from './provenance';

export function ProvenanceLayer() {
  const editor = useEditor();
  // Re-render when provenance is recorded (a new answer lands).
  useSyncExternalStore(subscribeProvenance, getProvenanceMap, getProvenanceMap);

  const info = useValue(
    'jz provenance header',
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const cardId = ids[0]!;
      const prov = getProvenance(cardId);
      if (!prov) return null;
      // Only show sources that still exist on the board.
      const live = prov.sourceIds
        .map((id, i) => ({ id, label: prov.labels[i] ?? 'Card' }))
        .filter((s) => Boolean(editor.getShape(s.id)));
      if (live.length === 0) return null;
      const b = editor.getShapePageBounds(cardId);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.minX, y: b.minY });
      const vp = editor.getViewportScreenBounds();
      return {
        sources: live,
        x: Math.max(12, Math.min(p.x, vp.w - 12)),
        y: Math.max(8, p.y - 38),
      };
    },
    [editor],
  );

  if (!info) return null;

  const zoomTo = (id: (typeof info.sources)[number]['id']) => {
    const b = editor.getShapePageBounds(id);
    editor.select(id);
    if (b) editor.zoomToBounds(b, { animation: { duration: 300 }, inset: 120 });
  };

  const style = { left: info.x, top: info.y } as CSSProperties;
  return (
    <div className="jz-prov" style={style} onPointerDown={stopEventPropagation}>
      <span className="jz-prov-label">Based on</span>
      {info.sources.map((s) => (
        <button key={s.id} className="jz-prov-src" title="Zoom to source" onClick={() => zoomTo(s.id)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
