/**
 * Prototype runner — the bridge between an on-canvas prototype card and the
 * model. It lives in the overlay (so the shape needn't import the fetch/Ask
 * pipeline), listens for a card's Generate request, then streams a self-contained
 * HTML document straight into that same card's `html` prop — the UI builds live
 * inside the card. The card's status flips idle → running → done (or error).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useEditor } from 'tldraw';
import type { AskEvent } from '@jarwiz/shared';
import { readSSE } from '../agents/sse';
import { startStreaming, stopStreaming } from '../agents/streaming';
import { getPrototypeRun, subscribePrototypeRun } from '../agents/prototypeRun';
import { PROTOTYPE_CARD_SIZE, type PrototypeCardShape } from '../shapes';

export function PrototypeRunner() {
  const editor = useEditor();
  const req = useSyncExternalStore(subscribePrototypeRun, getPrototypeRun, getPrototypeRun);

  useEffect(() => {
    if (!req) return;
    const shape = editor.getShape(req.id);
    if (!shape || shape.type !== 'prototype-card') return;
    const prompt = (shape as PrototypeCardShape).props.prompt.trim();
    if (!prompt) return;

    const ac = new AbortController();
    const set = (props: Partial<PrototypeCardShape['props']>) => {
      if (editor.getShape(req.id)) {
        editor.updateShape<PrototypeCardShape>({ id: req.id, type: 'prototype-card', props });
      }
    };

    // Fresh run: clear any prior UI and mark the card running. A small prompt
    // card (dropped from the rail) grows to a full canvas; an unlabelled one
    // takes the prompt as its floating label. Marking it "streaming" keeps it
    // non-interactive while it builds.
    const cur = shape as PrototypeCardShape;
    set({
      status: 'running',
      html: '',
      ...(cur.props.w < PROTOTYPE_CARD_SIZE.w ? { w: PROTOTYPE_CARD_SIZE.w, h: PROTOTYPE_CARD_SIZE.h } : {}),
      ...((cur.props.title ?? '').trim() ? {} : { title: prompt.slice(0, 70) }),
    });
    startStreaming(req.id);

    (async () => {
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, sources: [], shape: 'prototype', skipClarify: true }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Prototype failed (${res.status})`);
        let html = '';
        let errored = false;
        await readSSE<AskEvent>(res.body, (e) => {
          if (e.type === 'card.delta') {
            html += e.textDelta;
            set({ html });
          } else if (e.type === 'error') {
            errored = true;
          }
        });
        set({ status: errored && !html.trim() ? 'error' : 'done' });
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
