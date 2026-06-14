import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, type TLShape, type TLShapeId } from 'tldraw';
import { getAgent, type AgentMeta } from '@jarwiz/shared';
import { AgentCursorLayer } from './AgentCursorLayer';
import { AutopilotPresenceLayer } from './AutopilotPresenceLayer';
import { AskAgentAffordance } from './AskAgentAffordance';
import { CommandPalette } from './CommandPalette';
import { CommentThread } from './CommentThread';
import { MentionMenu } from './MentionMenu';
import { dismissOffer } from './offers';
import { ParticipantRoster } from './ParticipantRoster';
import { buildRunRequest, isCardShape } from './runRequest';
import { onSummon } from './summon';
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
    (agent: AgentMeta, source: TLShape, context: TLShape[] = [], brief?: string) => {
      markOnboarded(); // a real summon retires the first-run nudge
      run(agent, buildRunRequest(editor, source, context, brief));
    },
    [editor, run],
  );

  // Summoned: "Ask an agent" on the current selection, with an optional brief.
  const handlePickAgent = useCallback(
    (agent: AgentMeta, brief?: string) => {
      const shapes = editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter(isCardShape);

      if (shapes.length === 0) {
        notify('Select a card first, then ask an agent.');
        return;
      }
      const [source, ...context] = shapes;
      if (source) runOnShapes(agent, source, context, brief);
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

  // Addressed by name: an @mention (or any summon channel) calls an agent on a card.
  useEffect(
    () =>
      onSummon(({ agentId, cardId }) => {
        const shape = editor.getShape(cardId);
        if (isCardShape(shape)) runOnShapes(getAgent(agentId), shape);
      }),
    [editor, runOnShapes],
  );

  return (
    <>
      <AgentCursorLayer />
      <AutopilotPresenceLayer />
      <SuggestionChip onAccept={handleAcceptOffer} />
      <AskAgentAffordance onPickAgent={handlePickAgent} />
      <CommandPalette onPickAgent={handlePickAgent} />
      <MentionMenu />
      <CommentThread />
      <ParticipantRoster onPick={handlePickAgent} />
      {toast ? <div className="jz-toast">{toast}</div> : null}
    </>
  );
}
