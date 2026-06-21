/**
 * The canvas toolbar — Jarwiz's content creators + the FigJam-grade primitive
 * palette, in one bottom-centre strip.
 *
 * Left group: our agent-aware content cards — Doc (`d`) and Sticky note (`n`) —
 * which deliberately stay richer than tldraw's native note. A divider, then the
 * curated tldraw primitives. tldraw owns tool activation, selection state, and
 * keyboard shortcuts; we choose what shows and add the two creators.
 *
 * Keyboard: v select · h hand · t text · r rectangle · o ellipse · a arrow ·
 * l line · f frame · e eraser. `d`/`n` are Jarwiz's (doc/note); the draw tool is
 * reached from this toolbar rather than `d`.
 */

import { useEffect } from 'react';
import {
  ArrowToolbarItem,
  createShapeId,
  DefaultStylePanel,
  DefaultToolbar,
  DiamondToolbarItem,
  DrawToolbarItem,
  EllipseToolbarItem,
  EraserToolbarItem,
  FrameToolbarItem,
  HandToolbarItem,
  LineToolbarItem,
  RectangleToolbarItem,
  SelectToolbarItem,
  TextToolbarItem,
  useEditor,
  useValue,
} from 'tldraw';
import { NOTE_CARD_SIZE, NOTE_PAPER, DOC_CARD_SIZE, type NoteCardShape, type DocCardShape } from '../shapes';

export function CanvasToolbar() {
  const editor = useEditor();

  const addDoc = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<DocCardShape>({
      id, type: 'doc-card', x: c.x - DOC_CARD_SIZE.w / 2, y: c.y - DOC_CARD_SIZE.h / 2,
      props: { ...DOC_CARD_SIZE, text: '', title: '', sourcePdfId: '' },
    });
    editor.select(id);
    editor.setEditingShape(id);
  };

  const addNote = () => {
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape<NoteCardShape>({
      id, type: 'note-card', x: c.x - NOTE_CARD_SIZE.w / 2, y: c.y - NOTE_CARD_SIZE.h / 2,
      props: { ...NOTE_CARD_SIZE, text: '', color: NOTE_PAPER },
    });
    editor.select(id);
    editor.setEditingShape(id);
  };

  // "d" drops a doc; "n" drops a note — never while typing or editing a shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing || editor.getEditingShapeId()) return;
      if (e.key === 'd') { e.preventDefault(); addDoc(); }
      if (e.key === 'n') { e.preventDefault(); addNote(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <DefaultToolbar>
      <button className="jz-tool-create" title="Start a doc (d)" onClick={addDoc}>
        <span className="jz-tool-glyph" aria-hidden>✎</span>Doc
      </button>
      <button className="jz-tool-create" title="Add a sticky note (n)" onClick={addNote}>
        <span className="jz-tool-glyph" aria-hidden>＋</span>Note
      </button>
      <span className="jz-tool-divider" aria-hidden />
      <SelectToolbarItem />
      <HandToolbarItem />
      <TextToolbarItem />
      <RectangleToolbarItem />
      <EllipseToolbarItem />
      <DiamondToolbarItem />
      <ArrowToolbarItem />
      <LineToolbarItem />
      <DrawToolbarItem />
      <FrameToolbarItem />
      <EraserToolbarItem />
    </DefaultToolbar>
  );
}

/** Tools that "create" a styled shape — the style panel is useful as a
 *  pre-flight even before anything is selected. */
const CREATION_TOOLS = new Set(['geo', 'text', 'arrow', 'line', 'draw', 'frame', 'highlight', 'note']);

/**
 * The style panel, gated for calm: hidden on an empty board with the select
 * tool, shown the moment you select a shape or pick a creation tool.
 */
export function CanvasStylePanel() {
  const editor = useEditor();
  const show = useValue(
    'show-style-panel',
    () => editor.getSelectedShapeIds().length > 0 || CREATION_TOOLS.has(editor.getCurrentToolId()),
    [editor],
  );
  if (!show) return null;
  return <DefaultStylePanel />;
}
