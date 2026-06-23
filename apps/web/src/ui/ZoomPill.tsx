import { stopEventPropagation, useEditor, useValue } from 'tldraw';

/**
 * Bottom-right zoom control. `−  100%  +` — the percentage is a button:
 * single-click → zoom to fit content, double-click → reset to 100%.
 */
export function ZoomPill() {
  const editor = useEditor();
  const zoom = useValue('zoom-pct', () => editor.getZoomLevel(), [editor]);
  const pct = Math.round(zoom * 100);

  const onPctClick = (e: React.MouseEvent) => {
    if (e.detail >= 2) {
      editor.resetZoom();
    } else {
      const ids = Array.from(editor.getCurrentPageShapeIds());
      if (ids.length === 0) editor.resetZoom();
      else editor.zoomToFit();
    }
  };

  return (
    <div className="jz-zoom" onPointerDown={stopEventPropagation}>
      <button
        className="jz-zoom-btn"
        title="Zoom out"
        aria-label="Zoom out"
        onClick={() => editor.zoomOut()}
      >
        −
      </button>
      <button
        className="jz-zoom-pct"
        title="Click: fit to content · Double-click: reset to 100%"
        onClick={onPctClick}
      >
        {pct}%
      </button>
      <button
        className="jz-zoom-btn"
        title="Zoom in"
        aria-label="Zoom in"
        onClick={() => editor.zoomIn()}
      >
        +
      </button>
    </div>
  );
}
