/**
 * The proactive-review loop. A few seconds after the board settles, Jarwiz
 * quietly reviews it (server /api/notice) and pins any comments worth leaving.
 * Deliberately calm: gated on board substance, debounced past any streaming
 * write, and re-run only when the board's TEXT actually changed — panning,
 * selecting or dragging never burns a model call.
 */

import { useEffect, useRef } from 'react';
import { useEditor } from 'tldraw';
import { gatherBoardCardsWithIds } from '../agents/boardText';
import { setComments } from './comments';

const MIN_CARDS = 3;
const SETTLE_MS = 4500;

export function useNotice() {
  const editor = useEditor();
  const lastSig = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      const cards = gatherBoardCardsWithIds(editor);
      if (cards.length < MIN_CARDS) return;
      // Content signature — re-review only when the words on the board change.
      const sig = cards.map((c) => `${c.id}:${c.text.length}:${(c.title || '').length}`).join('|');
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      running.current = true;
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const res = await fetch('/api/notice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cards, today: new Date().toISOString().slice(0, 10) }),
          signal: ac.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { comments?: unknown };
          setComments(Array.isArray(data.comments) ? (data.comments as Parameters<typeof setComments>[0]) : []);
        }
      } catch {
        /* offline / aborted — leave existing comments as they are */
      } finally {
        running.current = false;
      }
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, SETTLE_MS);
    };
    schedule(); // the board may already hold content on mount
    const unlisten = editor.store.listen(schedule, { scope: 'document', source: 'user' });
    return () => {
      unlisten();
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, [editor]);
}
