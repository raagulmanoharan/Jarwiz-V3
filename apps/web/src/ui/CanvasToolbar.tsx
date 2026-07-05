/**
 * The style panel, gated for calm: hidden on an empty board with the select
 * tool, shown the moment you select a shape or pick a creation tool (so you can
 * pre-set color/size before drawing). The tools themselves live in ToolRail (a
 * custom right-edge rail); tldraw's bottom toolbar is disabled (App `Toolbar:
 * null`).
 */

import { DefaultStylePanel, useEditor, useValue } from 'tldraw';

/** Tools that "create" a styled shape — the style panel is useful as a
 *  pre-flight even before anything is selected. */
const CREATION_TOOLS = new Set(['geo', 'text', 'arrow', 'line', 'draw', 'frame', 'highlight', 'note']);

export function CanvasStylePanel() {
  const editor = useEditor();
  const show = useValue(
    'show-style-panel',
    () => {
      const selected = editor.getSelectedShapes();
      // Is this shape a generated flowchart group, or a shape inside one?
      // Those are Jarwiz artifacts with a deliberate look — the color/
      // thickness dials don't apply (owner call, 2026-07-05).
      const inFlowchart = (s: (typeof selected)[number]): boolean => {
        if (s.type === 'group' && (s.meta as { jzFlowchart?: boolean })?.jzFlowchart) return true;
        let pid: unknown = s.parentId;
        while (typeof pid === 'string' && pid.startsWith('shape:')) {
          const parent = editor.getShape(pid as Parameters<typeof editor.getShape>[0]);
          if (!parent) break;
          if (parent.type === 'group' && (parent.meta as { jzFlowchart?: boolean })?.jzFlowchart) return true;
          pid = parent.parentId;
        }
        return false;
      };
      // Doc-cards have no tldraw styles; generated diagrams keep their look.
      if (selected.length > 0 && selected.every((s) => s.type === 'doc-card' || inFlowchart(s)))
        return false;
      return selected.length > 0 || CREATION_TOOLS.has(editor.getCurrentToolId());
    },
    [editor],
  );
  if (!show) return null;
  return <DefaultStylePanel />;
}
