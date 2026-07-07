/**
 * Right-click "Tidy up" (feature: Tidy Up spike, local mode).
 *
 * Overrides tldraw's default context menu to prepend a single "Tidy up" item
 * whenever the drag-selection holds ≥2 cards. Selecting it masonry-packs just
 * that selection in place (see agents/tidyBoard.ts) — so the user can clean a
 * corner of the board without touching the rest. All of tldraw's stock actions
 * (cut/copy/duplicate/…) still render below via DefaultContextMenuContent.
 */

import {
  DefaultContextMenu,
  DefaultContextMenuContent,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  useEditor,
  useValue,
  type TLUiContextMenuProps,
} from 'tldraw';
import { canTidyBoard, useTidyBoard } from '../agents/tidyBoard';

export function TidyContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor();
  const { tidyBoard } = useTidyBoard();

  // Recompute against the live selection so the item appears/disappears as the
  // user's marquee grows past two cards.
  const selectedIds = useValue('tidy-ctx-selection', () => editor.getSelectedShapeIds(), [editor]);
  const canTidy = canTidyBoard(editor, selectedIds);

  return (
    <DefaultContextMenu {...props}>
      {canTidy ? (
        <TldrawUiMenuGroup id="jz-tidy">
          <TldrawUiMenuItem
            id="jz-tidy-up"
            label="Tidy up"
            readonlyOk
            onSelect={() => tidyBoard(selectedIds, { select: true })}
          />
        </TldrawUiMenuGroup>
      ) : null}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  );
}
