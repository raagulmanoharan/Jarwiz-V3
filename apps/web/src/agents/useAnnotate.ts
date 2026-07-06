/**
 * Annotate (Stickies mode), client side. The user explicitly picked Stickies
 * and asked Jarwiz to mark up their board ("TL;DR each link", "review my ideas").
 * We send the candidate cards (the selection, else the whole board) + the ask;
 * the server returns one short note per relevant card; we drop each as a sticky
 * NEXT TO its target. A distinct tint marks these as Jarwiz's notes, not yours.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type TLShapeId } from 'tldraw';
import type { AnnotateNote } from '@jarwiz/shared';
import { type NoteCardShape } from '../shapes';
import { gatherBoardCardsWithIds } from './boardText';

export type AnnotatePhase = 'idle' | 'thinking' | 'done' | 'error';

const NOTE_W = 240;
const NOTE_H = 168;
const GAP = 28;
/** Jarwiz's annotation tint — a cool sticky, distinct from the user's warm ones. */
const JARWIZ_STICKY = '#d6e4fb';

export function useAnnotate() {
  const editor = useEditor();
  const [phase, setPhase] = useState<AnnotatePhase>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (prompt: string) => {
      const q = prompt.trim();
      if (!q || phase === 'thinking') return;
      // Targets: the selection if there is one, else the whole board.
      const selected = new Set(editor.getSelectedShapeIds());
      const all = gatherBoardCardsWithIds(editor);
      const cards = selected.size ? all.filter((c) => selected.has(c.id)) : all;
      if (cards.length === 0) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase('thinking');
      try {
        const res = await fetch('/api/annotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: q, cards }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setPhase('error');
          return;
        }
        const data = (await res.json()) as { notes?: AnnotateNote[] };
        const notes = data.notes ?? [];
        const made: TLShapeId[] = [];
        // Does a w×h rect at (x,y) hit any existing shape? (Stickies we place
        // become shapes too, so later notes avoid earlier ones.)
        const hits = (x: number, y: number) =>
          editor.getCurrentPageShapes().some((s) => {
            const bb = editor.getShapePageBounds(s.id);
            return bb ? x < bb.maxX && x + NOTE_W > bb.minX && y < bb.maxY && y + NOTE_H > bb.minY : false;
          });
        for (const n of notes) {
          const b = editor.getShapePageBounds(n.cardId as TLShapeId);
          if (!b) continue;
          // Start just off the card's top-right corner, then nudge down (and, if
          // that column stays blocked, right) until the sticky sits in free space
          // — a note beside its card, never dropped on top of a neighbour.
          const x0 = b.maxX + GAP;
          let x = x0;
          let y = b.minY;
          for (let tries = 0; tries < 60 && hits(x, y); tries++) {
            y += NOTE_H + 16;
            if (y > b.maxY + 4 * (NOTE_H + 16)) { y = b.minY; x += NOTE_W + GAP; }
          }
          const id = createShapeId();
          editor.createShape<NoteCardShape>({
            id, type: 'note-card', x, y,
            props: { w: NOTE_W, h: NOTE_H, text: n.note, color: JARWIZ_STICKY },
          });
          made.push(id);
        }
        if (made.length) editor.select(...made);
        setPhase(made.length ? 'done' : 'idle');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setPhase('error');
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [editor, phase],
  );

  return { phase, run };
}
