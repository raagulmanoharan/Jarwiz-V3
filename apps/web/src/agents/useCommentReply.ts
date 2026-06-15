/**
 * Ask an agent to reply in a card's comment thread. Posts an empty agent
 * message, parks the agent's avatar beside the card ("replying…"), and streams
 * the answer into that message — the agent talking in the thread like a member.
 */

import { useCallback, useRef } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';
import { getAgent, type AgentId, type AutopilotEvent, type CardKind } from '@jarwiz/shared';
import { addComment, appendToComment, getThread } from './comments';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';

function cardKindOf(type: string): CardKind {
  return type.replace('-card', '') as CardKind;
}

function cardTextOf(props: Record<string, unknown>): string | undefined {
  if (typeof props.text === 'string') return props.text;
  if (Array.isArray(props.columns) && Array.isArray(props.rows)) {
    const cols = props.columns as string[];
    const rows = props.rows as string[][];
    return [cols, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
  }
  return undefined;
}

export function useCommentReply() {
  const editor = useEditor();
  const busyRef = useRef<Set<string>>(new Set());

  const ask = useCallback(
    async (cardId: TLShapeId, agentId: AgentId) => {
      const key = `${cardId}:${agentId}`;
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);

      const shape = editor.getShape(cardId);
      const props = (shape?.props ?? {}) as Record<string, unknown>;
      const thread = getThread(cardId).map((m) => ({
        author: m.author === 'you' ? 'you' : getAgent(m.author).name,
        text: m.text,
      }));

      const replyId = addComment(cardId, { author: agentId, text: '' });

      startPresence(agentId);
      setPresenceStatus(agentId, 'replying…');
      const bounds = editor.getShapePageBounds(cardId);
      if (bounds) setPresenceCursor(agentId, bounds.maxX + 16, bounds.minY + 24);

      const controller = new AbortController();
      try {
        const res = await fetch('/api/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            cardKind: shape ? cardKindOf(shape.type) : 'note',
            cardTitle: typeof props.title === 'string' ? props.title : undefined,
            cardText: cardTextOf(props),
            cardUrl: typeof props.url === 'string' ? props.url : undefined,
            thread,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error('reply failed');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handle = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            const event = JSON.parse(line.slice(6)) as AutopilotEvent;
            if (event.type === 'delta') appendToComment(cardId, replyId, event.textDelta);
          } catch {
            /* malformed frame */
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) handle(line);
        }
        handle(buffer);
      } catch {
        appendToComment(cardId, replyId, '(couldn’t reply just now)');
      } finally {
        endPresence(agentId);
        busyRef.current.delete(key);
      }
    },
    [editor],
  );

  return { ask };
}
