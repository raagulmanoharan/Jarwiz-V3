/**
 * The sticky-note dock — a quiet button (bottom-left) that drops a sticky note
 * at the centre of the current view and opens it for typing right away. Sticky
 * notes are a first-class primitive: add one anywhere, write in it, move it.
 * Pressing "n" (when you're not already typing) does the same.
 */

import { useEffect } from 'react';
import { createShapeId, useEditor } from 'tldraw';
import { NOTE_CARD_SIZE, NOTE_PAPER, type NoteCardShape } from '../shapes';

export function StickyDock() {
  const editor = useEditor();

  const addNote = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<NoteCardShape>({
      id,
      type: 'note-card',
      x: c.x - NOTE_CARD_SIZE.w / 2,
      y: c.y - NOTE_CARD_SIZE.h / 2,
      props: { ...NOTE_CARD_SIZE, text: '', color: NOTE_PAPER },
    });
    editor.select(id);
    editor.setEditingShape(id);
  };

  // "n" drops a note — but never while typing in an input or editing a shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing || editor.getEditingShapeId()) return;
      e.preventDefault();
      addNote();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="jz-dock">
      <button className="jz-dock-btn" onClick={addNote} title="Add a sticky note (n)">
        <span className="jz-dock-icon" aria-hidden>
          ＋
        </span>
        Sticky note
      </button>
    </div>
  );
}
