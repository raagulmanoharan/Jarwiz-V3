import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, type TLShape, type TLShapeId } from 'tldraw';
import { JARWIZ, getAgent, type AgentMeta } from '@jarwiz/shared';
import { AgentCursorLayer } from './AgentCursorLayer';
import { AutopilotPresenceLayer } from './AutopilotPresenceLayer';
import { AskAgentAffordance } from './AskAgentAffordance';
import { CommandPalette } from './CommandPalette';
import { dissolveCluster, formCluster, onClusterJoin, type ClusterCandidate } from './cluster';
import { ClusterButton } from './ClusterButton';
import { CommentThread } from './CommentThread';
import { dismissOffer, getOffer, hasOffer, upsertOffer, type Offer, type Suggestion } from './offers';
import { ParticipantRoster } from './ParticipantRoster';
import { buildRunRequest, isCardShape } from './runRequest';
import { onSummon } from './summon';
import { clusterSuggestions, fetchClusterSuggestions } from './suggestions';
import { SuggestionPills } from './SuggestionPills';
import { useAgentRun } from './useAgentRun';
import { markOnboarded } from '../ui/onboarding';

/** A short surface label + kind for a card, for the cluster suggestion engine. */
function describeForCluster(shape: TLShape): { kind: string; title: string } {
  const props = shape.props as Record<string, unknown>;
  const title =
    (typeof props.title === 'string' && props.title) ||
    (typeof props.text === 'string' && props.text.slice(0, 80)) ||
    (typeof props.url === 'string' && props.url) ||
    (typeof props.name === 'string' && props.name) ||
    'card';
  return { kind: shape.type.replace('-card', ''), title: String(title) };
}

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

  // Summoned: "Ask Jarwiz" on the current selection, with an optional brief.
  // Internally always routes through the canonical Jarwiz identity — the
  // server picks which specialist actually handles the run.
  const handleAskJarwiz = useCallback(
    (brief?: string) => {
      const shapes = editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter(isCardShape);

      if (shapes.length === 0) {
        notify('Select a card first, then ask Jarwiz.');
        return;
      }
      const [source, ...context] = shapes;
      if (source) runOnShapes(getAgent(JARWIZ.routingId), source, context, brief);
    },
    [editor, notify, runOnShapes],
  );

  // Offered: one-tap accept of a proactive pill — runs its agent on the card,
  // or across the whole cluster (first card is the source, the rest context).
  const handleAcceptOffer = useCallback(
    (offer: Offer, suggestion: Suggestion) => {
      const shapes = offer.shapeIds.map((id) => editor.getShape(id)).filter(isCardShape);
      dismissOffer(offer.id);
      if (offer.kind === 'cluster') dissolveCluster(offer.id);
      const [source, ...context] = shapes;
      if (source) runOnShapes(getAgent(suggestion.agentId), source, context, suggestion.brief);
    },
    [editor, runOnShapes],
  );

  // Re-fetch a cluster's content-aware pills over its (possibly expanded) items.
  const refreshClusterOffer = useCallback(
    (offerId: string, ids: TLShapeId[], theme: string) => {
      const shapes = ids.map((id) => editor.getShape(id)).filter(isCardShape);
      upsertOffer({ id: offerId, kind: 'cluster', shapeIds: ids, suggestions: clusterSuggestions(), loading: true });
      const items = shapes.map(describeForCluster);
      void fetchClusterSuggestions({ items, theme }).then((tailored) => {
        if (!hasOffer(offerId)) return;
        upsertOffer({
          id: offerId,
          kind: 'cluster',
          shapeIds: ids,
          suggestions: tailored.length > 0 ? tailored : clusterSuggestions(),
          loading: false,
        });
      });
    },
    [editor],
  );

  // Auto-cluster: tidy the related drops into a row, select them, and raise
  // content-aware pills on the cluster (which coexist with each card's own pills).
  const handleCluster = useCallback(
    (candidate: ClusterCandidate) => {
      const shapes = candidate.ids.map((id) => editor.getShape(id)).filter(isCardShape);
      if (shapes.length < 2) return;
      const ids = shapes.map((s) => s.id);

      const boxes = shapes
        .map((s) => editor.getShapePageBounds(s.id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      const startX = Math.min(...boxes.map((b) => b.minX));
      const topY = Math.min(...boxes.map((b) => b.minY));

      editor.markHistoryStoppingPoint('cluster');
      editor.run(() => {
        let x = startX;
        for (const s of shapes) {
          const w = editor.getShapePageBounds(s.id)?.w ?? 280;
          editor.updateShape({ id: s.id, type: s.type, x, y: topY } as Parameters<
            typeof editor.updateShape
          >[0]);
          x += w + 28;
        }
      });
      editor.setSelectedShapes(ids);

      const offerId = `cluster:${Date.now()}`;
      formCluster(offerId, ids, candidate.theme); // later related drops join this
      refreshClusterOffer(offerId, ids, candidate.theme);
    },
    [editor, refreshClusterOffer],
  );

  // Whenever a new drop joins an existing cluster: slot it into the row and
  // refresh the cluster pills over the larger set (it keeps its own pills too).
  useEffect(
    () =>
      onClusterJoin(({ offerId, shapeId, theme }) => {
        const offer = getOffer(offerId);
        const newShape = editor.getShape(shapeId);
        if (!offer || !isCardShape(newShape)) return;
        const boxes = offer.shapeIds
          .map((id) => editor.getShapePageBounds(id))
          .filter((b): b is NonNullable<ReturnType<typeof editor.getShapePageBounds>> => Boolean(b));
        if (boxes.length > 0) {
          const rightX = Math.max(...boxes.map((b) => b.maxX)) + 28;
          const topY = Math.min(...boxes.map((b) => b.minY));
          editor.markHistoryStoppingPoint('cluster-join');
          editor.updateShape({ id: shapeId, type: newShape.type, x: rightX, y: topY } as Parameters<
            typeof editor.updateShape
          >[0]);
        }
        refreshClusterOffer(offerId, [...offer.shapeIds, shapeId], theme);
      }),
    [editor, refreshClusterOffer],
  );

  // Summoned through the summon bus — internal routing key still flows through,
  // even though the only public-facing identity is Jarwiz.
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
      <SuggestionPills onAccept={handleAcceptOffer} />
      <ClusterButton onCluster={handleCluster} />
      <AskAgentAffordance onAsk={handleAskJarwiz} />
      <CommandPalette onAsk={handleAskJarwiz} />
      <CommentThread />
      <ParticipantRoster onAsk={handleAskJarwiz} />
      {toast ? <div className="jz-toast">{toast}</div> : null}
    </>
  );
}
