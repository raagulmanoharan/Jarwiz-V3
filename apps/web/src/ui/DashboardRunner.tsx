/**
 * Dashboard runner — the bridge between an on-canvas dashboard card and the
 * model. It lives in the overlay (so the shape needn't import the fetch/Ask
 * pipeline), listens for a card's build request, then streams an OpenUI Lang
 * spec straight into that same card's `spec` prop — the dashboard assembles
 * live inside the card. The card's status flips running → done (or error).
 * Mirrors PrototypeRunner, but the payload is a compact spec, not HTML.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useEditor } from 'tldraw';
import type { AskEvent } from '@jarwiz/shared';
import { readSSE } from '../agents/sse';
import { startStreaming, stopStreaming } from '../agents/streaming';
import { getDashboardRun, subscribeDashboardRun } from '../agents/dashboardRun';
import type { DashboardCardShape } from '../shapes';

export function DashboardRunner() {
  const editor = useEditor();
  const req = useSyncExternalStore(subscribeDashboardRun, getDashboardRun, getDashboardRun);

  useEffect(() => {
    if (!req) return;
    const shape = editor.getShape(req.id);
    if (!shape || shape.type !== 'dashboard-card') return;
    const prompt = req.prompt.trim();
    if (!prompt) return;

    const ac = new AbortController();
    const set = (props: Partial<DashboardCardShape['props']>) => {
      if (editor.getShape(req.id)) {
        editor.updateShape<DashboardCardShape>({ id: req.id, type: 'dashboard-card', props });
      }
    };

    set({ status: 'running', spec: '' });
    startStreaming(req.id);

    (async () => {
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, sources: [], shape: 'dashboard', skipClarify: true }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Dashboard failed (${res.status})`);
        let spec = '';
        let errored = false;
        await readSSE<AskEvent>(res.body, (e) => {
          if (e.type === 'card.delta') {
            spec += e.textDelta;
            set({ spec });
          } else if (e.type === 'error') {
            errored = true;
          }
        });
        set({ status: errored && !spec.trim() ? 'error' : 'done' });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') set({ status: 'error' });
      } finally {
        stopStreaming(req.id);
      }
    })();

    return () => {
      ac.abort();
      stopStreaming(req.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce]);

  return null;
}
