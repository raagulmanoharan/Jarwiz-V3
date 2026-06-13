import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from 'tldraw';
import type { AgentMeta } from '@jarwiz/shared';
import { AgentDock } from './AgentDock';
import { AskAgentAffordance } from './AskAgentAffordance';
import { useAgentRun } from './useAgentRun';

const TOAST_DURATION_MS = 2800;
const PLACEMENT_OFFSET = 60;

/**
 * The agent presence layer — everything agent-shaped that floats over the
 * canvas. Includes the dock (idle), the ask-an-agent affordance, and the
 * SSE-driven runtime that applies agent events to the board.
 */
export function AgentPresenceLayer() {
  const editor = useEditor();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<number | undefined>(undefined);
  const { run: runAgent } = useAgentRun();

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimeout.current), []);

  const handlePickAgent = useCallback(
    (agent: AgentMeta) => {
      const selectedShapeIds = editor.getSelectedShapeIds();
      if (selectedShapeIds.length === 0) {
        notify(`${agent.name}: select at least one card first`);
        return;
      }

      // Build the run request from the selection.
      const shapes: any[] = [];
      for (const id of selectedShapeIds) {
        const shape = editor.getShape(id as any);
        if (shape && ['link-card', 'youtube-card', 'image-card', 'pdf-card', 'note-card', 'doc-card'].includes(shape.type)) {
          shapes.push(shape);
        }
      }

      if (shapes.length === 0) {
        notify('Select a card to ask an agent');
        return;
      }

      // The first shape is the "source" (what the agent works on).
      // The rest are context.
      const sourceShape = shapes[0];
      const contextShapes = shapes.slice(1);

      const shapeToRunCard = (shape: any): any => {
        const kindMap: Record<string, any> = {
          'link-card': 'link',
          'youtube-card': 'youtube',
          'image-card': 'image',
          'pdf-card': 'pdf',
          'note-card': 'note',
          'doc-card': 'doc',
        };
        return {
          cardId: shape.id,
          kind: kindMap[shape.type],
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
          url: shape.props.url,
          title: shape.props.title,
          text: shape.props.text,
        };
      };

      const source = shapeToRunCard(sourceShape);
      const selection = contextShapes.map(shapeToRunCard);

      // Compute free-space placement hint to the right of the source.
      const placement = {
        x: sourceShape.x + sourceShape.props.w + PLACEMENT_OFFSET,
        y: sourceShape.y,
      };

      const request: any = {
        source,
        selection: selection.length > 0 ? selection : undefined,
        placement,
      };

      notify(`${agent.name} is working…`);
      runAgent(agent, request);
    },
    [editor, runAgent, notify],
  );

  return (
    <>
      <AskAgentAffordance onPickAgent={handlePickAgent} />
      <AgentDock />
      {toast ? <div className="jz-toast">{toast}</div> : null}
    </>
  );
}
