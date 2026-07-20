/**
 * Cards don't edit inline any more — double-clicking a card (or hitting the
 * action bar's Edit) opens it full-screen in focus mode, where there's room to
 * work (owner call 2026-07-20). The inline on-canvas editor is gone for every
 * card that has a focus view.
 *
 * We enforce it at the store's edge: the instant tldraw tries to set a card as
 * the editing shape (its double-click-to-edit path), we VETO that write and
 * open focus instead. Vetoing before the change lands means the inline editor
 * never renders for even one frame — no flash, no caret steal. Cards without a
 * focus view (e.g. the machine runner) are left alone.
 */

import { useEffect } from 'react';
import { useEditor } from 'tldraw';
import { canFocusCard } from './CardFocusOverlay';
import { openCardFocus } from './focusCard';

export function EditToFocus() {
  const editor = useEditor();
  useEffect(() => {
    return editor.sideEffects.registerBeforeChangeHandler('instance_page_state', (prev, next) => {
      const id = next.editingShapeId;
      if (id && id !== prev.editingShapeId) {
        const s = editor.getShape(id);
        if (s && canFocusCard(s.type)) {
          // Defer the store-touching open out of this transaction; veto the edit.
          queueMicrotask(() => openCardFocus(id));
          return { ...next, editingShapeId: null };
        }
      }
      return next;
    });
  }, [editor]);
  return null;
}
