/**
 * Scout client — reads the board, asks the server for grounded related
 * resources, and spawns accepted ones onto the canvas. The server does the
 * real work (grounded search + validation, see discover.ts); this hook owns
 * the request, the collected board summary, and the add-to-canvas action.
 */

import { useCallback, useRef, useState } from 'react';
import { useEditor, type Editor, type TLShapeId } from 'tldraw';
import type { SuggestedResource } from '@jarwiz/shared';
import { gatherBoardCards } from '../agents/boardText';

export type DiscoverPhase = 'idle' | 'thinking' | 'ready' | 'empty' | 'error';

/** Every http(s) URL already on the board — so we never re-suggest one. */
function existingUrls(editor: Editor): string[] {
  const urls: string[] = [];
  for (const s of editor.getCurrentPageShapes()) {
    const url = (s.props as { url?: unknown }).url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) urls.push(url);
  }
  return urls;
}

export function useDiscover() {
  const editor = useEditor();
  const [phase, setPhase] = useState<DiscoverPhase>('idle');
  const [resources, setResources] = useState<SuggestedResource[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const addCountRef = useRef(0); // fans spawned cards so they don't stack

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('thinking');
    setResources([]);
    addCountRef.current = 0;
    try {
      const cards = gatherBoardCards(editor);
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards, existingUrls: existingUrls(editor) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const data = (await res.json()) as { resources?: SuggestedResource[] };
      const found = data.resources ?? [];
      setResources(found);
      setPhase(found.length > 0 ? 'ready' : 'empty');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setPhase('error');
    }
  }, [editor]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setResources([]);
  }, []);

  /** Spawn a suggestion as a real card — putExternalContent routes the URL
   *  through the ingestion pipeline (link preview, YouTube/video, etc.). The
   *  added resource then leaves the drawer, and the fresh card is surfaced on
   *  top of the board (brought to front + selected) so it reads as "here it is".
   *  When the last suggestion is added the button resets to idle. */
  const addOne = useCallback(
    (r: SuggestedResource) => {
      const before = new Set(editor.getCurrentPageShapeIds());
      // Fan spawned cards down the right edge of the board so they don't stack.
      const b = editor.getCurrentPageBounds();
      const idx = addCountRef.current++;
      const point = b
        ? { x: b.maxX + 80, y: b.minY + idx * 240 }
        : editor.getViewportPageBounds().center;
      void editor.putExternalContent({ type: 'url', url: r.url, point });

      const remaining = resources.filter((x) => x.url !== r.url);
      setResources(remaining);
      if (remaining.length === 0) setPhase('idle');

      // Once the ingestion pipeline has created the card, title it, surface it
      // on top of the z-order, and select it so the new card is unmistakable.
      requestAnimationFrame(() => {
        const fresh = [...editor.getCurrentPageShapeIds()].find((id) => !before.has(id)) as
          | TLShapeId
          | undefined;
        if (!fresh) return;
        const shape = editor.getShape(fresh);
        if (shape && r.title && (shape.type === 'link-card' || shape.type === 'youtube-card')) {
          editor.updateShape({ id: fresh, type: shape.type, props: { title: r.title } } as Parameters<
            typeof editor.updateShape
          >[0]);
        }
        editor.bringToFront([fresh]);
        editor.select(fresh);
      });
    },
    [editor, resources],
  );

  return { phase, resources, run, dismiss, addOne };
}
