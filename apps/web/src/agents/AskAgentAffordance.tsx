import { useEffect, useState, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { AGENTS, type AgentMeta } from '@jarwiz/shared';

interface AskAgentAffordanceProps {
  /** Called when the user picks an agent. The M1 runtime hooks in here. */
  onPickAgent: (agent: AgentMeta) => void;
}

/**
 * The selection-following "✦ Ask an agent" affordance: floats above the
 * current selection and opens the four-agent menu.
 */
export function AskAgentAffordance({ onPickAgent }: AskAgentAffordanceProps) {
  const editor = useEditor();
  const [menuOpen, setMenuOpen] = useState(false);

  const anchor = useValue(
    'jarwiz ask-agent anchor',
    () => {
      if (editor.getEditingShapeId() !== null) return null;
      if (!editor.isIn('select.idle')) return null;
      const selectedIds = editor.getSelectedShapeIds();
      if (selectedIds.length === 0) return null;
      const bounds = editor.getSelectionRotatedScreenBounds();
      if (!bounds) return null;
      return { x: bounds.midX, y: bounds.minY, selectionKey: selectedIds.join(',') };
    },
    [editor],
  );

  // Close the menu whenever the selection changes or clears.
  const selectionKey = anchor?.selectionKey ?? '';
  useEffect(() => {
    setMenuOpen(false);
  }, [selectionKey]);

  if (!anchor) return null;

  return (
    <div
      className="jz-ask"
      style={{ left: anchor.x, top: anchor.y - 14 }}
      onPointerDown={stopEventPropagation}
    >
      {menuOpen ? (
        <div className="jz-ask-menu">
          {AGENTS.map((agent) => (
            <button
              key={agent.id}
              className="jz-ask-item"
              onClick={() => {
                setMenuOpen(false);
                onPickAgent(agent);
              }}
            >
              <span
                className="jz-agent-dot"
                style={{ '--agent-color': agent.color } as CSSProperties}
              />
              <span>
                <span className="jz-ask-item-name">{agent.name}</span>
                <br />
                <span className="jz-ask-item-tagline">{agent.tagline}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <button className="jz-ask-button" onClick={() => setMenuOpen((open) => !open)}>
        <span aria-hidden>✦</span>
        Ask an agent
      </button>
    </div>
  );
}
