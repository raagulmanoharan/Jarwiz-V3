/**
 * Run an agent and apply its event stream to the board.
 *
 * Opens an SSE connection to /api/agents/:id/run, parses each AgentEvent, and
 * applies it to the tldraw store — creating cards, streaming text into them
 * word by word, and drawing provenance edges — while driving the presence
 * store (cursor + status) so the dock and cursor overlay stay live.
 *
 * Server card ids ("card_1") are mapped to real tldraw shape ids on create,
 * so later deltas/edges that reference them resolve correctly. Ids that are
 * already tldraw shape ids (the source card the run was summoned on) pass
 * through untouched.
 */

import { useCallback, useRef, useState } from 'react';
import {
  createBindingId,
  createShapeId,
  toRichText,
  useEditor,
  type Editor,
  type TLArrowShape,
  type TLDefaultColorStyle,
  type TLShapeId,
} from 'tldraw';
import type { AgentEvent, AgentId, AgentMeta, AgentRunRequest } from '@jarwiz/shared';
import {
  DOC_CARD_SIZE,
  NOTE_CARD_SIZE,
  type DocCardShape,
  type NoteCardShape,
} from '../shapes';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';

/** Agent identity hue → nearest tldraw palette color (arrows use the palette). */
const ARROW_COLOR: Record<AgentId, TLDefaultColorStyle> = {
  researcher: 'blue',
  summarizer: 'orange',
  brainstormer: 'light-red',
  writer: 'green',
};

export function useAgentRun() {
  const editor = useEditor();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (agent: AgentMeta, request: AgentRunRequest) => {
      if (isRunning) return; // one run at a time from this hook

      setIsRunning(true);
      setError(null);
      startPresence(agent.id);

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      // Per-run mapping: server card id ("card_1") → real tldraw shape id.
      const idMap = new Map<string, TLShapeId>();
      const resolveId = (serverId: string): TLShapeId =>
        idMap.get(serverId) ?? (serverId as TLShapeId);

      const apply = (event: AgentEvent) =>
        applyAgentEvent(editor, event, agent, idMap, resolveId);

      try {
        const response = await fetch(`/api/agents/${agent.id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `Server error: ${response.status}`);
        }
        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const flushLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            apply(JSON.parse(line.slice(6)) as AgentEvent);
          } catch (parseError) {
            console.error('[jarwiz] bad agent event:', line, parseError);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) flushLine(line);
        }
        flushLine(buffer);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        endPresence(agent.id);
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

/** Apply one AgentEvent to the editor's store + presence. */
function applyAgentEvent(
  editor: Editor,
  event: AgentEvent,
  agent: AgentMeta,
  idMap: Map<string, TLShapeId>,
  resolveId: (serverId: string) => TLShapeId,
): void {
  switch (event.type) {
    case 'status':
      setPresenceStatus(agent.id, event.message);
      break;

    case 'cursor':
      setPresenceCursor(agent.id, event.x, event.y);
      break;

    case 'card.create': {
      const shapeId = createShapeId();
      idMap.set(event.cardId, shapeId);
      if (event.kind === 'note') {
        editor.createShape<NoteCardShape>({
          id: shapeId,
          type: 'note-card',
          x: event.x,
          y: event.y,
          props: { w: NOTE_CARD_SIZE.w, h: NOTE_CARD_SIZE.h, text: '' },
        });
      } else {
        editor.createShape<DocCardShape>({
          id: shapeId,
          type: 'doc-card',
          x: event.x,
          y: event.y,
          props: { w: DOC_CARD_SIZE.w, h: DOC_CARD_SIZE.h, text: '', title: event.title ?? '' },
        });
      }
      break;
    }

    case 'card.delta': {
      const shapeId = resolveId(event.cardId);
      const shape = editor.getShape(shapeId);
      if (shape && 'text' in (shape.props as object)) {
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: { text: (shape.props as { text: string }).text + event.textDelta },
        } as Parameters<typeof editor.updateShape>[0]);
      }
      break;
    }

    case 'card.done':
      break; // streaming complete; nothing to flush

    case 'edge.create':
      createEdge(
        editor,
        resolveId(event.fromCardId),
        resolveId(event.toCardId),
        event.label,
        ARROW_COLOR[agent.id],
      );
      break;

    case 'done':
      break;

    case 'error':
      setPresenceStatus(agent.id, event.message);
      console.error('[jarwiz] agent error:', event.message);
      break;
  }
}

/** Create an arrow bound from one card to another, in the agent's color. */
function createEdge(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
  label: string | undefined,
  color: TLDefaultColorStyle,
): void {
  if (!editor.getShape(fromId) || !editor.getShape(toId)) return;

  const arrowId = createShapeId();
  editor.createShape<TLArrowShape>({
    id: arrowId,
    type: 'arrow',
    props: {
      color: color as TLDefaultColorStyle,
      ...(label ? { richText: toRichText(label) } : {}),
    },
  });

  editor.createBindings([
    {
      id: createBindingId(),
      type: 'arrow',
      fromId: arrowId,
      toId: fromId,
      props: {
        terminal: 'start',
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
        snap: 'none',
      },
    },
    {
      id: createBindingId(),
      type: 'arrow',
      fromId: arrowId,
      toId: toId,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
        snap: 'none',
      },
    },
  ]);
}
