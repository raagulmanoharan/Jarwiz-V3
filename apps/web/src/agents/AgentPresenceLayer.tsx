import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, type TLShape, type TLShapeId } from 'tldraw';
import { getAgent, type AgentMeta } from '@jarwiz/shared';
import { AgentCursorLayer } from './AgentCursorLayer';
import { AskAgentAffordance } from './AskAgentAffordance';
import { CommandPalette } from './CommandPalette';
import { dismissOffer } from './offers';
import { buildRunRequest, isCardShape } from './runRequest';
import { SuggestionChip } from './SuggestionChip';
import { useAgentRun } from './useAgentRun';
import { markOnboarded } from '../ui/onboarding';

const TOAST_DURATION_MS = 2800;

/**
 * The agent presence layer — everything agent-shaped that floats over the
 * canvas: the dock (live status), the ask-an-agent affordance (summoning),
 * the proactive offer chip, and the agent cursor overlay. The SSE runtime
 * (useAgentRun) drives presence as events arrive.
 */
export function AgentPresenceLayer() {
  const editor = useEditor();
  const { run, error } = useAgentRun();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimeout.current), []);

  // Surface run errors honestly as a toast.
  useEffect(() => {
    if (error) notify(error);
  }, [error, notify]);

  const runOnShapes = useCallback(
    (agent: AgentMeta, source: TLShape, context: TLShape[] = []) => {
      markOnboarded(); // a real summon retires the first-run nudge
      run(agent, buildRunRequest(editor, source, context));
    },
    [editor, run],
  );

  // Summoned: "Ask an agent" on the current selection.
  const handlePickAgent = useCallback(
    (agent: AgentMeta) => {
      const shapes = editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter(isCardShape);

      if (shapes.length === 0) {
        notify('Select a card first, then ask an agent.');
        return;
      }
      const [source, ...context] = shapes;
      if (source) runOnShapes(agent, source, context);
    },
    [editor, notify, runOnShapes],
  );

  // Offered: one-tap accept of a proactive suggestion chip.
  const handleAcceptOffer = useCallback(
    (shapeId: TLShapeId) => {
      const shape = editor.getShape(shapeId);
      dismissOffer(shapeId);
      if (isCardShape(shape)) runOnShapes(getAgent('summarizer'), shape);
    },
    [editor, runOnShapes],
  );

  return (
    <>
      <AgentCursorLayer />
      <SuggestionChip onAccept={handleAcceptOffer} />
      <AskAgentAffordance onPickAgent={handlePickAgent} />
      <CommandPalette onPickAgent={handlePickAgent} />
      {toast ? <div className="jz-toast">{toast}</div> : null}
    </>
  );
}
