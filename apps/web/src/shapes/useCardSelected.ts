/**
 * useCardSelected — is this card the/among the selected shape(s)?
 *
 * The single hook every card body uses to drive the ONE shared selected state
 * (the `jz-card-selected` ring in index.css). Selection is the only thing that
 * thickens a card's edge, and it must look identical on every card type — so
 * they all read selection the same way, here, rather than each reinventing it
 * (owner call 2026-07-10 — one selected state across all cards).
 */

import { useEditor, useValue, type TLShapeId } from 'tldraw';

export function useCardSelected(id: TLShapeId): boolean {
  const editor = useEditor();
  return useValue('card-selected', () => editor.getSelectedShapeIds().includes(id), [editor, id]);
}
