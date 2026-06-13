/**
 * Autopilot keyboard glue for an editing card. Thin and stateless: the actual
 * runs are concurrent background tasks in autopilotStore (so you can fire one
 * and go work another card). This just maps keys to the store, per card id.
 *
 *   Tab           → continue prose / fill the table (if not already running here)
 *   Esc           → stop this card's fill
 *   any input key → yield instantly (abort; the keystroke takes over)
 */

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';
import { abortAutopilot, continueProse, fillTable, isAutopilotRunning } from './autopilotStore';

export function useAutopilot() {
  const editor = useEditor();

  const onKeyDown = useCallback(
    (shapeId: TLShapeId, e: ReactKeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation(); // don't let tldraw move selection on Tab
        if (!isAutopilotRunning(shapeId)) {
          const shape = editor.getShape(shapeId);
          if (shape?.type === 'table-card') void fillTable(editor, shapeId);
          else void continueProse(editor, shapeId);
        }
        return;
      }
      if (!isAutopilotRunning(shapeId)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // stop the fill, don't exit edit mode
        abortAutopilot(shapeId);
        return;
      }
      const typing =
        (e.key.length === 1 && !e.metaKey && !e.ctrlKey) ||
        e.key === 'Enter' ||
        e.key === 'Backspace' ||
        e.key === 'Delete';
      if (typing) abortAutopilot(shapeId); // yield — let the keystroke take over
    },
    [editor],
  );

  return { onKeyDown };
}
