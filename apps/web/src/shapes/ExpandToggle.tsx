/**
 * Expand / collapse affordance for answer cards taller than the threshold.
 * Collapsed, it sits over a soft fade at the card's clipped bottom; expanded,
 * it's a plain "Collapse". Shown only when the content actually overflows.
 */

import { stopEventPropagation, type TLShapeId } from 'tldraw';
import { toggleExpand } from './cardExpand';

export function ExpandToggle({ shapeId, expanded }: { shapeId: TLShapeId; expanded: boolean }) {
  return (
    <div
      className={`jz-card-more${expanded ? ' jz-card-more-open' : ''}`}
      onPointerDown={stopEventPropagation}
    >
      <button
        className="jz-card-expand"
        onClick={(e) => {
          e.stopPropagation();
          toggleExpand(shapeId);
        }}
      >
        {expanded ? 'Collapse' : `Expand`}
      </button>
    </div>
  );
}
