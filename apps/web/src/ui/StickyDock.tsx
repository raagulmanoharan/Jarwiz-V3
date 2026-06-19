/**
 * The canvas dock — quiet bottom-left buttons that drop first-class writing
 * primitives at the centre of the current view, opened for typing immediately.
 *
 * Sticky note  →  "n" key or the first button
 * Doc card     →  "d" key or the second button
 */

import { useEffect } from 'react';
import { createShapeId, useEditor } from 'tldraw';
import { NOTE_CARD_SIZE, NOTE_PAPER, DOC_CARD_SIZE, type NoteCardShape, type DocCardShape } from '../shapes';

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

  const addDoc = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<DocCardShape>({
      id,
      type: 'doc-card',
      x: c.x - DOC_CARD_SIZE.w / 2,
      y: c.y - DOC_CARD_SIZE.h / 2,
      props: { ...DOC_CARD_SIZE, text: '', title: '', sourcePdfId: '' },
    });
    editor.select(id);
    editor.setEditingShape(id);
  };

  // "n" drops a note; "d" drops a doc — never while typing in an input or editing a shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing || editor.getEditingShapeId()) return;
      if (e.key === 'n') { e.preventDefault(); addNote(); }
      if (e.key === 'd') { e.preventDefault(); addDoc(); }
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
      <button className="jz-dock-btn" onClick={addDoc} title="Start a doc (d)">
        <span className="jz-dock-icon" aria-hidden>
          ✎
        </span>
        Doc
      </button>
    </div>
  );
}
