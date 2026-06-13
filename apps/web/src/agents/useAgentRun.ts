/**
 * Hook to run an agent and apply its stream of events to the board.
 *
 * When called, opens an SSE connection to /api/agents/:id/run with the request,
 * listens for AgentEvents, and applies them to the tldraw store (creating cards,
 * streaming text into them, drawing edges, updating cursor and status).
 *
 * Returns the current run state: isRunning, error, abortController for cancellation.
 */

import { useCallback, useRef, useState } from 'react';
import { useEditor } from 'tldraw';
import type { AgentEvent, AgentMeta } from '@jarwiz/shared';
import { DOC_CARD_SIZE } from '../shapes/DocCardShapeUtil';

export interface AgentRunState {
  isRunning: boolean;
  error: string | null;
  abort: () => void;
}

export function useAgentRun() {
  const editor = useEditor();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (agent: AgentMeta, request: any) => {
      // Prevent overlapping runs.
      if (isRunning) return;

      setIsRunning(true);
      setError(null);

      // Cancel any previous run.
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      try {
        const response = await fetch(`/api/agents/${agent.id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error ?? `Server error: ${response.status}`);
        }

        // SSE response: read and parse each event.
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep last incomplete line

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: AgentEvent = JSON.parse(line.slice(6));
                applyAgentEvent(editor, event, agent);
              } catch (e) {
                console.error('Failed to parse agent event:', line, e);
              }
            }
          }
        }

        // Handle final buffered content.
        if (buffer.startsWith('data: ')) {
          try {
            const event: AgentEvent = JSON.parse(buffer.slice(6));
            applyAgentEvent(editor, event, agent);
          } catch (e) {
            console.error('Failed to parse final agent event:', buffer, e);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setIsRunning(false);
      }
    },
    [editor, isRunning],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  return { run, isRunning, error, abort };
}

/** Apply one AgentEvent to the editor's store. */
function applyAgentEvent(editor: any, event: AgentEvent, agent: AgentMeta): void {
  switch (event.type) {
    case 'status':
      // TODO: update dock status
      break;
    case 'cursor':
      // TODO: animate agent cursor
      break;
    case 'card.create': {
      const { cardId, kind, x, y, title } = event;
      const size = kind === 'doc' ? DOC_CARD_SIZE : { w: 220, h: 220 };
      editor.createShape({
        type: kind === 'doc' ? 'doc-card' : kind === 'note' ? 'note-card' : 'link-card',
        id: cardId,
        x,
        y,
        props: {
          w: size.w,
          h: size.h,
          text: '',
          title: kind === 'doc' ? title : undefined,
        },
      });
      break;
    }
    case 'card.delta': {
      const { cardId, textDelta } = event;
      const shape = editor.getShape(cardId);
      if (shape && 'text' in shape.props) {
        editor.updateShape({
          id: cardId,
          type: shape.type,
          props: { text: (shape.props as any).text + textDelta },
        });
      }
      break;
    }
    case 'card.done':
      // Streaming complete; nothing special to do.
      break;
    case 'edge.create': {
      const { fromCardId, toCardId, label } = event;
      editor.createShape({
        type: 'arrow',
        id: `edge_${fromCardId}_${toCardId}`,
        start: { type: 'binding', boundShapeId: fromCardId, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } },
        end: { type: 'binding', boundShapeId: toCardId, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } },
        props: {
          text: label,
        },
      });
      break;
    }
    case 'done':
      // Run complete.
      break;
    case 'error':
      // TODO: display error toast
      console.error('Agent error:', event.message);
      break;
  }
}
