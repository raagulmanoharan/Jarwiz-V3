/**
 * Gently keep the currently-writing card in view during a sequential multi-card
 * run (compose fan-out, debrief recipe). When cards fill one after another, the
 * later ones can land off-screen or as a speck after the opening frame — so as
 * each one starts writing we pan (and, only when it'd be too small to read,
 * zoom) to bring it into view. Motion is minimal by design: a card already
 * comfortably framed is left alone.
 *
 * It YIELDS the moment the person takes over — editing a card, or panning /
 * zooming the board (pointer or wheel) — and never touches the camera again for
 * that run. The follow must never fight the hand that's driving (owner ask,
 * 2026-07-17).
 */

import type { Editor, TLShapeId } from 'tldraw';

/** Below this zoom a card is too small to read — bring it up to a readable size. */
const READABLE_ZOOM = 0.6;
/** Screen-pixel breathing room around the followed card. */
const MARGIN = 100;
/** Don't re-aim more than ~3×/sec — one calm move per burst of deltas. */
const THROTTLE_MS = 300;

export interface CardFollower {
  /** Bring `id` into view if it isn't already (throttled; no-op after yield). */
  follow(id: TLShapeId): void;
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
    follow(id) {
      if (yielded) return;
      if (editor.getEditingShapeId()) return; // never yank the view while editing
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      const b = editor.getShapePageBounds(id);
      if (!b) return;

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
    dispose() {
      container.removeEventListener('wheel', yieldNow);
      container.removeEventListener('pointerdown', yieldNow);
    },
  };
}
