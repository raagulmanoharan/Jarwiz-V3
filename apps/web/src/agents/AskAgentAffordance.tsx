import { Sparkle } from 'lucide-react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';

interface AskAgentAffordanceProps {
  /** Called when the user clicks "Ask Jarwiz" on the current selection. */
  onAsk: () => void;
}

/**
 * The selection-following "Ask Jarwiz" affordance: floats above the current
 * selection and summons Jarwiz on it. (Internally the server still routes to
 * the right specialist — the user just talks to Jarwiz.)
 */
export function AskAgentAffordance({ onAsk }: AskAgentAffordanceProps) {
  const editor = useEditor();

  const anchor = useValue(
    'jarwiz ask-agent anchor',
    () => {
      if (editor.getEditingShapeId() !== null) return null;
      if (!editor.isIn('select.idle')) return null;
      const selectedIds = editor.getSelectedShapeIds();
      if (selectedIds.length === 0) return null;
      const bounds = editor.getSelectionRotatedScreenBounds();
      if (!bounds) return null;
      return { x: bounds.midX, y: bounds.minY };
    },
    [editor],
  );

  if (!anchor) return null;

  return (
    <div
      className="jz-ask"
      style={{ left: anchor.x, top: anchor.y - 14 }}
      onPointerDown={stopEventPropagation}
    >
      <button className="jz-ask-button" onClick={onAsk}>
        <Sparkle size={14} strokeWidth={1.7} fill="currentColor" aria-hidden />
        Ask Jarwiz
      </button>
    </div>
  );
}
