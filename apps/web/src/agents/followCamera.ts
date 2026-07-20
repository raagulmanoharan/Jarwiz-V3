/**
 * Gently keep the streaming cards in view during a multi-card run (compose
 * fan-out, debrief recipe). Cards fill a few at once, growing taller as content
 * arrives, so their combined bounds can spill past the opening frame — as they
 * grow we pan (and, only when they'd be too small to read, zoom) to keep them
 * in view. Motion is minimal by design: a set already comfortably framed is
 * left alone. Pass one id or several — several are unioned, so the whole
 * building cluster stays framed rather than the camera chasing one card.
 *
 * It YIELDS the moment the person takes over — editing a card, or panning /
 * zooming the board (pointer or wheel) — and never touches the camera again for
 * that run. The follow must never fight the hand that's driving (owner ask,
 * 2026-07-17).
 */

import type { Box, Editor, TLShapeId } from 'tldraw';

/** Below this zoom a card is too small to read — bring it up to a readable size. */
const READABLE_ZOOM = 0.6;
/** Screen-pixel breathing room around the followed card. */
const MARGIN = 100;
/** Don't re-aim more than ~3×/sec — one calm move per burst of deltas. */
const THROTTLE_MS = 300;

export interface CardFollower {
  /** Bring the shape(s) into view if they aren't already (throttled; no-op
   *  after yield). Several ids are unioned into one bounds. */
  follow(ids: TLShapeId | TLShapeId[]): void;
  /** True once the person has taken the camera (a wheel/pointer gesture). A
   *  run's own one-shot reframes must check this so they don't fight the hand
   *  that's now driving — the follow() no-op alone isn't enough when a run also
   *  calls the camera directly. */
  yielded(): boolean;
  /** Detach the take-over listeners. Call in the run's finally block. */
  dispose(): void;
}

export function makeCardFollower(editor: Editor): CardFollower {
  let yielded = false;
  let last = 0;
  const yieldNow = () => {
    yielded = true;
  };
  // Any manual canvas gesture after the run begins = the person is driving now.
  const container = editor.getContainer();
  container.addEventListener('wheel', yieldNow, { passive: true });
  container.addEventListener('pointerdown', yieldNow, { passive: true });

  return {
    follow(ids) {
      if (yielded) return;
      if (editor.getEditingShapeId()) return; // never yank the view while editing
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      const arr = Array.isArray(ids) ? ids : [ids];
      const boxes = arr
        .map((id) => editor.getShapePageBounds(id))
        .filter((box): box is Box => Boolean(box));
      if (boxes.length === 0) return;
      const b = boxes.reduce((acc, box) => acc.union(box), boxes[0]!.clone());

      const vpPage = editor.getViewportPageBounds();
      const vpScreen = editor.getViewportScreenBounds();
      const z = editor.getZoomLevel();
      const marginPage = MARGIN / z;
      const inView =
        b.minX >= vpPage.minX + marginPage &&
        b.maxX <= vpPage.maxX - marginPage &&
        b.minY >= vpPage.minY + marginPage &&
        b.maxY <= vpPage.maxY - marginPage;
      // Comfortably framed and readable → leave the camera be (calm, no nudging).
      if (inView && z >= READABLE_ZOOM) return;
      last = now;

      // Keep the person's zoom unless the card is a speck; then zoom in to a
      // readable size (by width, capped at 100%) — never zoom OUT on a tall card,
      // which would shrink the whole board as an answer grows.
      const widthFit = (vpScreen.w - MARGIN * 2) / b.w;
      const zoom = z < READABLE_ZOOM ? Math.max(z, Math.min(1, widthFit)) : z;
      // Centre horizontally. Vertically, if the card is taller than the viewport,
      // ride its BOTTOM edge (the newest text) rather than its middle.
      const tallerThanView = b.h * zoom > vpScreen.h - MARGIN * 2;
      const focusY = tallerThanView ? b.maxY - (vpScreen.h / 2 - MARGIN) / zoom : b.midY;
      editor.setCamera(
        { x: vpScreen.w / 2 / zoom - b.midX, y: vpScreen.h / 2 / zoom - focusY, z: zoom },
        { animation: { duration: THROTTLE_MS } },
      );
    },
    yielded() {
      return yielded;
    },
    dispose() {
      container.removeEventListener('wheel', yieldNow);
      container.removeEventListener('pointerdown', yieldNow);
    },
  };
}
