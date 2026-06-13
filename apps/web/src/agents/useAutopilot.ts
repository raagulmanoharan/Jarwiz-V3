/**
 * Autopilot (Tab-to-continue) — the client half. While the user is editing a
 * doc or note card, Tab asks an agent to continue their writing in place: the
 * Writer's avatar parks beside the card and the continuation streams into the
 * text, multiplayer-style. See docs/ROADMAP.md §9 (M4, phase A0).
 *
 * The trust contract:
 *   - Tab           → start (or, while running, this hook is re-entrant-safe).
 *   - any other key → yield instantly: abort the stream, hand the pen back.
 *   - Esc           → stop.
 *   - one Tab-fill  → one undo (a single history stopping point up front).
 * Insert-only: the agent appends at the end of the current text, never rewrites
 * what the user typed.
 */

import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEditor, type TLShape, type TLShapeId } from 'tldraw';
import { getAgent, type AutopilotEvent } from '@jarwiz/shared';
import { endPresence, setPresenceCursor, setPresenceStatus, startPresence } from './presence';
import { startStreaming, stopStreaming } from './streaming';

const WRITER = getAgent('writer');

type Continuable = TLShape & { props: { text: string; title?: string } };

function isContinuable(shape: TLShape | undefined): shape is Continuable {
  return (
    !!shape &&
    (shape.type === 'doc-card' || shape.type === 'note-card') &&
    typeof (shape.props as { text?: unknown }).text === 'string'
  );
}

export function useAutopilot() {
  const editor = useEditor();
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<TLShapeId | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const id = activeRef.current;
    if (id) stopStreaming(id);
    activeRef.current = null;
    endPresence(WRITER.id);
  }, []);

  const start = useCallback(
    async (shapeId: TLShapeId) => {
      if (activeRef.current) return; // one continuation at a time
      const shape = editor.getShape(shapeId);
      if (!isContinuable(shape)) return;

      const kind = shape.type === 'note-card' ? 'note' : 'doc';
      const baseText = shape.props.text;
      const title = shape.props.title;

      // The whole continuation collapses to a single undo.
      editor.markHistoryStoppingPoint('autopilot');

      const controller = new AbortController();
      abortRef.current = controller;
      activeRef.current = shapeId;
      startStreaming(shapeId);

      // Park the Writer beside the card.
      startPresence(WRITER.id);
      setPresenceStatus(WRITER.id, 'continuing your draft…');
      const bounds = editor.getShapePageBounds(shapeId);
      if (bounds) setPresenceCursor(WRITER.id, bounds.maxX + 16, bounds.minY + 24);

      let appended = '';
      const flush = (event: AutopilotEvent) => {
        if (event.type !== 'delta') return;
        appended += event.textDelta;
        const current = editor.getShape(shapeId);
        if (!isContinuable(current)) return;
        editor.updateShape({
          id: shapeId,
          type: current.type,
          props: { text: baseText + appended },
        } as Parameters<typeof editor.updateShape>[0]);
      };

      try {
        const response = await fetch('/api/autopilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, text: baseText, title }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('autopilot request failed');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handleLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            flush(JSON.parse(line.slice(6)) as AutopilotEvent);
          } catch {
            /* ignore malformed frame */
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) handleLine(line);
        }
        handleLine(buffer);
      } catch {
        /* aborted (yield-on-type / Esc) or network — nothing to surface */
      } finally {
        if (activeRef.current === shapeId) stop();
      }
    },
    [editor, stop],
  );

  const isRunning = useCallback((shapeId: TLShapeId) => activeRef.current === shapeId, []);

  /**
   * Wire onto an editing textarea. Tab continues; Esc stops; any input key
   * while a continuation streams yields the pen back (the keystroke then falls
   * through to the textarea as normal).
   */
  const onKeyDown = useCallback(
    (shapeId: TLShapeId, e: ReactKeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation(); // don't let tldraw move selection on Tab
        if (!activeRef.current) void start(shapeId);
        return;
      }
      if (!activeRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // stop autopilot, don't exit edit mode
        stop();
        return;
      }
      const typing =
        (e.key.length === 1 && !e.metaKey && !e.ctrlKey) ||
        e.key === 'Enter' ||
        e.key === 'Backspace' ||
        e.key === 'Delete';
      if (typing) stop(); // yield — let the keystroke take over
    },
    [start, stop],
  );

  return { start, stop, isRunning, onKeyDown };
}
