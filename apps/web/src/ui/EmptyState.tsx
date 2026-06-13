import { useValue, useEditor } from 'tldraw';

/**
 * The cold-board invitation. Not a void: a calm editorial hero that points at
 * the golden path. Renders only while the board is empty and disappears the
 * moment the first card lands. Purely decorative — pointer-events: none — so
 * the canvas underneath stays fully interactive.
 */
export function EmptyState() {
  const editor = useEditor();
  const isEmpty = useValue(
    'jarwiz board empty',
    () => editor.getCurrentPageShapeIds().size === 0,
    [editor],
  );

  if (!isEmpty) return null;

  return (
    <div className="jz-empty" aria-hidden>
      <h1 className="jz-empty-hero">Drop a link, or write a thought.</h1>
      <p className="jz-empty-sub">
        Jarwiz is an infinite canvas where research, summaries, and drafts appear as cards — made by
        agents working alongside you.
      </p>
      <div className="jz-empty-hints">
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ⌘V
          </span>
          Paste a link
        </span>
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ⬓
          </span>
          Drag in a file
        </span>
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ✦
          </span>
          Select a card, ask an agent
        </span>
      </div>
    </div>
  );
}
