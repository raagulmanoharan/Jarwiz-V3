/**
 * The opinion agents (Big Rocks 2.3 / 3.1 / 3.2), now streamed and visibly
 * collaborative. Runs a lens over the board (or selection), drops a titled doc
 * card instantly (skeleton), and the Writer agent's cursor parks on it and
 * writes the analysis in live — never silent, cancellable, with error + Retry.
 */

import { useCallback, useState } from 'react';
import { createShapeId, useEditor } from 'tldraw';
import { getAgent, type AnalyzeMode } from '@jarwiz/shared';
import { gatherBoardCards } from './boardText';
import { frameBounds } from '../ui/bringIntoView';
import { readSSE } from './sse';
import { startStreaming, stopStreaming } from './streaming';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { clearAgentTask, setAgentTask } from './agentTask';
import { agentErrorMessage } from '../lib/backend';
import { DOC_CARD_SIZE, type DocCardShape } from '../shapes';

const AGENT = getAgent('writer');
const TITLES: Record<AnalyzeMode, string> = { tensions: 'Tensions', gaps: "What's missing", critique: "Devil's advocate" };
const STATUS: Record<AnalyzeMode, string> = { tensions: 'Scanning for tensions…', gaps: 'Reviewing the board…', critique: 'Sharpening a critique…' };
const TIMEOUT_MS = 60_000;

type Delta = { type: 'delta'; textDelta: string } | { type: 'done' } | { type: 'error'; message: string };

export function useAnalyze() {
  const editor = useEditor();
  const [runningMode, setRunningMode] = useState<AnalyzeMode | null>(null);

  const analyze = useCallback(
    async (mode: AnalyzeMode) => {
      const selectionOnly = mode === 'critique' && editor.getSelectedShapeIds().length > 0;
      const cards = gatherBoardCards(editor, { selectionOnly });
      if (cards.length === 0) return;

      // Destination: to the right of what we analysed (or the viewport centre).
      const considered = selectionOnly ? editor.getSelectedShapeIds() : editor.getCurrentPageShapes().map((s) => s.id);
      const bounds = considered.map((id) => editor.getShapePageBounds(id)).filter((b): b is NonNullable<typeof b> => Boolean(b));
      let x: number, y: number;
      if (bounds.length) { x = Math.max(...bounds.map((b) => b.maxX)) + 80; y = Math.min(...bounds.map((b) => b.minY)); }
      else { const c = editor.getViewportPageBounds().center; x = c.x - DOC_CARD_SIZE.w / 2; y = c.y - DOC_CARD_SIZE.h / 2; }

      const taskId = `analyze-${mode}`;
      setRunningMode(mode);

      // Drop the card instantly so it's never silent; the agent writes into it.
      editor.markHistoryStoppingPoint('analyze');
      const id = createShapeId();
      editor.createShape<DocCardShape>({ id, type: 'doc-card', x, y, props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, title: TITLES[mode], text: '', sourcePdfId: '' } });
      editor.select(id);
      startStreaming(id);

      // Presence: the Writer walks over and works on the card.
      startPresence(AGENT.id);
      setPresenceStatus(AGENT.id, STATUS[mode]);
      const moveCursor = () => { const b = editor.getShapePageBounds(id); if (b) setPresenceCursor(AGENT.id, b.maxX - 14, b.maxY - 16); };
      moveCursor();

      const ac = new AbortController();
      let cancelled = false;
      let timedOut = false;
      let got = false;
      let errorMsg: string | null = null;
      setAgentTask({ id: taskId, anchorId: id, status: 'running', label: STATUS[mode], onCancel: () => { cancelled = true; ac.abort(); } });
      const timer = setTimeout(() => { timedOut = true; ac.abort(); }, TIMEOUT_MS);

      try {
        const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, cards }), signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(`analyze failed (${res.status})`);
        await readSSE<Delta>(res.body, (ev) => {
          if (ev.type === 'delta') {
            got = true;
            const s = editor.getShape(id) as DocCardShape | undefined;
            if (s) { editor.updateShape<DocCardShape>({ id, type: 'doc-card', props: { text: s.props.text + ev.textDelta } }); moveCursor(); }
          } else if (ev.type === 'error') { errorMsg = ev.message; }
        });
        if (errorMsg) throw new Error(errorMsg);
        clearAgentTask(taskId);
        const b = editor.getShapePageBounds(id);
        // targetZoom caps at 100% — framing a single card must never magnify
        // it past natural size (text balloons and padding reads as broken).
        if (b) frameBounds(editor, b, { margin: 60, animation: { duration: 300 } });
      } catch (err) {
        if (cancelled) {
          const s = editor.getShape(id) as DocCardShape | undefined;
          if (s && !s.props.text) editor.deleteShape(id);
          clearAgentTask(taskId);
        } else {
          const s = editor.getShape(id) as DocCardShape | undefined;
          if (s && !got) editor.deleteShape(id); // nothing arrived → don't leave a husk
          const message = timedOut ? 'The agent timed out.' : agentErrorMessage(err instanceof Error ? err.message : 'The agent failed.');
          setAgentTask({ id: taskId, anchorId: got ? id : null, status: 'error', label: TITLES[mode], error: message, onRetry: () => { clearAgentTask(taskId); void analyze(mode); } });
        }
      } finally {
        clearTimeout(timer);
        stopStreaming(id);
        endPresence(AGENT.id);
        setRunningMode(null);
      }
    },
    [editor],
  );

  return { analyze, runningMode };
}
