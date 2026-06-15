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
      <h1 className="jz-empty-hero">Drop a PDF to start.</h1>
      <p className="jz-empty-sub">
        Jarwiz is an infinite canvas for reading and reasoning over documents. Drop a PDF, flip
        through it, and ask anything — answers appear as cards right beside it.
      </p>
      <div className="jz-empty-hints">
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ⬓
          </span>
          Drag in a PDF
        </span>
        <span className="jz-empty-hint">
          <span className="jz-empty-glyph" aria-hidden>
            ✦
          </span>
          Ask a question about it
        </span>
      </div>
    </div>
  );
}
