/**
 * Cards don't edit inline any more — double-clicking a card (or hitting the
 * action bar's Edit) opens it full-screen in focus mode, where there's room to
 * work (owner call 2026-07-20). The inline on-canvas editor is gone for every
 * card that has a focus view.
 *
 * We intercept the instant tldraw sets a card as the editing shape (its
 * double-click-to-edit path) and open focus instead. We must NOT null the
 * editingShapeId write here: by the time this fires, tldraw's select tool has
 * already committed to entering its `editing_shape` state, and that state's
 * onEnter throws ("Entered editing state without an editing shape") if the id
 * is null — the whole canvas then shows tldraw's crash screen (bug: double-
 * clicking any card). So we let the write land (onEnter is satisfied), then on
 * the very next microtask — before React ever paints an inline editor — open
 * focus and exit editing cleanly. Microtasks run before paint, so there's still
 * no flash or caret steal. Cards without a focus view (e.g. the machine runner)
 * are left alone, editing inline as before.
 */

import { useEffect } from 'react';
import { useEditor } from 'tldraw';
import { canFocusCard } from './CardFocusOverlay';
import { openCardFocus } from './focusCard';

export function EditToFocus() {
  const editor = useEditor();
  useEffect(() => {
    return editor.sideEffects.registerAfterChangeHandler('instance_page_state', (prev, next) => {
      const id = next.editingShapeId;
      if (id && id !== prev.editingShapeId) {
        const s = editor.getShape(id);
        if (s && canFocusCard(s.type)) {
          queueMicrotask(() => {
            openCardFocus(id);
            if (editor.getEditingShapeId() === id) editor.setEditingShape(null);
          });
        }
      }
    });
  }, [editor]);
  return null;
}
