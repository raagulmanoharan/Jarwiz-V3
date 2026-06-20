/**
 * The canvas toolbar — Jarwiz's FigJam-grade primitive palette.
 *
 * tldraw ships every primitive we want (text, shapes, connectors, draw, frames);
 * the app had simply suppressed the toolbar UI (App.tsx `Toolbar: null`) to stay
 * card-focused. This re-enables a *curated, calm* subset via tldraw's own
 * DefaultToolbar so tool activation, selection state, and keyboard shortcuts all
 * come from the engine — we only choose which tools show.
 *
 * Deliberately omitted: the native sticky `note` tool. Jarwiz already has a
 * richer, agent-aware note-card (dock + `n`), so a second sticky would be
 * incoherent. Same reasoning keeps doc content in our doc-card (`d`), while the
 * toolbar adds free-floating canvas text the card model never offered.
 *
 * Keyboard map (tldraw defaults, except where Jarwiz already binds the key):
 *   v select · h hand · t text · r rectangle · o ellipse · a arrow · l line
 *   f frame · e eraser.  `d` stays Jarwiz Doc and `n` stays Jarwiz note (see
 *   StickyDock) — the draw tool is reached from this toolbar rather than `d`.
 */

import {
  ArrowToolbarItem,
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

export function CanvasToolbar() {
  return (
    <DefaultToolbar>
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
 * tool, shown the moment you select a shape or pick a creation tool (so you can
 * pre-set color/size before drawing). Keeps the cold canvas quiet.
 */
export function CanvasStylePanel() {
  const editor = useEditor();
  const show = useValue(
    'show-style-panel',
    () =>
      editor.getSelectedShapeIds().length > 0 || CREATION_TOOLS.has(editor.getCurrentToolId()),
    [editor],
  );
  if (!show) return null;
  return <DefaultStylePanel />;
}
