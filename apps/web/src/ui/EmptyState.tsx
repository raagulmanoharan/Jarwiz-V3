import { useSyncExternalStore } from 'react';
import { useValue, useEditor } from 'tldraw';
import { getActiveBoard, subscribeBoards } from '../boards/boardStore';

/**
 * The cold-board invitation shown when an existing board is empty (the user
 * deleted everything or is returning to a cleared board). Hidden on brand-new
 * boards — BoardEntry handles that case with the onboarding dialog.
 * Purely decorative — pointer-events: none — so the canvas stays interactive.
 */
export function EmptyState() {
  const editor = useEditor();
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const isEmpty = useValue(
    'jarwiz board empty',
    () => editor.getCurrentPageShapeIds().size === 0,
    [editor],
  );

  if (!isEmpty || board?.isNew) return null;

  return (
    <div className="jz-empty" aria-hidden>
      <h1 className="jz-empty-hero">Start a new idea.</h1>
      <p className="jz-empty-sub">
        Drop a PDF, press <kbd>d</kbd> for a doc, or <kbd>n</kbd> for a sticky. Ask any agent with{' '}
        <kbd>⌘K</kbd>.
      </p>
      <div className="jz-empty-hints">
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ⬓
          </span>
          Drop a PDF
        </span>
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ✦
          </span>
          d — new doc
        </span>
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ◻
          </span>
          n — sticky note
        </span>
      </div>
    </div>
  );
}
